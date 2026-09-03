/* ===== brplayer.js — プレイヤー操作 =========================================
 * 入力の解釈だけを担当し、状態変更は必ず BR 側の API を通す。
 * 命中判定は画面座標で行うため、クロスヘアの見た目と結果が必ず一致する。
 * ========================================================================= */
(function (g) {
  'use strict';

  const EYE = { stand: 0.55, crouch: 0.34, prone: 0.18 };
  const SPEED = { stand: 3.3, crouch: 1.7, prone: 0.9 };
  const NOISE = { sprint: 26, run: 16, crouch: 7, prone: 3 };

  const BRPlayer = {
    aimAssist: 1.3,
    sens: 200,
    adsSens: 0.7,          // ADS中の視点感度（設定「ADS感度」/100）
    gyro: 'OFF', gyroSens: 1.0, _gyro: { x: 0, y: 0 },

    update(br, dt) {
      const p = br.player;
      if (!p || !p.alive) return;

      // 視点は降下中も操作できる
      const l = Input.consumeLook();
      // ADS中は設定した比率まで感度を落とす
      const zs = U.lerp(1, this.adsSens, br.zoomT);
      p.ang += l.dx * zs;
      p.pitch -= l.dy * zs * 0.55;
      if (this.gyro !== 'OFF' && (this.gyro === 'ALWAYS' || br.zoomT > 0.5)) {
        p.ang += this._gyro.x * this.gyroSens * dt;
        p.pitch += this._gyro.y * this.gyroSens * dt;
      }
      p.pitch += p.recoilPitch * dt * 9;
      p.ang += p.recoilYaw * dt * 9;
      p.recoilPitch *= Math.max(0, 1 - dt * 9);
      p.recoilYaw *= Math.max(0, 1 - dt * 9);
      p.pitch = U.clamp(p.pitch, -0.42, 0.42);
      if (p.ang > Math.PI) p.ang -= U.TAU; else if (p.ang < -Math.PI) p.ang += U.TAU;

      if (p.state !== 'ground') { p.moving = false; return; }

      // --- スタンス（伏せ > しゃがみ > 立ち） ---
      const w = p.weapons[p.wIdx];
      p.stance = this.prone ? 'prone' : (Input.crouch ? 'crouch' : 'stand');
      p.targetEyeZ = EYE[p.stance] || EYE.stand;
      p.eyeZ += (p.targetEyeZ - p.eyeZ) * Math.min(1, dt * 12);

      // --- ADS ---
      const wantZoom = (Input.ads && w) ? 1 : 0;
      br.zoomT += (wantZoom - br.zoomT) * Math.min(1, dt * 11);
      br.curZoom = U.lerp(1, w ? (w.def.zoom || 1) : 1, br.zoomT);

      // --- 移動 ---
      const sprinting = Input.sprint && p.stance === 'stand' && Input.move.y > 0.25 &&
        !p.reloading && !Input.ads;
      let spd = (SPEED[p.stance] || SPEED.stand) * (sprinting ? 1.5 : 1) *
        (br.zoomT > 0.5 ? 0.5 : 1) * (p.speedBuff > 0 ? 1.25 : 1);
      const mx = Input.move.x, my = Input.move.y;
      const mag = Math.hypot(mx, my);
      p.moving = mag > 0.08;
      p.sprinting = sprinting;
      if (p.moving) {
        const nrm = mag > 1 ? 1 / mag : 1;
        const fx = Math.cos(p.ang), fy = Math.sin(p.ang);
        br.moveWithCollision(p, (fx * my - fy * mx) * nrm * spd * dt,
          (fy * my + fx * mx) * nrm * spd * dt, p.def.radius);
        p.bobPhase += dt * (sprinting ? 13 : 9) * mag;
        p.bobAmp = U.lerp(p.bobAmp, sprinting ? 1.5 : 1, dt * 6);
        // 足音: 状態で音量が変わる
        p._stepT = (p._stepT || 0) - dt;
        if (p._stepT <= 0) {
          p._stepT = sprinting ? 0.30 : (p.stance === 'stand' ? 0.42 : 0.7);
          const kind = sprinting ? 'sprint' : (p.stance === 'stand' ? 'run' : p.stance);
          br.makeNoise(p, NOISE[kind] || 12);
          br.emit('footstep', kind);
        }
      } else {
        p.bobAmp = U.lerp(p.bobAmp, 0.12, dt * 6);
        p.bobPhase += dt * 1.6;
      }

      // --- 射撃 ---
      this.updateFire(br, dt);
    },

    updateFire(br, dt) {
      const p = br.player, w = p.weapons[p.wIdx];
      if (!Input.fire) p.semiLatch = false;
      if (!w || p.reloading || p.switchT > 0 || p.useT > 0) return;
      if (w.mag <= 0) {
        if (Input.fire && p.fireCd <= 0) {
          p.fireCd = 0.3; p.semiLatch = true;
          br.emit('dry', p);
          br.tryReload(p);
        }
        return;
      }
      if (!Input.fire) return;
      switch (w.def.fireMode) {
        case 'auto':
          if (p.fireCd <= 0) this.shoot(br);
          break;
        case 'burst':
          if (!p.semiLatch && p.fireCd <= 0 && p.burstLeft <= 0) {
            p.semiLatch = true;
            p.burstLeft = w.def.burstCount || 3;
            p.burstT = 0;
          }
          break;
        default:
          if (!p.semiLatch && p.fireCd <= 0) { p.semiLatch = true; this.shoot(br); }
          break;
      }
    },

    /** 1発撃つ。画面座標で当たりを取るのでクロスヘアと結果が一致する */
    shoot(br) {
      const p = br.player, w = p.weapons[p.wIdx];
      if (!w || w.mag <= 0) return;
      Render.updateCamera(p, br.shakeYaw, br.shakePitch, br.curZoom);
      if (!br.fire(p)) return;

      const cam = Render.cam, W = Render.W, H = Render.H;
      let spreadDeg = w.def.spread;
      if (p.moving) spreadDeg += w.def.moveSpread * (p.sprinting ? 1.8 : 1);
      if (p.stance === 'crouch') spreadDeg *= 0.6;
      if (p.stance === 'prone') spreadDeg *= 0.4;
      if (br.zoomT > 0.6) spreadDeg *= 0.35;
      const pxPerDeg = Math.tan(Math.PI / 180) * cam.D;
      const muzzleSx = W * (Input.lefty ? 0.34 : 0.66), muzzleSy = H * 0.80;

      let anyHit = false, anyHead = false;
      for (let i = 0; i < (w.def.pellets || 1); i++) {
        let ox, oy;
        if ((w.def.pellets || 1) > 1) {
          const a = Math.random() * U.TAU, rr = Math.sqrt(Math.random());
          ox = Math.cos(a) * rr * spreadDeg * pxPerDeg;
          oy = Math.sin(a) * rr * spreadDeg * pxPerDeg * 0.8;
        } else {
          ox = U.spreadRand() * spreadDeg * pxPerDeg;
          oy = U.spreadRand() * spreadDeg * pxPerDeg;
        }
        const res = this.hitscan(br, W / 2 + ox, H / 2 + oy, w);
        if (res.hit) { anyHit = true; if (res.head) anyHead = true; }
        br.addTracer(muzzleSx, muzzleSy, res.wx, res.wy, res.wz, w.def.color);
      }
      if (anyHit) {
        p.hits++;
        br.emit('hitmark', anyHead);
        Haptics.tap(anyHead ? 'crit' : 'hit');
      }
    },

    hitscan(br, sx, sy, w) {
      const cam = Render.cam, W = Render.W;
      const camX = 2 * sx / W - 1;
      const rdx = cam.dirX + cam.planeX * camX;
      const rdy = cam.dirY + cam.planeY * camX;
      const rl = Math.hypot(rdx, rdy);
      const maxR = w.def.range * 2 + 10;
      const wall = Render.cast(br.map, cam.x, cam.y, rdx / rl, rdy / rl, maxR);
      const perp = (cam.dirX * rdx / rl + cam.dirY * rdy / rl);
      const wallDepth = wall.dist * perp;

      let best = null, bestDepth = 1e9;
      for (let i = 0; i < br.combatants.length; i++) {
        const c = br.combatants[i];
        if (c === br.player || !c.alive || c.state !== 'ground') continue;
        const pr = Render.project(c.x, c.y);
        if (!pr || pr.depth >= wallDepth - 0.02 || pr.depth > maxR) continue;
        const set = Sprites.getEnemySprites(c.type);
        const lineH = pr.lineH;
        const spH = lineH * c.def.height * 1.06;
        const spW = spH * (set.w / set.h);
        const yBot = cam.horizon + cam.eyeZ * lineH, yTop = yBot - spH;
        const halfW = spW * 0.30 * this.aimAssist;
        if (sx < pr.sx - halfW || sx > pr.sx + halfW) continue;
        if (sy < yTop + spH * 0.02 || sy > yBot - spH * 0.02) continue;
        if (pr.depth < bestDepth) {
          bestDepth = pr.depth;
          const rel = (sy - yTop) / spH;
          best = { c, head: rel < 0.27, depth: pr.depth, mul: rel > 0.78 ? 0.8 : 1 };
        }
      }

      if (best) {
        const c = best.c;
        const dist = U.dist(cam.x, cam.y, c.x, c.y);
        let dmg = w.def.damage * best.mul;
        if (dist > w.def.range) {
          dmg *= U.clamp(1 - (dist - w.def.range) / (w.def.range * 1.1), w.def.falloff, 1);
        }
        const dealt = br.damage(c, dmg, br.player, best.head, w.def.headMul);
        br.addDamageNumber(c.x, c.y, 0.75, best.head ? dealt + '!' : '' + dealt, best.head);
        br.bloodAt(c.x, c.y, 0.7, best.head ? 12 : 7, c.def.palette.trim);
        return { hit: true, head: best.head, wx: c.x, wy: c.y, wz: 0.7 };
      }

      const hitDist = Math.min(wall.dist, maxR);
      const ux = rdx / rl, uy = rdy / rl;
      const wx = cam.x + ux * (hitDist - 0.02), wy = cam.y + uy * (hitDist - 0.02);
      const wz = cam.eyeZ - (sy - cam.horizon) / cam.D * hitDist * perp;
      if (wall.hit) br.impact(wx, wy, U.clamp(wz, 0.05, 0.98), '#ffd9a0');
      return { hit: false, head: false, wx, wy, wz: U.clamp(wz, 0.05, 1.2) };
    },

    /* --- 操作系のアクション --- */
    prone: false,
    toggleProne(br) {
      this.prone = !this.prone;
      if (this.prone) Input.crouch = false;
      br.emit('stance', this.prone ? 'prone' : 'stand');
      return this.prone;
    },
    interact(br) {
      const p = br.player;
      if (!p || p.state !== 'ground') return null;
      const l = br.lootNear(p, 1.9);
      if (!l) return null;
      const got = br.pickup(p, l);
      if (got) { br.stats.lootPicked++; Haptics.tap('ui'); }
      return got;
    },
    initGyro() {
      const self = this;
      window.addEventListener('deviceorientation', e => {
        // 端末を傾けた量を角速度として使う（絶対角ではなく差分）
        if (e.gamma == null) return;
        const gx = (e.gamma || 0), gy = (e.beta || 0);
        if (self._prevG) {
          self._gyro.x = (gx - self._prevG.x) * 0.06;
          self._gyro.y = (gy - self._prevG.y) * 0.04;
        }
        self._prevG = { x: gx, y: gy };
      });
    }
  };

  g.BRPlayer = BRPlayer;
})(window);
