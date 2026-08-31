/* ===== game.js — simulation: player, enemies, AI, combat, stage flow ===== */
(function (g) {
  'use strict';

  const PLAYER_R = 0.26;
  const EYE_STAND = 0.52, EYE_CROUCH = 0.33;

  const Game = {
    state: 'menu',            // menu | brief | playing | paused | over | clear
    stage: null, stageIdx: 0,
    map: null,
    player: null,
    enemies: [], projectiles: [], parts: [], tracers: [], dmgNums: [], pickups: [],
    flow: null, flowT: 0, flowCell: -1,
    time: 0, kills: 0, coins: 0, totalEnemies: 0,
    shake: 0, shakeYaw: 0, shakePitch: 0,
    hitstop: 0, curZoom: 1, zoomT: 0,
    wavesFired: 0, boss: null,
    tutorialStep: 0, tutorialData: null,
    _lastHudHp: -1, _lastMag: -1, _lastRes: -1, _lastKills: -1, _lastCoins: -1, _lastSec: -1,

    /* =============================================================
     * SETUP
     * ===========================================================*/
    startStage(stageId) {
      const stage = DATA.STAGES.find(s => s.id === stageId) || DATA.STAGES[0];
      this.stage = stage;
      this.stageIdx = DATA.STAGES.indexOf(stage);
      // 難易度スケールは本編の並び順に基づく。カスタムは中盤相当として扱う
      this.diffIdx = stage.custom ? 2 : this.stageIdx;
      const m = DATA.parseMap(stage);
      this.map = m;
      Render.setStage(stage.theme);

      // reset containers
      this.enemies = []; this.projectiles = []; this.parts = [];
      this.tracers = []; this.dmgNums = []; this.pickups = [];
      this.time = 0; this.kills = 0; this.coins = 0;
      this.shake = 0; this.shakeYaw = 0; this.shakePitch = 0;
      this.hitstop = 0; this.zoomT = 0; this.curZoom = 1;
      this.wavesFired = 0; this.boss = null; this._clearAt = 0;
      this.flow = new Int16Array(m.w * m.h); this.flowT = 0; this.flowCell = -1;
      this._lastHudHp = -1; this._lastMag = -1; this._lastRes = -1;
      this._lastKills = -1; this._lastCoins = -1; this._lastSec = -1;

      // player
      const ps = Save.playerStats();
      const owned = Save.ownedWeapons();
      const weapons = owned.map(w => {
        const st = Save.weaponStats(w.id);
        st.mag = st.mag | 0;
        st.magMax = st.mag;
        st.reserve = st.startReserve;
        return st;
      });
      let wIdx = Math.max(0, owned.findIndex(w => w.id === Save.data.equipped));
      this.player = {
        x: m.spawn.x, y: m.spawn.y, ang: stage.dir || 0, pitch: 0,
        eyeZ: EYE_STAND, targetEyeZ: EYE_STAND,
        hp: ps.maxHp, maxHp: ps.maxHp,
        baseSpeed: ps.speed, armor: ps.armor,
        weapons, wIdx,
        get weapon() { return this.weapons[this.wIdx]; },
        fireCd: 0, reloading: false, reloadLeft: 0, reloadTotal: 0,
        switchT: 0, switchTotal: 0, pendingIdx: -1,
        recoilPitch: 0, recoilYaw: 0, recoilVis: 0,
        flashT: 0, bobPhase: 0, bobAmp: 0,
        shots: 0, hits: 0, dmgTaken: 0,
        hurtCd: 0, lastHitAng: 0, moved: 0, looked: 0,
        alive: true
      };
      this.player.weapons.forEach(w => { w.mag = w.magMax; });

      // enemies
      m.enemies.forEach(e => this.spawnEnemy(e.t, e.x, e.y));
      this.totalEnemies = this.enemies.length;

      // tutorial
      this.tutorialStep = stage.tutorial ? 1 : 0;
      this.tutorialData = null;

      this.state = 'playing';
      Input.setEnabled(true);
      Input.crouch = false;
      Input._els.crouch.classList.remove('toggled');
      Input.reset();
      Input.setEnabled(true);

      UI.enterGame(this);
      UI.updateWeaponSlots(this.player);
      this.syncHud(true);
      Snd.startBgm(stage.boss ? 'boss' : 'battle');
      Save.data.totalPlays++; Save.save();
    },

    spawnEnemy(typeId, x, y) {
      const def = DATA.ENEMIES[typeId];
      if (!def) return null;
      const st = this.stage;
      const hp = Math.round(def.hp * (st.hpMul || 1));
      const e = {
        type: typeId, def,
        x, y, ang: Math.random() * U.TAU,
        hp, maxHp: hp,
        speed: def.speed * (0.9 + (st.aiMul || 1) * 0.12),
        dmg: def.dmg * (st.dmgMul || 1),
        state: 'idle', stateT: U.rand(0, 1.5),
        atkCd: U.rand(0.4, 1.4), burstLeft: 0, burstT: 0,
        hurtT: 0, alertT: 0, atkFlash: 0, animT: Math.random() * 3, engagedT: 0,
        moving: false, deadT: 0, showBarT: 0,
        lastSeenX: 0, lastSeenY: 0, hasSeen: false,
        patrolX: x, patrolY: y, repathT: 0, stuckT: 0,
        lastCrit: false, wounded: false,
        phase: 1, patternT: 0, pattern: 0,
        scr: null
      };
      if (def.boss) { this.boss = e; e.state = 'idle'; }
      this.enemies.push(e);
      return e;
    },

    /* =============================================================
     * MAIN UPDATE
     * ===========================================================*/
    update(dtRaw) {
      if (this.state !== 'playing') return;
      let dt = dtRaw;
      if (this.hitstop > 0) { this.hitstop -= dtRaw; dt = dtRaw * 0.16; }
      dt = Math.min(dt, 0.05);

      this.time += dtRaw;
      Input.pollKeys();

      // shake decay first: the camera used for aiming must match the rendered one
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 4.2);
        const sh = this.shake * (Save.data.settings.shake ? 1 : 0);
        this.shakeYaw = (Math.random() - 0.5) * sh * 0.035;
        this.shakePitch = (Math.random() - 0.5) * sh * 0.018;
      } else { this.shakeYaw = 0; this.shakePitch = 0; }

      this.updatePlayer(dt);
      this.updateFlow(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateFx(dt);
      this.updateTutorial();

      this.checkObjective();
      this.syncHud(false);
    },

    /* ---------------- player ---------------- */
    updatePlayer(dt) {
      const p = this.player, w = p.weapon;

      // ---- look ----
      const l = Input.consumeLook();
      const zs = 1 - this.zoomT * 0.55;
      p.ang += l.dx * zs;
      p.pitch -= l.dy * zs * 0.55;
      p.looked += Math.abs(l.dx) + Math.abs(l.dy);
      // recoil recovery
      p.pitch += p.recoilPitch * dt * 9;
      p.ang += p.recoilYaw * dt * 9;
      p.recoilPitch *= Math.max(0, 1 - dt * 9);
      p.recoilYaw *= Math.max(0, 1 - dt * 9);
      p.pitch = U.clamp(p.pitch, -0.42, 0.42);
      if (p.ang > Math.PI) p.ang -= U.TAU; else if (p.ang < -Math.PI) p.ang += U.TAU;

      // ---- crouch / zoom ----
      const wantCrouch = Input.crouch;
      p.targetEyeZ = wantCrouch ? EYE_CROUCH : EYE_STAND;
      p.eyeZ += (p.targetEyeZ - p.eyeZ) * Math.min(1, dt * 12);
      const wantZoom = wantCrouch && w.zoom > 1 ? 1 : 0;
      this.zoomT += (wantZoom - this.zoomT) * Math.min(1, dt * 10);
      this.curZoom = U.lerp(1, w.zoom, this.zoomT);

      // ---- movement ----
      const sprinting = Input.sprint && !wantCrouch && Input.move.y > 0.25 && !p.reloading;
      let spd = p.baseSpeed * (sprinting ? 1.52 : 1) * (wantCrouch ? 0.52 : 1) * (this.zoomT > 0.5 ? 0.55 : 1);
      const mx = Input.move.x, my = Input.move.y;
      const mag = Math.hypot(mx, my);
      p.moving = mag > 0.08;
      if (p.moving) {
        const nrm = mag > 1 ? 1 / mag : 1;
        const fx = Math.cos(p.ang), fy = Math.sin(p.ang);
        const sx = -fy, sy = fx;
        let dx = (fx * my + sx * mx) * nrm * spd * dt;
        let dy = (fy * my + sy * mx) * nrm * spd * dt;
        this.moveWithCollision(p, dx, dy, PLAYER_R);
        p.moved += Math.abs(dx) + Math.abs(dy);
        p.bobPhase += dt * (sprinting ? 13 : 9) * mag;
        p.bobAmp = U.lerp(p.bobAmp, sprinting ? 1.5 : 1, dt * 6);
      } else {
        p.bobAmp = U.lerp(p.bobAmp, 0.12, dt * 6);
        p.bobPhase += dt * 1.6;
      }
      p.sprinting = sprinting;

      // ---- weapon switching ----
      if (p.switchT > 0) {
        p.switchT -= dt;
        if (p.switchT <= p.switchTotal * 0.5 && p.pendingIdx >= 0) {
          p.wIdx = p.pendingIdx; p.pendingIdx = -1;
          UI.updateWeaponSlots(p);
          this.syncHud(true);
        }
        if (p.switchT <= 0) { p.switchT = 0; }
      }

      // ---- reload ----
      if (p.reloading) {
        p.reloadLeft -= dt;
        UI.setReload(1 - p.reloadLeft / p.reloadTotal);
        if (p.reloadLeft <= p.reloadTotal * 0.5 && !p._rlMid) { p._rlMid = true; Snd.play('reload_mid'); }
        if (p.reloadLeft <= 0) this.finishReload();
      }

      // ---- firing ----
      p.fireCd -= dt;
      p.flashT = Math.max(0, p.flashT - dt * 3.4);
      p.recoilVis = Math.max(0, p.recoilVis - dt * 14);
      if (!Input.fire) p.semiLatch = false;
      if (Input.fire && p.switchT <= 0) {
        const semiBlocked = !p.weapon.auto && p.semiLatch;
        if (p.reloading || semiBlocked) { /* busy / waiting for trigger release */ }
        else if (p.weapon.mag <= 0) {
          if (p.fireCd <= 0) { Snd.play('dry'); p.fireCd = 0.28; p.semiLatch = true; this.tryReload(); }
        } else if (p.fireCd <= 0) {
          if (!p.weapon.auto) p.semiLatch = true;
          this.fire();
        }
      }
      // auto-reload on empty mag
      if (!p.reloading && p.weapon.mag <= 0 && p.weapon.reserve > 0 && p.fireCd <= 0.02) this.tryReload();
      Input.setNeedReload(!p.reloading && p.weapon.mag <= p.weapon.magMax * 0.25 && p.weapon.reserve > 0);

      if (p.hurtCd > 0) p.hurtCd -= dt;
    },

    moveWithCollision(ent, dx, dy, r) {
      const m = this.map;
      const solid = (cx, cy) => {
        if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return true;
        return m.grid[(cy | 0) * m.w + (cx | 0)] !== 0;
      };
      const canBe = (x, y) => {
        const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
        const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (solid(cx, cy)) return false;
        return true;
      };
      let moved = false;
      if (canBe(ent.x + dx, ent.y)) { ent.x += dx; moved = true; }
      if (canBe(ent.x, ent.y + dy)) { ent.y += dy; moved = true; }
      // hard clamp inside map bounds
      ent.x = U.clamp(ent.x, r + 0.01, m.w - r - 0.01);
      ent.y = U.clamp(ent.y, r + 0.01, m.h - r - 0.01);
      return moved;
    },

    /* ---------------- shooting ---------------- */
    tryReload() {
      const p = this.player, w = p.weapon;
      if (p.reloading || p.switchT > 0) return false;
      if (w.mag >= w.magMax || w.reserve <= 0) {
        if (w.reserve <= 0 && w.mag <= 0) UI.feed('弾薬がありません', 'warn');
        return false;
      }
      p.reloading = true;
      p.reloadTotal = w.reload;
      p.reloadLeft = w.reload;
      p._rlMid = false;
      Snd.play('reload_start');
      UI.setReload(0);
      return true;
    },
    finishReload() {
      const p = this.player, w = p.weapon;
      const need = w.magMax - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
      p.reloading = false; p.reloadLeft = 0;
      UI.setReload(null);
      Snd.play('reload_end');
      this.syncHud(true);
      if (this.tutorialStep === 5) this.tutorialStep = 6;
    },
    switchWeapon(dir) {
      const p = this.player;
      if (p.weapons.length < 2 || p.switchT > 0) return;
      let idx = p.wIdx;
      if (typeof dir === 'number' && dir >= 0 && dir < p.weapons.length) idx = dir;
      else idx = (p.wIdx + 1) % p.weapons.length;
      if (idx === p.wIdx) return;
      p.pendingIdx = idx;
      p.switchTotal = 0.45; p.switchT = 0.45;
      p.reloading = false; p.reloadLeft = 0; UI.setReload(null);
      Snd.play('switch');
      Save.data.equipped = p.weapons[idx].id; Save.save();
    },

    fire() {
      const p = this.player, w = p.weapon;
      // rebuild the camera from the live player state so the crosshair and the
      // hitscan agree exactly (render() re-applies the identical transform)
      Render.updateCamera(p, this.shakeYaw, this.shakePitch, this.curZoom);
      w.mag--;
      p.shots++;
      p.fireCd = 60 / w.rpm;
      p.flashT = 0.11;
      p.recoilVis = Math.min(3.2, p.recoilVis + w.recoil * 0.9);
      Snd.play(w.sfx);
      if (w.mag <= 3 && w.mag > 0) Snd.play('lowammo', { vol: 0.6 });

      // recoil kick
      const rc = w.recoil * 0.0042 * (Input.crouch ? 0.6 : 1);
      p.pitch += rc; p.recoilPitch -= rc;
      const ry = (Math.random() - 0.5) * rc * 0.9;
      p.ang += ry; p.recoilYaw -= ry;

      this.addShake(w.shake * (Input.crouch ? 0.7 : 1));

      // spread (degrees) -> screen px offset
      let spreadDeg = w.spread;
      if (p.moving) spreadDeg += w.moveSpread * (p.sprinting ? 1.9 : 1);
      if (Input.crouch) spreadDeg *= 0.55;
      if (this.zoomT > 0.6) spreadDeg *= 0.35;
      const cam = Render.cam, W = Render.W, H = Render.H;
      const D = cam.D;
      const pxPerDeg = Math.tan(Math.PI / 180) * D;

      let anyHit = false, anyCrit = false;
      const muzzleSx = W * (Input.lefty ? 0.34 : 0.66);
      const muzzleSy = H * 0.80;

      for (let i = 0; i < w.pellets; i++) {
        let ox = 0, oy = 0;
        if (w.pellets > 1) {
          const a = Math.random() * U.TAU, rr = Math.sqrt(Math.random());
          ox = Math.cos(a) * rr * spreadDeg * pxPerDeg;
          oy = Math.sin(a) * rr * spreadDeg * pxPerDeg * 0.8;
        } else {
          ox = U.spreadRand() * spreadDeg * pxPerDeg;
          oy = U.spreadRand() * spreadDeg * pxPerDeg;
        }
        const sx = W / 2 + ox, sy = H / 2 + oy;
        const res = this.hitscan(sx, sy, w);
        if (res.enemy) { anyHit = true; if (res.crit) anyCrit = true; }
        // tracer
        this.addTracer(muzzleSx, muzzleSy, res.wx, res.wy, res.wz, w.base.color);
      }
      if (anyHit) { p.hits++; UI.hitmarker(anyCrit); }

      // gunfire alerts nearby enemies
      const noise = w.id === 'sr' ? 26 : (w.id === 'sg' ? 18 : 14);
      this.makeNoise(p.x, p.y, noise);

      if (this.tutorialStep === 3) this.tutorialStep = 4;
      this.syncHud(true);
    },

    /* screen-space hitscan: returns {enemy, crit, wx,wy,wz, dist} */
    hitscan(sx, sy, w) {
      const cam = Render.cam, W = Render.W, H = Render.H;
      const camX = 2 * sx / W - 1;
      const rdx = cam.dirX + cam.planeX * camX;
      const rdy = cam.dirY + cam.planeY * camX;
      const rl = Math.hypot(rdx, rdy);
      const wall = Render.cast(this.map, cam.x, cam.y, rdx / rl, rdy / rl, w.range * 1.8 + 6);
      // wall.dist is euclidean here (unit dir) -> convert to perpendicular depth
      const perpFactor = (cam.dirX * rdx / rl + cam.dirY * rdy / rl);
      const wallDepth = wall.dist * perpFactor;

      const assist = Save.data.settings.aim ? 1.30 : 1.0;
      let best = null, bestDepth = 1e9;

      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.state === 'dead') continue;
        const pr = Render.project(e.x, e.y);
        if (!pr) continue;
        if (pr.depth >= wallDepth - 0.02) continue;      // behind a wall
        if (pr.depth > w.range * 1.9 + 6) continue;
        const set = Sprites.getEnemySprites(e.type);
        const lineH = pr.lineH;
        const spH = lineH * e.def.height * 1.06;
        const spW = spH * (set.w / set.h);
        const yBot = cam.horizon + cam.eyeZ * lineH;
        const yTop = yBot - spH;
        const halfW = spW * 0.30 * assist;
        if (sx < pr.sx - halfW || sx > pr.sx + halfW) continue;
        if (sy < yTop + spH * 0.02 || sy > yBot - spH * 0.02) continue;
        if (pr.depth < bestDepth) {
          bestDepth = pr.depth;
          // zone
          const rel = (sy - yTop) / spH;
          let zone = 'body', mul = 1;
          if (rel < 0.27) { zone = 'head'; mul = 2.0; }
          else if (rel > 0.78) { zone = 'legs'; mul = 0.75; }
          best = { e, zone, mul, depth: pr.depth, sx: pr.sx, yTop, spH, spW };
        }
      }

      if (best) {
        const e = best.e;
        // world impact point (approximate: enemy centre at body height)
        const dist = U.dist(cam.x, cam.y, e.x, e.y);
        const zHit = cam.eyeZ - (sy - cam.horizon) / (cam.D / best.depth);
        const crit = best.zone === 'head';
        this.damageEnemy(e, this.calcDamage(w, best.mul, dist, crit, e), crit, best.zone, zHit);
        return { enemy: e, crit, wx: e.x, wy: e.y, wz: U.clamp(zHit, 0.05, 1.4), dist };
      }

      // wall impact
      const hitDist = Math.min(wall.dist, w.range * 1.8 + 6);
      const ux = rdx / rl, uy = rdy / rl;
      const wx = cam.x + ux * (hitDist - 0.02);
      const wy = cam.y + uy * (hitDist - 0.02);
      const wz = cam.eyeZ - (sy - cam.horizon) / cam.D * hitDist * perpFactor;
      if (wall.hit) {
        this.spawnImpact(wx, wy, U.clamp(wz, 0.05, 0.98), (Sprites.fx && Sprites.fx.impact) || '#ffd9a0');
        Snd.play('impact_wall', { vol: 0.45 });
      }
      return { enemy: null, crit: false, wx, wy, wz: U.clamp(wz, 0.05, 1.2), dist: hitDist };
    },

    calcDamage(w, zoneMul, dist, crit, e) {
      let d = w.damage * zoneMul;
      if (dist > w.range) {
        const t = (dist - w.range) / (w.range * 1.1);
        d *= U.clamp(1 - t, w.falloff, 1);
      }
      if (crit) d *= w.crit;
      if (e && e.def.armor) d *= (1 - e.def.armor);
      return d;
    },

    damageEnemy(e, dmg, crit, zone, zHit) {
      if (e.state === 'dead') return;
      dmg = Math.max(1, Math.round(dmg));
      e.hp -= dmg;
      e.hurtT = 0.16;
      e.showBarT = 2.5;
      e.lastCrit = crit;
      e.alertT = Math.max(e.alertT, 0.5);
      this.alertEnemy(e, true);

      this.addDamageNumber(e.x, e.y, zHit || 0.7, crit ? dmg + '!' : '' + dmg, crit);
      this.spawnBlood(e.x, e.y, zHit || 0.7, crit ? 12 : 7, e.def.palette.trim);
      Snd.play(crit ? 'crit' : 'hit');
      if (crit) { this.addShake(0.55); this.hitstop = Math.max(this.hitstop, 0.035); UI.critFx(); }

      if (e.hp <= 0) this.killEnemy(e, crit);
      else if (e.hp / e.maxHp < 0.28 && !e.wounded) {
        e.wounded = true;
        if (!e.def.boss) { e.state = 'wounded'; e.stateT = 0; }
      }
    },

    killEnemy(e, crit) {
      e.hp = 0;
      e.state = 'dead';
      e.deadT = 0;
      this.kills++;
      const gain = Math.round(e.def.coins * (1 + this.diffIdx * 0.12) * (crit ? 1.25 : 1));
      this.coins += gain;
      this.spawnBlood(e.x, e.y, 0.6, e.def.boss ? 60 : 18, e.def.palette.trim);
      this.spawnGibs(e.x, e.y, e.def.boss ? 40 : 12);
      this.addShake(e.def.boss ? 3.2 : 0.9);
      this.hitstop = Math.max(this.hitstop, e.def.boss ? 0.25 : 0.055);
      Snd.play(e.def.boss ? 'boss_die' : 'enemy_die');
      this.makeNoise(e.x, e.y, 11);
      Snd.play('coin', { vol: 0.5 });
      UI.feed('撃破 ' + e.def.name + '  +' + gain + '◆', 'kill');
      Save.data.totalKills++;

      // loot
      const r = Math.random();
      if (e.def.boss) { this.spawnPickup(e.x, e.y, 'health'); this.spawnPickup(e.x + 0.6, e.y, 'ammo'); }
      else if (r < 0.26) this.spawnPickup(e.x, e.y, 'ammo');
      else if (r < 0.46) this.spawnPickup(e.x, e.y, 'health');

      if (this.tutorialStep === 4) this.tutorialStep = 5;
      if (e.def.boss) UI.bigMsg('TARGET ELIMINATED');
    },

    /* ---------------- enemies / AI ---------------- */
    updateFlow(dt) {
      this.flowT -= dt;
      const p = this.player;
      const cell = (p.y | 0) * this.map.w + (p.x | 0);
      if (this.flowT > 0 && cell === this.flowCell) return;
      this.flowT = 0.28;
      this.flowCell = cell;
      const m = this.map, f = this.flow;
      f.fill(-1);
      if (m.grid[cell]) return;
      const q = new Int32Array(m.w * m.h);
      let head = 0, tail = 0;
      f[cell] = 0; q[tail++] = cell;
      while (head < tail) {
        const c = q[head++];
        const cx = c % m.w, cy = (c / m.w) | 0;
        const d = f[c] + 1;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
          const ni = ny * m.w + nx;
          if (m.grid[ni] || f[ni] >= 0) continue;
          f[ni] = d; q[tail++] = ni;
        }
      }
    },

    canSee(e, p) {
      const d = U.dist(e.x, e.y, p.x, p.y);
      const sight = e.def.sight * (this.stage.aiMul || 1);
      if (d > sight) return false;
      // close range counts as "noticed" regardless of facing (footsteps / peripheral vision)
      const near = d < 4.5;
      if (!near && e.def.fov < 359) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        if (Math.abs(U.angDiff(e.ang, a)) > (e.def.fov * Math.PI / 180) / 2) return false;
      }
      return Render.los(this.map, e.x, e.y, p.x, p.y);
    },

    alertEnemy(e, force) {
      if (e.state === 'dead') return;
      if (e.state === 'idle' || e.state === 'patrol' || force) {
        if (e.state === 'idle' || e.state === 'patrol') {
          e.state = 'alert'; e.stateT = 0; e.alertT = 1.1;
          Snd.play('alert', { vol: 0.35 });
          this.makeNoise(e.x, e.y, 8);          // call out to nearby squadmates
        }
        e.hasSeen = true;
        e.lastSeenX = this.player.x; e.lastSeenY = this.player.y;
      }
    },

    makeNoise(x, y, radius) {
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.state !== 'idle' && e.state !== 'patrol') continue;
        if (U.dist2(e.x, e.y, x, y) < radius * radius) {
          e.lastSeenX = x; e.lastSeenY = y; e.hasSeen = true;
          e.state = 'alert'; e.stateT = 0; e.alertT = 1.0;
        }
      }
    },

    updateEnemies(dt) {
      const p = this.player;
      // how many regular enemies are allowed to be shooting at the same moment
      this._attackLimit = 2 + Math.floor(this.diffIdx * 0.5);
      let engaged = 0;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.state === 'dead' || e.def.boss) continue;
        if (e.engagedT > 0) { e.engagedT -= dt; engaged++; }
      }
      this._attackers = engaged;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        e.animT += dt;
        if (e.hurtT > 0) e.hurtT -= dt;
        if (e.alertT > 0) e.alertT -= dt;
        if (e.showBarT > 0) e.showBarT -= dt;
        if (e.atkFlash > 0) e.atkFlash -= dt;
        if (e.state === 'dead') { e.deadT += dt; continue; }

        e.stateT += dt;
        e.atkCd -= dt;
        e.moving = false;
        const d = U.dist(e.x, e.y, p.x, p.y);
        const sees = this.canSee(e, p);
        if (sees) { e.lastSeenX = p.x; e.lastSeenY = p.y; e.hasSeen = true; }

        if (e.def.boss) { this.updateBoss(e, dt, d, sees); continue; }

        switch (e.state) {
          case 'idle':
            if (sees) { e.state = 'alert'; e.stateT = 0; e.alertT = 1.1; Snd.play('alert', { vol: 0.3 }); }
            else if (e.stateT > 1.8) { e.state = 'patrol'; e.stateT = 0; this.pickPatrol(e); }
            else e.ang += Math.sin(this.time * 0.7 + e.x * 3.1) * dt * 1.15;
            break;

          case 'patrol': {
            if (sees) { e.state = 'alert'; e.stateT = 0; e.alertT = 1.1; Snd.play('alert', { vol: 0.3 }); break; }
            const pd = U.dist(e.x, e.y, e.patrolX, e.patrolY);
            if (pd < 0.35 || e.stateT > 7) { e.state = 'idle'; e.stateT = 0; break; }
            this.stepToward(e, e.patrolX, e.patrolY, e.speed * 0.45, dt);
            break;
          }

          case 'alert':
            this.faceTo(e, e.lastSeenX, e.lastSeenY, dt, e.def.turn * 1.6);
            if (e.stateT > 0.45) { e.state = 'chase'; e.stateT = 0; }
            break;

          case 'chase': {
            const want = e.def.keepDist || (e.def.melee ? 0.9 : e.def.atkRange * 0.72);
            this.faceTo(e, e.lastSeenX, e.lastSeenY, dt, e.def.turn);
            if (sees && d <= e.def.atkRange) {   // point-blank still counts: they shoot and back up
              e.state = 'attack'; e.stateT = 0; break;
            }
            if (sees && e.def.keepDist && d < e.def.keepDist * 0.72) {
              // ranged unit backs off
              this.stepAway(e, p.x, p.y, e.speed * 0.85, dt);
            } else {
              this.chaseStep(e, dt, sees, e.wounded ? e.speed * 1.12 : e.speed);
            }
            if (!sees && e.hasSeen && U.dist(e.x, e.y, e.lastSeenX, e.lastSeenY) < 0.6) {
              e.state = 'patrol'; e.stateT = 0; e.hasSeen = false; this.pickPatrol(e);
            }
            break;
          }

          case 'attack': {
            this.faceTo(e, p.x, p.y, dt, e.def.turn * 1.5);
            const inRange = d <= e.def.atkRange * 1.05;
            if (!sees || !inRange) { e.state = 'chase'; e.stateT = 0; break; }
            // strafe a little so they aren't static targets
            if (!e.def.melee) {
              const sdir = ((e.x * 7 + e.y * 3) | 0) % 2 ? 1 : -1;
              const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * sdir;
              const st = Math.sin(this.time * 1.1 + e.x) * 0.6;
              this.tryMove(e, Math.cos(a) * e.speed * 0.42 * st * dt, Math.sin(a) * e.speed * 0.42 * st * dt);
              // keep a comfortable firing distance instead of body-blocking the player
              const min = Math.max(e.def.atkMin || 0, e.def.keepDist ? e.def.keepDist * 0.8 : 0);
              if (min && d < min) this.stepAway(e, p.x, p.y, e.speed * 0.7, dt);
            }
            this.tryAttack(e, dt, d);
            break;
          }

          case 'wounded': {
            // 瀕死: melee units go berserk, others fall back while firing
            this.faceTo(e, p.x, p.y, dt, e.def.turn);
            if (e.def.melee) {
              this.chaseStep(e, dt, sees, e.speed * 1.3);
              if (d < e.def.atkRange) this.tryAttack(e, dt, d);
            } else {
              if (d < e.def.atkRange * 0.55) this.stepAway(e, p.x, p.y, e.speed * 0.9, dt);
              else this.chaseStep(e, dt, sees, e.speed * 0.55);
              if (sees && d <= e.def.atkRange) this.tryAttack(e, dt, d);
            }
            if (e.stateT > 6 && !sees) { e.state = 'chase'; e.stateT = 0; }
            break;
          }
        }
        // burst continuation
        if (e.burstLeft > 0) {
          e.burstT -= dt;
          if (e.burstT <= 0) { this.enemyShoot(e); e.burstLeft--; e.burstT = e.def.burstGap; }
        }
      }
    },

    updateBoss(e, dt, d, sees) {
      const p = this.player;
      const ratio = e.hp / e.maxHp;
      const newPhase = ratio > 0.66 ? 1 : (ratio > 0.33 ? 2 : 3);
      if (newPhase !== e.phase) {
        e.phase = newPhase;
        UI.bigMsg('PHASE ' + newPhase);
        this.addShake(2.2);
        Snd.play('alert');
      }
      // reinforcement waves
      const waves = this.stage.waves || [];
      while (this.wavesFired < waves.length && ratio <= waves[this.wavesFired].hp) {
        const wv = waves[this.wavesFired++];
        wv.enemies.forEach(s => {
          const ne = this.spawnEnemy(s.t, s.x, s.y);
          if (ne) { ne.state = 'chase'; ne.hasSeen = true; ne.lastSeenX = p.x; ne.lastSeenY = p.y; }
        });
        this.totalEnemies += wv.enemies.length;
        UI.feed('援軍出現！', 'warn');
        UI.bigMsg('REINFORCEMENTS');
      }

      e.state = sees ? (d < 3 ? 'attack' : 'chase') : 'chase';
      this.faceTo(e, p.x, p.y, dt, e.def.turn);
      e.patternT -= dt;

      if (e.phase === 3 && e.pattern === 2) {
        // charge
        this.chaseStep(e, dt, true, e.speed * 2.3);
        if (d < 1.8 && e.atkCd <= 0) {
          this.hurtPlayer(e.dmg * 1.4, Math.atan2(e.y - p.y, e.x - p.x));
          e.atkCd = 1.2;
          this.addShake(2.0);
        }
        if (e.patternT <= 0) { e.pattern = 0; e.patternT = 2.0; }
        return;
      }

      // reposition
      const want = 7.5;
      if (d > want + 2) this.chaseStep(e, dt, sees, e.speed);
      else if (d < want - 2.5) this.stepAway(e, p.x, p.y, e.speed * 0.8, dt);
      else {
        const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2;
        const st = Math.sin(this.time * 0.7) * 1.0;
        this.tryMove(e, Math.cos(a) * e.speed * st * dt, Math.sin(a) * e.speed * st * dt);
        e.moving = Math.abs(st) > 0.2;
      }

      if (!sees) return;
      if (e.patternT <= 0) {
        e.pattern = (e.phase === 3) ? U.randInt(0, 2) : U.randInt(0, 1);
        e.patternT = e.phase === 1 ? 2.6 : (e.phase === 2 ? 2.0 : 1.6);
        if (e.pattern === 0) {           // burst
          e.burstLeft = Math.min(5, 2 + e.phase); e.burstT = 0; e.atkFlash = 0.4;
        } else if (e.pattern === 1) {    // fan spread — wide gaps so it can be side-stepped
          const n = Math.min(8, 4 + e.phase * 2);
          const base = Math.atan2(p.y - e.y, p.x - e.x);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.21;
            this.spawnProjectile(e, a, e.dmg * 0.8, e.def.projSpeed * 0.9, '#ff6ad5');
          }
          e.atkFlash = 0.4;
          Snd.play('enemy_shot');
          this.addShake(0.5);
        } else {                         // charge windup
          e.patternT = 2.2;
          UI.feed('TITAN が突進してくる！', 'warn');
        }
      }
      if (e.burstLeft > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) { this.enemyShoot(e); e.burstLeft--; e.burstT = e.def.burstGap; }
      }
    },

    pickPatrol(e) {
      const m = this.map;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * U.TAU, r = U.rand(1.5, 5.5);
        const nx = e.x + Math.cos(a) * r, ny = e.y + Math.sin(a) * r;
        if (nx < 1 || ny < 1 || nx > m.w - 1 || ny > m.h - 1) continue;
        if (m.grid[(ny | 0) * m.w + (nx | 0)]) continue;
        if (!Render.los(m, e.x, e.y, nx, ny)) continue;
        e.patrolX = nx; e.patrolY = ny; return;
      }
      e.patrolX = e.x; e.patrolY = e.y;
    },

    faceTo(e, tx, ty, dt, turn) {
      const a = Math.atan2(ty - e.y, tx - e.x);
      e.ang = U.approachAngle(e.ang, a, (turn || 3) * dt);
    },

    tryMove(e, dx, dy) {
      const before = e.x + e.y;
      this.moveWithCollision(e, dx, dy, e.def.radius);
      // separation from other enemies (avoid stacking)
      for (let i = 0; i < this.enemies.length; i++) {
        const o = this.enemies[i];
        if (o === e || o.state === 'dead') continue;
        const dd = U.dist2(e.x, e.y, o.x, o.y);
        const minD = (e.def.radius + o.def.radius) * 0.95;
        if (dd < minD * minD && dd > 0.0001) {
          const dist = Math.sqrt(dd);
          const push = (minD - dist) * 0.5;
          const nx = (e.x - o.x) / dist, ny = (e.y - o.y) / dist;
          this.moveWithCollision(e, nx * push, ny * push, e.def.radius);
        }
      }
      return Math.abs(e.x + e.y - before) > 0.0001;
    },

    stepToward(e, tx, ty, spd, dt) {
      const a = Math.atan2(ty - e.y, tx - e.x);
      this.faceTo(e, tx, ty, dt, e.def.turn);
      const moved = this.tryMove(e, Math.cos(a) * spd * dt, Math.sin(a) * spd * dt);
      e.moving = true;
      if (!moved) {
        e.stuckT += dt;
        if (e.stuckT > 0.25) {
          const s = ((e.x * 13 + e.y * 7) | 0) % 2 ? 1 : -1;
          this.tryMove(e, Math.cos(a + s * 1.6) * spd * dt * 1.4, Math.sin(a + s * 1.6) * spd * dt * 1.4);
          if (e.stuckT > 1.2) { e.stuckT = 0; this.pickPatrol(e); }
        }
      } else e.stuckT = 0;
    },

    stepAway(e, tx, ty, spd, dt) {
      const a = Math.atan2(e.y - ty, e.x - tx);
      const moved = this.tryMove(e, Math.cos(a) * spd * dt, Math.sin(a) * spd * dt);
      e.moving = true;
      if (!moved) {
        const s = ((e.x * 5 + e.y * 11) | 0) % 2 ? 1 : -1;
        this.tryMove(e, Math.cos(a + s * 1.5) * spd * dt, Math.sin(a + s * 1.5) * spd * dt);
      }
    },

    // follow BFS flow field toward the player (falls back to direct line when visible)
    chaseStep(e, dt, sees, spd) {
      const p = this.player, m = this.map;
      if (sees && Render.los(m, e.x, e.y, p.x, p.y)) {
        this.stepToward(e, p.x, p.y, spd, dt);
        return;
      }
      const cx = e.x | 0, cy = e.y | 0;
      const here = this.flow[cy * m.w + cx];
      let bx = e.lastSeenX, by = e.lastSeenY, best = here < 0 ? 1e9 : here;
      let found = false;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const v = this.flow[ny * m.w + nx];
        if (v < 0) continue;
        if (v < best) { best = v; bx = nx + 0.5; by = ny + 0.5; found = true; }
      }
      if (!found && e.hasSeen) { bx = e.lastSeenX; by = e.lastSeenY; }
      this.stepToward(e, bx, by, spd, dt);
    },

    tryAttack(e, dt, d) {
      if (e.atkCd > 0) return;
      const p = this.player;
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      if (Math.abs(U.angDiff(e.ang, a)) > 0.5) return;
      // wait your turn — keeps firefights readable and survivable
      if (!e.def.boss && e.engagedT <= 0 && this._attackers >= this._attackLimit) {
        e.atkCd = 0.3;
        return;
      }
      const aim = this.stage.aiMul || 1;
      e.atkCd = e.def.atkCd / (1 + (aim - 1) * 0.35);
      e.engagedT = e.def.atkCd * 0.7;
      if (!e.def.boss) this._attackers++;
      e.atkFlash = 0.3;
      if (e.def.melee) {
        if (d <= e.def.atkRange) {
          this.hurtPlayer(e.dmg, a + Math.PI);
          this.spawnBlood(p.x + Math.cos(a) * .3, p.y + Math.sin(a) * .3, 0.5, 6, '#ff4a4a');
          Snd.play('enemy_shot', { vol: 0.7 });
        }
      } else {
        e.burstLeft = e.def.burst;
        e.burstT = 0;
      }
    },

    enemyShoot(e) {
      const p = this.player;
      const base = Math.atan2(p.y - e.y, p.x - e.x);
      const err = (1 - e.def.accuracy) * 0.34 * (e.wounded ? 1.5 : 1);
      const a = base + U.spreadRand() * err;
      this.spawnProjectile(e, a, e.dmg, e.def.projSpeed, e.def.palette.visor);
      e.atkFlash = 0.22;
      Snd.play('enemy_shot', { vol: U.clamp(1.4 / (1 + U.dist(e.x, e.y, p.x, p.y) * 0.12), 0.15, 0.7) });
    },

    spawnProjectile(e, ang, dmg, speed, color) {
      const pr = {
        alive: true,
        x: e.x + Math.cos(ang) * (e.def.radius + 0.15),
        y: e.y + Math.sin(ang) * (e.def.radius + 0.15),
        z: 0.52,
        dx: Math.cos(ang), dy: Math.sin(ang),
        speed, dmg, r: 0.09, color: color || '#ff7a4a',
        life: 4
      };
      this.projectiles.push(pr);
      if (this.projectiles.length > 90) this.projectiles.shift();
      return pr;
    },

    updateProjectiles(dt) {
      const p = this.player, m = this.map;
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        if (!pr.alive) { this.projectiles.splice(i, 1); continue; }
        pr.life -= dt;
        if (pr.life <= 0) { pr.alive = false; continue; }
        const step = pr.speed * dt;
        const nx = pr.x + pr.dx * step, ny = pr.y + pr.dy * step;
        // wall
        if (m.grid[(ny | 0) * m.w + (nx | 0)] || nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) {
          this.spawnImpact(pr.x, pr.y, pr.z, pr.color);
          pr.alive = false; continue;
        }
        pr.x = nx; pr.y = ny;
        // player hit
        if (U.dist2(pr.x, pr.y, p.x, p.y) < 0.16) {
          this.hurtPlayer(pr.dmg, Math.atan2(-pr.dy, -pr.dx));
          this.spawnImpact(pr.x, pr.y, pr.z, pr.color);
          pr.alive = false;
        }
      }
    },

    hurtPlayer(dmg, fromAng) {
      const p = this.player;
      if (!p.alive || this.state !== 'playing') return;
      // brief post-hit resistance: a simultaneous volley hurts, but never one-shots
      const soften = p.hurtCd > 0 ? 0.42 : 1;
      dmg = Math.max(1, Math.round(dmg * (1 - p.armor) * soften));
      p.hurtCd = 0.30;
      p.hp -= dmg;
      p.dmgTaken += dmg;
      p.lastHitAng = fromAng;
      this.addShake(0.9);
      Snd.play('hurt');
      UI.damageFlash(U.clamp(dmg / 26, 0.25, 1));
      UI.dirIndicator(U.angDiff(p.ang, fromAng));
      if (p.hp <= 0) { p.hp = 0; this.gameOver(); }
      this.syncHud(true);
    },

    /* ---------------- pickups / fx ---------------- */
    spawnPickup(x, y, type) {
      this.pickups.push({ alive: true, x, y, type, t: Math.random() * 6, life: 30 });
    },
    updatePickups(dt) {
      const p = this.player;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        pk.t += dt; pk.life -= dt;
        if (pk.life <= 0) { this.pickups.splice(i, 1); continue; }
        if (U.dist2(pk.x, pk.y, p.x, p.y) < 0.30) {
          if (pk.type === 'ammo') {
            let added = 0;
            p.weapons.forEach(w => {
              const add = Math.round(w.magMax * 1.5);
              const before = w.reserve;
              w.reserve = Math.min(w.reserveMax, w.reserve + add);
              added += w.reserve - before;
            });
            UI.feed('弾薬補給 +' + added, 'coin');
          } else if (pk.type === 'health') {
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.28));
            UI.feed('回復 +' + (p.hp - before), 'coin');
          }
          Snd.play('coin');
          this.pickups.splice(i, 1);
          this.syncHud(true);
        }
      }
    },

    addShake(v) { this.shake = Math.min(6, this.shake + v); },

    addTracer(sx0, sy0, x1, y1, z1, color) {
      this.tracers.push({ alive: true, sx0, sy0, x1, y1, z1, color: color || '#fff', life: 0.075, maxLife: 0.075 });
      if (this.tracers.length > 40) this.tracers.shift();
    },
    addDamageNumber(x, y, z, text, crit) {
      this.dmgNums.push({
        alive: true, x: x + U.rand(-.2, .2), y: y + U.rand(-.2, .2), z, text, crit,
        rise: 0, life: 0.85, maxLife: 0.85, tilt: U.rand(-0.22, 0.22)
      });
      if (this.dmgNums.length > 26) this.dmgNums.shift();
    },
    spawnBlood(x, y, z, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * U.TAU, s = U.rand(0.4, 2.4);
        this.parts.push({
          alive: true, x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(0.4, 2.6),
          size: U.rand(0.012, 0.035), color: color || '#ff4a4a', add: true,
          life: U.rand(0.25, 0.55), maxLife: 0.55, grav: 4.5
        });
      }
      this.trimParts();
    },
    spawnGibs(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * U.TAU, s = U.rand(0.8, 3.4);
        this.parts.push({
          alive: true, x, y, z: 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(1.2, 4.2),
          size: U.rand(0.02, 0.05), color: U.pick((Sprites.fx && Sprites.fx.gib) || ['#ffd24a', '#ff8a3a', '#ffffff']), add: true,
          life: U.rand(0.4, 0.9), maxLife: 0.9, grav: 6
        });
      }
      this.trimParts();
    },
    spawnImpact(x, y, z, color) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * U.TAU, s = U.rand(0.5, 2.0);
        this.parts.push({
          alive: true, x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(0.5, 2.4),
          size: U.rand(0.01, 0.026), color: color || '#ffd9a0', add: true,
          life: U.rand(0.12, 0.3), maxLife: 0.3, grav: 5
        });
      }
      this.trimParts();
    },
    trimParts() {
      const cap = 260;
      if (this.parts.length > cap) this.parts.splice(0, this.parts.length - cap);
    },

    updateFx(dt) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const pt = this.parts[i];
        pt.life -= dt;
        if (pt.life <= 0) { this.parts.splice(i, 1); continue; }
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.z += pt.vz * dt; pt.vz -= pt.grav * dt;
        if (pt.z < 0.02) { pt.z = 0.02; pt.vz *= -0.32; pt.vx *= 0.6; pt.vy *= 0.6; }
      }
      for (let i = this.tracers.length - 1; i >= 0; i--) {
        const t = this.tracers[i];
        t.life -= dt;
        if (t.life <= 0) this.tracers.splice(i, 1);
      }
      for (let i = this.dmgNums.length - 1; i >= 0; i--) {
        const d = this.dmgNums[i];
        d.life -= dt; d.rise += dt * 0.55;
        if (d.life <= 0) this.dmgNums.splice(i, 1);
      }
    },

    /* ---------------- objective / flow ---------------- */
    checkObjective() {
      if (this.state !== 'playing') return;
      const st = this.stage;
      let met = false;
      if (st.objective === 'boss') {
        met = !!(this.boss && this.boss.state === 'dead' && this.boss.deadT > 1.4);
        if (met) { this.stageClear(); return; }
      } else if (st.objective === 'count') {
        met = this.kills >= (st.target || 1);
      } else {
        met = this.enemies.length > 0 && this.enemies.every(e => e.state === 'dead');
      }
      if (met) {
        if (!this._clearAt) this._clearAt = this.time + 0.9;
        if (this.time >= this._clearAt) this.stageClear();
      } else this._clearAt = 0;
    },

    remaining() {
      const st = this.stage;
      if (st.objective === 'boss') return this.boss && this.boss.state !== 'dead' ? 1 : 0;
      if (st.objective === 'count') return Math.max(0, (st.target || 1) - this.kills);
      return this.enemies.filter(e => e.state !== 'dead').length;
    },

    stageClear() {
      if (this.state !== 'playing') return;
      this.state = 'clear';
      this._clearAt = 0;
      Input.setEnabled(false);
      Snd.stopBgm(); Snd.play('clear');
      const p = this.player;
      const acc = p.shots ? p.hits / p.shots : 0;
      const rank = DATA.computeRank(this.stage, this.time, acc, p.hp / p.maxHp);
      const bonus = Math.round(this.stage.reward * ({ S: 1.6, A: 1.35, B: 1.15, C: 1.0, D: 0.85 })[rank]);
      const total = this.coins + bonus;
      const newWeapon = Save.clearStage(this.stage.id, rank, this.time, total);
      UI.showClear({
        stage: this.stage, rank, time: this.time, kills: this.kills,
        acc, coins: this.coins, bonus, total, newWeapon,
        hasNext: !this.stage.custom && !!DATA.STAGES[this.stageIdx + 1] && !DATA.STAGES[this.stageIdx + 1].custom
      });
    },

    gameOver() {
      if (this.state !== 'playing') return;
      this.state = 'over';
      this.player.alive = false;
      Input.setEnabled(false);
      Snd.stopBgm(); Snd.play('gameover');
      this.addShake(2.5);
      UI.showOver({
        stage: this.stage, time: this.time, kills: this.kills,
        remaining: this.remaining(), coins: this.coins
      });
    },

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      Input.setEnabled(false);
      UI.showScreen('pause');
    },
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      Input.reset();
      Input.setEnabled(true);
      UI.showScreen('hud');
    },
    quitToMenu() {
      this.state = 'menu';
      Input.setEnabled(false);
      Snd.startBgm('menu');
    },

    /* ---------------- tutorial ---------------- */
    updateTutorial() {
      if (!this.tutorialStep) return;
      const p = this.player;
      const steps = {
        1: { text: '左側の画面をドラッグして移動しよう', done: () => p.moved > 2.2 },
        2: { text: '右側の画面をスワイプして視点を動かそう', done: () => p.looked > 1.6 },
        3: { text: '敵を見つけたら FIRE ボタンで射撃！', done: () => p.shots > 0 },
        4: { text: '頭を狙うとクリティカル。敵を倒せ！', done: () => this.kills > 0 },
        5: { text: '弾が減ったら RELOAD ボタンでリロード', done: () => false },
        6: { text: 'ミッション目標を達成すればステージクリア！', done: () => this.time > 1e9, auto: 3.5 }
      };
      const s = steps[this.tutorialStep];
      if (!s) { UI.tutorial(null); return; }
      if (this.tutorialData !== this.tutorialStep) {
        this.tutorialData = this.tutorialStep;
        this._tutT = 0;
        UI.tutorial(s.text);
      }
      this._tutT += 1 / 60;
      if (s.done()) { this.tutorialStep++; this.tutorialData = null; }
      else if (s.auto && this._tutT > s.auto) { this.tutorialStep = 0; UI.tutorial(null); }
    },

    /* ---------------- HUD ---------------- */
    syncHud(force) {
      const p = this.player;
      if (!p) return;
      const w = p.weapon;
      if (force || p.hp !== this._lastHudHp) { UI.setHP(p.hp, p.maxHp); this._lastHudHp = p.hp; }
      if (force || w.mag !== this._lastMag || w.reserve !== this._lastRes) {
        UI.setAmmo(w.mag, w.reserve, w.name);
        this._lastMag = w.mag; this._lastRes = w.reserve;
      }
      if (force || this.kills !== this._lastKills) { UI.setKills(this.kills); this._lastKills = this.kills; }
      if (force || this.coins !== this._lastCoins) { UI.setCoins(this.coins); this._lastCoins = this.coins; }
      const sec = this.time | 0;
      if (force || sec !== this._lastSec) {
        UI.setTimer(this.time);
        UI.setObjective(this.stage, this.remaining(), this.totalEnemies);
        this._lastSec = sec;
      }
    },

    /* frame render entry */
    render() {
      if (!this.map || !this.player) return;
      Render.render(this);
    }
  };

  g.Game = Game;
})(window);
