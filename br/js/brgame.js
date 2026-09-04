/* ===== brgame.js — バトルロイヤルのゲームコア ===============================
 * プレイヤーとBotを同じ「Combatant」として扱い、ダメージ・Loot・Zoneの判定を
 * 一箇所に集約する。描画とUIはこの状態を読むだけ（ロジックを持たない）。
 * ========================================================================= */
(function (g) {
  'use strict';

  const D = () => g.BRDATA;
  const PLAYER_R = 0.30;
  const EYE_STAND = 0.55, EYE_CROUCH = 0.34, EYE_PRONE = 0.18;

  const BR = {
    /* ---------------- 状態 ---------------- */
    state: 'LOBBY',
    t: 0, matchT: 0,
    map: null, seed: 0,
    combatants: [], player: null, bots: [],
    loot: [], projectiles: [], parts: [], tracers: [], dmgNums: [], pickups: [], zones: [],
    enemies: [],                       // 描画用（自分以外の生存/死体）
    zone: null, plane: null,
    aliveCount: 0, killFeed: [],
    shake: 0, shakeYaw: 0, shakePitch: 0, hitstop: 0,
    curZoom: 1, zoomT: 0,
    stats: null,
    _listeners: {},

    /* ---------------- イベント（UI/音を疎結合にする） ---------------- */
    on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); return this; },
    emit(ev, a, b) {
      const l = this._listeners[ev];
      if (l) for (let i = 0; i < l.length; i++) { try { l[i](a, b); } catch (e) { } }
    },

    /* ---------------- 状態遷移（不正な遷移を弾く） ---------------- */
    setState(next) {
      const flow = D().STATE_FLOW[this.state] || [];
      if (this.state === next) return true;
      if (flow.indexOf(next) < 0) {
        console.warn('[BR] 不正な状態遷移:', this.state, '->', next);
        return false;
      }
      const prev = this.state;
      this.state = next;
      this.emit('state', next, prev);
      return true;
    },

    /* =========================================================
     * マッチ生成
     * =======================================================*/
    newMatch(opt) {
      opt = opt || {};
      const M = D().MATCH;
      this.seed = opt.seed || (Date.now() & 0x7fffffff);
      this.map = BRMap.generate(opt.mapSize || M.mapSize, this.seed);
      this.t = 0; this.matchT = 0;
      this.combatants = []; this.bots = []; this.enemies = [];
      this.loot = []; this.projectiles = []; this.parts = [];
      this.tracers = []; this.dmgNums = []; this.pickups = []; this.zones = [];
      this.killFeed = [];
      this.shake = 0; this.hitstop = 0; this.curZoom = 1; this.zoomT = 0;
      this.state = 'LOBBY';
      this.setState('WAITING');

      this.spawnLoot();
      this.player = this.makeCombatant({ isPlayer: true, name: opt.name || 'YOU', avatar: 'br_player' });
      Object.defineProperty(this.player, 'weapon', { get() { return this.weapons[this.wIdx] || null; } });
      this.combatants.push(this.player);

      const botN = opt.bots == null ? M.botCount : opt.bots;
      const names = D().BOT_NAMES.slice();
      for (let i = 0; i < botN; i++) {
        const nm = names.length ? names.splice((Math.random() * names.length) | 0, 1)[0] : 'BOT' + i;
        const b = this.makeCombatant({
          isPlayer: false, name: nm,
          avatar: D().AVATAR_KEYS[i % D().AVATAR_KEYS.length]
        });
        BRBot.init(b, this);
        this.combatants.push(b);
        this.bots.push(b);
      }
      this.aliveCount = this.combatants.length;
      this.stats = { kills: 0, damage: 0, headshots: 0, placement: this.aliveCount, survived: 0, lootPicked: 0 };

      this.initZone();
      this.initPlane();
      this.setState('PLANE');
      this.emit('match', this);
      return this;
    },

    makeCombatant(o) {
      const av = D().AVATARS[o.avatar];
      return {
        id: o.name + '#' + ((Math.random() * 1e6) | 0),
        isPlayer: !!o.isPlayer, name: o.name,
        type: o.avatar, def: av, avatar: o.avatar,
        x: 0, y: 0, z: 0, ang: 0, pitch: 0,
        eyeZ: EYE_STAND, targetEyeZ: EYE_STAND, stance: 'stand',
        alive: true, state: 'plane',          // plane / drop / ground / dead
        hp: 100, maxHp: 100, armor: 0, armorMax: 0, helmet: 0,
        weapons: [null, null], wIdx: 0,
        ammo: { light: 0, medium: 0, heavy: 0, shell: 0 },
        items: { bandage: 0, medkit: 0, energy: 0, frag: 0 },
        kills: 0, damage: 0, placement: 0,
        fireCd: 0, reloading: false, reloadLeft: 0, reloadTotal: 0,
        burstLeft: 0, burstT: 0, semiLatch: false,
        switchT: 0, switchTotal: 0, pendingIdx: -1,
        useT: 0, useItem: null,
        recoilPitch: 0, recoilYaw: 0, recoilVis: 0, flashT: 0,
        bobPhase: 0, bobAmp: 0, moving: false, sprinting: false,
        hurtT: 0, deadT: 0, animT: Math.random() * 3, atkFlash: 0,
        alertT: 0, showBarT: 0, lastCrit: false, windupT: 0,
        speedBuff: 0, shots: 0, hits: 0, headshots: 0,
        scr: null, bot: null
      };
    },

    /** 武器の総合的な強さ。拾う/持ち替えの判断に使う */
    weaponScore(w) {
      if (!w) return -1;
      const def = w.def || w;
      const CLS = { PISTOL: 0, SMG: 2, SHOTGUN: 2, AR: 4, LMG: 4, DMR: 4, SNIPER: 5 };
      const TIER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
      return (CLS[def.cls] || 0) * 10 + (TIER[def.tier] || 0) * 4 + def.damage * 0.1;
    },

    /** 手持ちの武器（無ければ null）。描画側が player.weapon を参照する */
    equipWeapon(c) { return c.weapons[c.wIdx] || null; },

    /** 空スロットを選んだままにならないよう wIdx を正す */
    normalizeSlot(c) {
      if (!c.weapons[c.wIdx] && c.weapons[1 - c.wIdx]) c.wIdx = 1 - c.wIdx;
    },

    /* =========================================================
     * Loot
     * =======================================================*/
    spawnLoot() {
      const dd = D();
      const spots = this.map.lootSpots;
      const rnd = Math.random;
      spots.forEach(s => {
        const tbl = dd.LOOT_TABLES[s.area] || dd.LOOT_TABLES.field;
        const total = tbl.weapon + tbl.ammo + tbl.heal + tbl.armor + tbl.throw;
        let r = rnd() * total;
        let kind;
        if ((r -= tbl.weapon) < 0) kind = 'weapon';
        else if ((r -= tbl.ammo) < 0) kind = 'ammo';
        else if ((r -= tbl.heal) < 0) kind = 'heal';
        else if ((r -= tbl.armor) < 0) kind = 'armor';
        else kind = 'throw';
        const item = this.rollLoot(kind, tbl.tierBoost);
        if (item) this.loot.push(Object.assign({ x: s.x, y: s.y, t: rnd() * 6, alive: true, indoor: s.indoor }, item));
      });
      this.emit('loot', this.loot.length);
    },

    /** レアリティ重みに tierBoost を掛けて抽選する */
    rollLoot(kind, boost) {
      const dd = D();
      const pickByTier = list => {
        let total = 0;
        const ws = list.map(o => {
          const rw = dd.RARITY[o.tier] ? dd.RARITY[o.tier].w : 50;
          const bias = Math.pow(boost || 1, ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(o.tier));
          const v = rw * bias; total += v; return v;
        });
        let r = Math.random() * total;
        for (let i = 0; i < list.length; i++) { if ((r -= ws[i]) < 0) return list[i]; }
        return list[0];
      };
      if (kind === 'weapon') {
        const w = pickByTier(dd.WEAPONS);
        return { kind: 'weapon', id: w.id, tier: w.tier, name: w.name, count: 1 };
      }
      if (kind === 'ammo') {
        const types = ['light', 'medium', 'heavy', 'shell'];
        const a = types[(Math.random() * types.length) | 0];
        const n = a === 'heavy' ? 8 + ((Math.random() * 10) | 0)
          : a === 'shell' ? 6 + ((Math.random() * 8) | 0)
            : 24 + ((Math.random() * 24) | 0);
        return { kind: 'ammo', id: a, tier: 'common', name: dd.AMMO[a].name, count: n };
      }
      if (kind === 'heal') {
        const list = [dd.ITEMS.bandage, dd.ITEMS.bandage, dd.ITEMS.medkit, dd.ITEMS.energy];
        const it = pickByTier(list);
        return { kind: 'item', id: it.id, tier: it.tier, name: it.name, count: it.id === 'bandage' ? 2 : 1 };
      }
      if (kind === 'armor') {
        const list = [dd.ITEMS.armor1, dd.ITEMS.armor2, dd.ITEMS.armor3,
        dd.ITEMS.helm1, dd.ITEMS.helm2, dd.ITEMS.helm3];
        const it = pickByTier(list);
        return { kind: 'item', id: it.id, tier: it.tier, name: it.name, count: 1 };
      }
      const it = dd.ITEMS.frag;
      return { kind: 'item', id: it.id, tier: it.tier, name: it.name, count: 1 + ((Math.random() * 2) | 0) };
    },

    /** 死亡時のドロップ */
    dropLoot(c) {
      const dd = D();
      c.weapons.forEach((w, i) => {
        if (!w) return;
        this.loot.push({
          kind: 'weapon', id: w.def.id, tier: w.def.tier, name: w.def.name, count: 1,
          x: c.x + (i ? 0.5 : -0.5), y: c.y, t: 0, alive: true
        });
      });
      Object.keys(c.ammo).forEach(a => {
        if (c.ammo[a] > 4) this.loot.push({
          kind: 'ammo', id: a, tier: 'common', name: dd.AMMO[a].name,
          count: Math.round(c.ammo[a] * 0.6), x: c.x + U.rand(-0.6, 0.6), y: c.y + U.rand(-0.6, 0.6), t: 0, alive: true
        });
      });
      Object.keys(c.items).forEach(k => {
        if (c.items[k] > 0) this.loot.push({
          kind: 'item', id: k, tier: dd.ITEMS[k].tier, name: dd.ITEMS[k].name,
          count: c.items[k], x: c.x + U.rand(-0.8, 0.8), y: c.y + U.rand(-0.8, 0.8), t: 0, alive: true
        });
      });
      if (c.armorMax > 0) {
        const lvl = c.armorMax >= 120 ? 3 : (c.armorMax >= 80 ? 2 : 1);
        const it = dd.ITEMS['armor' + lvl];
        this.loot.push({ kind: 'item', id: it.id, tier: it.tier, name: it.name, count: 1, x: c.x + 0.9, y: c.y, t: 0, alive: true });
      }
    },

    /* =========================================================
     * インベントリ
     * =======================================================*/
    makeWeapon(id) {
      const def = D().WEAPON_BY_ID[id];
      if (!def) return null;
      // 描画側(render.js)は id / zoom / base.color / flash を見るので合わせておく
      return {
        def, id, mag: def.mag, magMax: def.mag,
        zoom: def.zoom || 1, base: { color: def.color }, flash: 0.35
      };
    },

    /** 拾えるものが足元にあるか */
    lootNear(c, radius) {
      let best = null, bd = (radius || 1.6) * (radius || 1.6);
      for (let i = 0; i < this.loot.length; i++) {
        const l = this.loot[i];
        if (!l.alive) continue;
        const d = U.dist2(l.x, l.y, c.x, c.y);
        if (d < bd) { bd = d; best = l; }
      }
      return best;
    },

    /** @returns {string|null} 取得した内容の説明。拾えなければ null */
    pickup(c, l) {
      if (!l || !l.alive) return null;
      const dd = D();
      if (l.kind === 'weapon') {
        // 両手が塞がっている場合、Botは「弱い方」を捨てる。
        // 装備中スロットを機械的に置き換えると、捨てた武器をまた拾って
        // 無限に持ち替え続ける（Lootが際限なく増える）ため。
        let slot;
        if (!c.weapons[0]) slot = 0;
        else if (!c.weapons[1]) slot = 1;
        else if (c.isPlayer) slot = c.wIdx;
        else slot = this.weaponScore(c.weapons[0]) <= this.weaponScore(c.weapons[1]) ? 0 : 1;
        const old = c.weapons[slot];
        if (old) {
          this.loot.push({
            kind: 'weapon', id: old.def.id, tier: old.def.tier, name: old.def.name,
            count: 1, x: c.x, y: c.y, t: 0, alive: true
          });
        }
        c.weapons[slot] = this.makeWeapon(l.id);
        if (!old) c.wIdx = slot;
        l.alive = false;
        this.emit('pickup', c, l);
        return l.name;
      }
      if (l.kind === 'ammo') {
        const cap = dd.AMMO[l.id].stack;
        const before = c.ammo[l.id];
        c.ammo[l.id] = Math.min(cap, before + l.count);
        if (c.ammo[l.id] === before) return null;
        l.count -= (c.ammo[l.id] - before);
        if (l.count <= 0) l.alive = false;
        this.emit('pickup', c, l);
        return dd.AMMO[l.id].name + ' x' + (c.ammo[l.id] - before);
      }
      const def = dd.ITEMS[l.id];
      if (!def) return null;
      if (def.kind === 'armor') {
        if (c.armorMax >= def.ap) return null;           // 下位互換の装甲は拾わない
        if (c.armorMax > 0) {
          const lvl = c.armorMax >= 120 ? 3 : (c.armorMax >= 80 ? 2 : 1);
          const old = dd.ITEMS['armor' + lvl];
          this.loot.push({ kind: 'item', id: old.id, tier: old.tier, name: old.name, count: 1, x: c.x, y: c.y, t: 0, alive: true });
        }
        c.armorMax = def.ap; c.armor = def.ap;
        l.alive = false; this.emit('pickup', c, l);
        return def.name;
      }
      if (def.kind === 'helmet') {
        if (c.helmet >= def.level) return null;
        c.helmet = def.level;
        l.alive = false; this.emit('pickup', c, l);
        return def.name;
      }
      const cap = def.stack || 1;
      const before = c.items[l.id] || 0;
      if (before >= cap) return null;
      const take = Math.min(cap - before, l.count);
      c.items[l.id] = before + take;
      l.count -= take;
      if (l.count <= 0) l.alive = false;
      this.emit('pickup', c, l);
      return def.name + ' x' + take;
    },

    useItem(c, id) {
      const def = D().ITEMS[id];
      if (!def || !(c.items[id] > 0) || c.useT > 0 || c.reloading) return false;
      if (def.kind === 'heal' && c.hp >= c.maxHp) return false;
      c.useT = def.useTime;
      c.useItem = id;
      this.emit('use_start', c, id);
      return true;
    },

    finishUse(c) {
      const id = c.useItem;
      const def = D().ITEMS[id];
      c.useItem = null; c.useT = 0;
      if (!def || !(c.items[id] > 0)) return;
      c.items[id]--;
      if (def.heal) c.hp = Math.min(c.maxHp, c.hp + def.heal);
      if (def.speed) c.speedBuff = def.dur;
      this.emit('use_end', c, id);
    },

    switchWeapon(c, idx) {
      if (c.switchT > 0 || c.useT > 0) return false;
      const next = idx == null ? (c.wIdx === 0 ? 1 : 0) : idx;
      if (next === c.wIdx || !c.weapons[next]) return false;
      c.pendingIdx = next;
      c.switchTotal = 0.42; c.switchT = 0.42;
      c.reloading = false; c.reloadLeft = 0;
      this.emit('switch', c);
      return true;
    },

    tryReload(c) {
      const w = c.weapons[c.wIdx];
      if (!w || c.reloading || c.switchT > 0 || c.useT > 0) return false;
      if (w.mag >= w.magMax) return false;
      if ((c.ammo[w.def.ammo] || 0) <= 0) return false;
      c.reloading = true;
      c.reloadTotal = w.def.reload;
      c.reloadLeft = w.def.reload;
      this.emit('reload_start', c);
      return true;
    },

    finishReload(c) {
      const w = c.weapons[c.wIdx];
      c.reloading = false; c.reloadLeft = 0;
      if (!w) return;
      const type = w.def.ammo;
      const need = w.magMax - w.mag;
      const take = Math.min(need, c.ammo[type] || 0);
      w.mag += take; c.ammo[type] -= take;
      this.emit('reload_end', c);
    },

    /* =========================================================
     * ダメージ
     * =======================================================*/
    /**
     * @param {object} target 被弾者
     * @param {number} amount 素のダメージ
     * @param {object} src    加害者（null可）
     * @param {boolean} head  頭部命中
     */
    damage(target, amount, src, head, headMul) {
      if (!target.alive || target.state === 'dead') return 0;
      if (head) {
        amount *= (headMul || 2.0);
        amount *= (1 - [0, 0.20, 0.35, 0.50][target.helmet]);
      }
      amount = Math.max(1, amount);
      let left = amount;
      if (target.armor > 0) {
        const absorbed = Math.min(target.armor, left * 0.55);
        target.armor -= absorbed;
        left -= absorbed;
      }
      target.hp -= left;
      target.hurtT = 0.16;
      target.showBarT = 2.5;
      target.lastCrit = !!head;
      const dealt = Math.round(amount);
      if (src) {
        src.damage += dealt;
        if (src.isPlayer) {
          this.stats.damage += dealt;
          if (head) { src.headshots++; this.stats.headshots++; }
        }
      }
      if (target.isPlayer) this.emit('player_hurt', dealt, src);
      this.emit('damaged', target, dealt, src, head);
      if (target.hp <= 0) this.kill(target, src);
      return dealt;
    },

    kill(target, src) {
      if (!target.alive) return;
      target.alive = false;
      target.hp = 0;
      target.state = 'dead';
      target.deadT = 0;
      target.placement = this.aliveCount;
      this.aliveCount--;
      if (src && src !== target) {
        src.kills++;
        if (src.isPlayer) this.stats.kills++;
      }
      this.dropLoot(target);
      this.killFeed.unshift({
        killer: src ? src.name : 'ZONE', victim: target.name, t: 3.5,
        byPlayer: !!(src && src.isPlayer), victimPlayer: target.isPlayer
      });
      if (this.killFeed.length > 6) this.killFeed.pop();
      this.emit('kill', target, src);
      if (target.isPlayer) {
        this.stats.placement = target.placement;
        this.stats.survived = this.matchT;
        this.finishMatch(false);
      } else if (this.player.alive && this.aliveCount <= 1) {
        this.stats.placement = 1;
        this.stats.survived = this.matchT;
        this.finishMatch(true);
      }
    },

    finishMatch(won) {
      if (this.state === 'VICTORY' || this.state === 'DEFEAT' || this.state === 'RESULT') return;
      this.setState(won ? 'VICTORY' : 'DEFEAT');
      this.emit('finish', won, this.stats);
    },

    /* =========================================================
     * 安全地帯
     * =======================================================*/
    initZone() {
      const M = D().MATCH, m = this.map;
      this.zone = {
        phase: 0, cx: m.center.x, cy: m.center.y, r: M.startRadius,
        nextCx: m.center.x, nextCy: m.center.y, nextR: M.startRadius,
        timer: D().ZONE_PHASES[0].wait, shrinking: false, dps: 0, done: false
      };
      this.planNextZone();
    },

    /** 次の安全地帯を疑似ランダムに決める。中心は現在円の内側に寄せる */
    planNextZone() {
      const z = this.zone, ph = D().ZONE_PHASES[z.phase];
      if (!ph) { z.done = true; return; }
      const m = this.map;
      let best = null;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * Math.max(0, z.r - ph.r);
        const nx = z.cx + Math.cos(a) * dist, ny = z.cy + Math.sin(a) * dist;
        // 陸地の割合が高い中心を優先する（海だけの最終円を避ける）
        let land = 0, total = 0;
        for (let s = 0; s < 24; s++) {
          const sa = s / 24 * Math.PI * 2;
          for (const rr of [0.35, 0.7]) {
            const px = Math.round(nx + Math.cos(sa) * ph.r * rr);
            const py = Math.round(ny + Math.sin(sa) * ph.r * rr);
            total++;
            if (px >= 0 && py >= 0 && px < m.w && py < m.h && m.grid[py * m.w + px] !== BRMap.WATER) land++;
          }
        }
        const score = land / total;
        if (!best || score > best.score) best = { x: nx, y: ny, score };
        if (score > 0.85) break;
      }
      z.nextCx = best.x; z.nextCy = best.y; z.nextR = ph.r;
    },

    updateZone(dt) {
      const z = this.zone;
      if (!z || z.done) return;
      const ph = D().ZONE_PHASES[z.phase];
      if (!ph) { z.done = true; return; }
      z.timer -= dt;
      if (!z.shrinking) {
        if (z.timer <= 0) {
          z.shrinking = true;
          z.timer = ph.shrink;
          z._fromR = z.r; z._fromX = z.cx; z._fromY = z.cy;
          z.dps = ph.dps;
          this.emit('zone_shrink', z.phase + 1);
        }
      } else {
        const k = 1 - U.clamp(z.timer / ph.shrink, 0, 1);
        z.r = U.lerp(z._fromR, z.nextR, k);
        z.cx = U.lerp(z._fromX, z.nextCx, k);
        z.cy = U.lerp(z._fromY, z.nextCy, k);
        if (z.timer <= 0) {
          z.r = z.nextR; z.cx = z.nextCx; z.cy = z.nextCy;
          z.phase++;
          const nx = D().ZONE_PHASES[z.phase];
          if (!nx) { z.done = true; z.shrinking = false; }
          else {
            z.shrinking = false; z.timer = nx.wait;
            this.planNextZone();
            this.emit('zone_next', z.phase + 1);
          }
        }
      }
      // 圏外ダメージ
      const dmg = (z.dps || ph.dps) * dt;
      for (let i = 0; i < this.combatants.length; i++) {
        const c = this.combatants[i];
        if (!c.alive || c.state !== 'ground') continue;
        const d = U.dist(c.x, c.y, z.cx, z.cy);
        if (d > z.r) {
          c._zoneAcc = (c._zoneAcc || 0) + dmg;
          if (c._zoneAcc >= 1) {
            const n = Math.floor(c._zoneAcc);
            c._zoneAcc -= n;
            this.damage(c, n, null, false);
            if (c.isPlayer) this.emit('zone_damage', n);
          }
        } else c._zoneAcc = 0;
      }
    },

    inZone(c) {
      const z = this.zone;
      return !z || U.dist(c.x, c.y, z.cx, z.cy) <= z.r;
    },

    /* =========================================================
     * 輸送機と降下
     * =======================================================*/
    initPlane() {
      const m = this.map, M = D().MATCH;
      const a = Math.random() * Math.PI * 2;
      const half = m.w * 0.75;
      this.plane = {
        x: m.center.x - Math.cos(a) * half, y: m.center.y - Math.sin(a) * half,
        dx: Math.cos(a), dy: Math.sin(a), speed: 13, t: 0, alt: M.planeAlt, done: false
      };
      // Botは航路上のランダムなタイミングで降りる
      this.bots.forEach(b => { b.bot.dropAt = U.rand(0.12, 0.86); });
    },

    updatePlane(dt) {
      const p = this.plane, m = this.map;
      p.t += dt;
      p.x += p.dx * p.speed * dt;
      p.y += p.dy * p.speed * dt;
      const prog = U.clamp((U.dist(p.x, p.y, m.center.x, m.center.y) < m.w
        ? (p.t * p.speed) / (m.w * 1.5) : 1), 0, 1);
      p.progress = prog;

      // 機内のCombatantを機体に追従させる
      this.combatants.forEach(c => {
        if (c.state === 'plane') { c.x = p.x; c.y = p.y; c.z = p.alt; }
      });
      // Bot降下
      this.bots.forEach(b => {
        if (b.state === 'plane' && prog >= b.bot.dropAt) this.startDrop(b);
      });
      // 航路の終端で強制降下
      if (prog >= 0.98) {
        this.combatants.forEach(c => { if (c.state === 'plane') this.startDrop(c); });
        p.done = true;
      }
      if (this.state === 'PLANE' && this.player.state !== 'plane') this.setState('DROP');
    },

    startDrop(c) {
      if (c.state !== 'plane') return;
      c.state = 'drop';
      c.chute = false;
      c.vz = -D().MATCH.fallSpeed;
      if (!c.isPlayer) {
        // Botは狙う着地点を決める（ルートの多い場所を好む）
        const lm = this.map.landmarks;
        const pick = lm[(Math.random() * lm.length) | 0];
        c.bot.landX = pick.x + U.rand(-pick.r, pick.r);
        c.bot.landY = pick.y + U.rand(-pick.r, pick.r);
      }
      this.emit('drop', c);
    },

    updateDrop(dt) {
      const M = D().MATCH;
      this.combatants.forEach(c => {
        if (c.state !== 'drop') return;
        // 高度
        if (c.z <= M.parachuteAt && !c.chute) { c.chute = true; this.emit('chute', c); }
        const fall = c.chute ? M.chuteSpeed : M.fallSpeed;
        c.z = Math.max(0, c.z - fall * dt);

        // 水平移動
        let mx = 0, my = 0;
        if (c.isPlayer) {
          const mv = Input.move;
          const f = Math.cos(c.ang), s = Math.sin(c.ang);
          mx = f * mv.y - s * -mv.x;
          my = s * mv.y + f * -mv.x;
        } else {
          const dx = c.bot.landX - c.x, dy = c.bot.landY - c.y;
          const d = Math.hypot(dx, dy) || 1;
          mx = dx / d; my = dy / d;
          c.ang = Math.atan2(dy, dx);
        }
        const gl = c.chute ? M.glideSpeed : M.glideSpeed * 1.6;
        const nx = c.x + mx * gl * dt, ny = c.y + my * gl * dt;
        c.x = U.clamp(nx, 1, this.map.w - 1);
        c.y = U.clamp(ny, 1, this.map.h - 1);

        if (c.z <= M.landAt) {
          this.land(c);
        }
      });
      if (this.player.state === 'ground' && this.state === 'DROP') this.setState('EARLY_GAME');
    },

    land(c) {
      c.z = 0;
      c.state = 'ground';
      c.chute = false;
      this.dustAt(c.x, c.y, 0.04, 10, 1.5);      // 着地の砂ぼこり
      // 水や壁の上に降りたら最寄りの地面へ寄せる
      const m = this.map;
      if (this.solidAt(c.x, c.y)) {
        let best = null, bd = 1e9;
        for (let i = 0; i < m.spawnable.length; i++) {
          const s = m.spawnable[i];
          const d = U.dist2(s.x, s.y, c.x, c.y);
          if (d < bd) { bd = d; best = s; }
        }
        if (best) { c.x = best.x; c.y = best.y; }
      }
      this.emit('land', c);
    },

    solidAt(x, y) {
      const m = this.map;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
      return m.grid[(y | 0) * m.w + (x | 0)] !== 0;
    },

    moveWithCollision(c, dx, dy, r) {
      const m = this.map;
      const free = (x, y) => {
        const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
        const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
          if (m.grid[cy * m.w + cx] !== 0) return false;
        }
        return true;
      };
      if (free(c.x + dx, c.y)) c.x += dx;
      if (free(c.x, c.y + dy)) c.y += dy;
      c.x = U.clamp(c.x, r + 0.01, m.w - r - 0.01);
      c.y = U.clamp(c.y, r + 0.01, m.h - r - 0.01);
    },

    los(ax, ay, bx, by) {
      return Render.los(this.map, ax, ay, bx, by);
    },

    /* =========================================================
     * 更新
     * =======================================================*/
    update(dtRaw) {
      let dt = dtRaw;
      if (this.hitstop > 0) { this.hitstop -= dtRaw; dt = dtRaw * 0.16; }
      dt = Math.min(dt, 0.05);
      this.t += dtRaw;

      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 4.2);
        this.shakeYaw = (Math.random() - 0.5) * this.shake * 0.035;
        this.shakePitch = (Math.random() - 0.5) * this.shake * 0.018;
      } else { this.shakeYaw = 0; this.shakePitch = 0; }

      switch (this.state) {
        case 'PLANE': this.updatePlane(dt); break;
        case 'DROP': this.updatePlane(dt); this.updateDrop(dt); break;
        case 'EARLY_GAME': case 'MID_GAME': case 'LATE_GAME': case 'FINAL_ZONE':
          this.matchT += dtRaw;
          // プレイヤーが着地した後も、機内に残ったBotを降ろすため輸送機を動かし続ける
          if (this.plane && !this.plane.done) this.updatePlane(dt);
          this.updateDrop(dt);
          this.updateZone(dt);
          this.updatePhase();
          break;
        default: break;
      }

      if (this.state !== 'LOBBY' && this.state !== 'WAITING') {
        this.updateCombatants(dt);
        this.updateProjectiles(dt);
        this.updateFx(dt);
        this.refreshEnemyList();
      }
      this.killFeed.forEach(k => k.t -= dtRaw);
      this.killFeed = this.killFeed.filter(k => k.t > 0);
    },

    /** 残り人数とZoneフェーズから MatchState を進める */
    updatePhase() {
      const z = this.zone;
      let want = this.state;
      if (z.done || z.phase >= 5) want = 'FINAL_ZONE';
      else if (z.phase >= 3 || this.aliveCount <= 4) want = 'LATE_GAME';
      else if (z.phase >= 1 || this.aliveCount <= 10) want = 'MID_GAME';
      if (want !== this.state) {
        // 段階は飛ばさず1つずつ進める
        const order = ['EARLY_GAME', 'MID_GAME', 'LATE_GAME', 'FINAL_ZONE'];
        const cur = order.indexOf(this.state), tgt = order.indexOf(want);
        if (cur >= 0 && tgt > cur) this.setState(order[cur + 1]);
      }
    },

    updateCombatants(dt) {
      for (let i = 0; i < this.combatants.length; i++) {
        const c = this.combatants[i];
        c.animT += dt;
        this.normalizeSlot(c);
        if (c.hurtT > 0) c.hurtT -= dt;
        if (c.showBarT > 0) c.showBarT -= dt;
        if (c.atkFlash > 0) c.atkFlash -= dt;
        if (c.alertT > 0) c.alertT -= dt;
        if (c.speedBuff > 0) c.speedBuff -= dt;
        if (!c.alive) { c.deadT += dt; continue; }
        if (c.state !== 'ground') continue;

        c.fireCd -= dt;
        c.flashT = Math.max(0, c.flashT - dt * 3.4);
        c.recoilVis = Math.max(0, c.recoilVis - dt * 14);
        if (c.switchT > 0) {
          c.switchT -= dt;
          if (c.switchT <= c.switchTotal * 0.5 && c.pendingIdx >= 0) {
            c.wIdx = c.pendingIdx; c.pendingIdx = -1;
            if (c.isPlayer) this.emit('weapon', c);
          }
          if (c.switchT < 0) c.switchT = 0;
        }
        if (c.reloading) {
          c.reloadLeft -= dt;
          if (c.reloadLeft <= 0) this.finishReload(c);
        }
        if (c.useT > 0) {
          c.useT -= dt;
          if (c.useT <= 0) this.finishUse(c);
        }
        if (c.burstLeft > 0) {
          c.burstT -= dt;
          const w = c.weapons[c.wIdx];
          if (!w || w.mag <= 0) c.burstLeft = 0;
          else if (c.burstT <= 0) { this.fire(c); c.burstLeft--; c.burstT = w.def.burstGap || 0.075; }
        }
        // 走っている足元から小さな砂ぼこりを立てる（近くだけ）
        if (c.moving && c.stance === 'stand') {
          c._stepT = (c._stepT || 0) + dt * (c.sprinting ? 3.4 : 2.2);
          if (c._stepT >= 1) {
            c._stepT = 0;
            if (U.dist2(c.x, c.y, this.player.x, this.player.y) < 900) {
              this.dustAt(c.x, c.y, 0.02, c.sprinting ? 3 : 2, 0.5);
            }
          }
        }
        if (!c.isPlayer) BRBot.update(c, this, dt);
      }
    },

    refreshEnemyList() {
      const out = [];
      for (let i = 0; i < this.combatants.length; i++) {
        const c = this.combatants[i];
        if (c === this.player) continue;
        if (c.state === 'plane') continue;
        if (!c.alive && c.deadT > 8) continue;
        out.push(c);
      }
      this.enemies = out;
    },

    /* =========================================================
     * 射撃
     * =======================================================*/
    fire(c) {
      const w = c.weapons[c.wIdx];
      if (!w || w.mag <= 0) return false;
      w.mag--;
      c.shots++;
      c.fireCd = 60 / w.def.rpm;
      c.flashT = 0.11;
      c.atkFlash = 0.18;
      c.recoilVis = Math.min(3.2, c.recoilVis + w.def.recoil * 0.9);
      const rc = w.def.recoil * 0.004;
      c.pitch = U.clamp(c.pitch + rc, -0.42, 0.42);
      c.recoilPitch -= rc;
      const ry = (Math.random() - 0.5) * rc * 0.9;
      c.ang += ry; c.recoilYaw -= ry;
      this.emit('shot', c, w);
      if (c.isPlayer) this.addShake(w.def.recoil * 0.45);
      this.makeNoise(c, w.def.cls === 'SNIPER' ? 60 : 42);
      return true;
    },

    addShake(v) { this.shake = Math.min(6, this.shake + v); },

    makeNoise(c, radius) {
      for (let i = 0; i < this.bots.length; i++) {
        const b = this.bots[i];
        if (!b.alive || b === c || b.state !== 'ground') continue;
        if (U.dist2(b.x, b.y, c.x, c.y) < radius * radius) BRBot.hearNoise(b, c, this);
      }
    },

    /** グレネード投擲。壁で跳ね、信管が切れたら爆発する */
    throwFrag(c) {
      if (!(c.items.frag > 0) || c.useT > 0 || c.switchT > 0) return false;
      const def = D().ITEMS.frag;
      c.items.frag--;
      this.projectiles.push({
        alive: true, kind: 'frag', owner: c,
        x: c.x + Math.cos(c.ang) * 0.5, y: c.y + Math.sin(c.ang) * 0.5, z: 0.7,
        dx: Math.cos(c.ang), dy: Math.sin(c.ang), speed: 13, vz: 2.6,
        life: def.fuse, dmg: def.dmg, radius: def.radius, r: 0.13, color: '#ffd23f'
      });
      this.emit('throw', c);
      return true;
    },

    /** 範囲ダメージ。遮蔽の裏には届かない */
    explode(x, y, z, radius, dmg, src) {
      this.dustAt(x, y, z, 14, 2.4, '#b9b0a2');
      this.sparkAt(x, y, z, 10, '#ffb44a');
      const hits = [];
      for (let i = 0; i < this.combatants.length; i++) {
        const c = this.combatants[i];
        if (!c.alive || c.state !== 'ground') continue;
        const d = U.dist(x, y, c.x, c.y);
        if (d > radius + c.def.radius) continue;
        if (!this.los(x, y, c.x, c.y)) continue;
        hits.push({ c, mul: U.clamp(1 - d / (radius + c.def.radius), 0.25, 1) });
      }
      hits.forEach(h => this.damage(h.c, dmg * h.mul, src, false));
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * U.TAU, s = U.rand(1.5, 6.5);
        this.parts.push({
          alive: true, x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(0.5, 4.5),
          size: U.rand(0.03, 0.08), color: U.pick(['#fff3b0', '#ff9f4a', '#ff5f4a']), add: true,
          life: U.rand(0.25, 0.6), maxLife: 0.6, grav: 5
        });
      }
      this.trimParts();
      const dp = U.dist(x, y, this.player.x, this.player.y);
      if (dp < 22) this.addShake(U.clamp(3 - dp * 0.12, 0.4, 3));
      this.emit('explosion', x, y);
      this.makeNoise({ x, y }, 55);
      return hits.length;
    },

    spawnBullet(o) {
      this.projectiles.push(Object.assign({
        alive: true, z: 0.55, r: 0.06, life: 3, color: '#ffe08f'
      }, o));
      if (this.projectiles.length > 120) this.projectiles.shift();
    },

    updateProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        if (!p.alive) { this.projectiles.splice(i, 1); continue; }
        p.life -= dt;
        if (p.life <= 0 && p.kind !== 'frag') { p.alive = false; continue; }
        if (p.kind === 'frag') {
          // 放物線 + 壁で反射
          p.vz -= 9.0 * dt;
          p.z = Math.max(0.06, p.z + p.vz * dt);
          if (p.z <= 0.06 && p.vz < 0) { p.vz *= -0.35; p.speed *= 0.6; }
          const nx = p.x + p.dx * p.speed * dt, ny = p.y + p.dy * p.speed * dt;
          if (this.solidAt(nx, p.y)) { p.dx *= -0.5; p.speed *= 0.7; }
          else p.x = nx;
          if (this.solidAt(p.x, ny)) { p.dy *= -0.5; p.speed *= 0.7; }
          else p.y = ny;
          if (p.life <= 0) { this.explode(p.x, p.y, p.z, p.radius, p.dmg, p.owner); p.alive = false; }
          continue;
        }
        const step = p.speed * dt;
        const steps = Math.max(1, Math.ceil(step / 0.4));
        for (let s = 0; s < steps && p.alive; s++) {
          const nx = p.x + p.dx * (step / steps), ny = p.y + p.dy * (step / steps);
          if (this.solidAt(nx, ny)) { this.impact(p.x, p.y, p.z, p.color); p.alive = false; break; }
          p.x = nx; p.y = ny;
          for (let k = 0; k < this.combatants.length; k++) {
            const c = this.combatants[k];
            if (!c.alive || c.state !== 'ground' || c === p.owner) continue;
            if (U.dist2(p.x, p.y, c.x, c.y) < 0.20) {
              const head = Math.random() < 0.14;
              this.damage(c, p.dmg, p.owner, head, p.headMul);
              this.impact(p.x, p.y, p.z, p.color);
              p.alive = false; break;
            }
          }
        }
      }
    },

    /** 砂ぼこり。着地・足音・爆発に使う */
    dustAt(x, y, z, n, spread, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * U.TAU, sp = U.rand(0.2, 1) * (spread || 1);
        this.parts.push({
          alive: true, kind: 'dust', x, y, z: z + U.rand(0, 0.06),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(0.15, 0.7),
          size: U.rand(0.05, 0.11) * (spread || 1), color: color || '#cbb894',
          alpha: U.rand(0.28, 0.5), life: U.rand(0.35, 0.8), maxLife: 0.8, grav: 0.8
        });
      }
      this.trimParts();
    },

    /** 着弾の火花 */
    sparkAt(x, y, z, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * U.TAU, sp = U.rand(1.2, 3.4);
        this.parts.push({
          alive: true, kind: 'spark', x, y, z,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(1.0, 3.2),
          size: U.rand(0.02, 0.05), color: color || '#ffd08a',
          life: U.rand(0.1, 0.26), maxLife: 0.26, grav: 7
        });
      }
      this.trimParts();
    },

    impact(x, y, z, color) {
      this.sparkAt(x, y, z, 4, color || '#ffd9a0');
      this.dustAt(x, y, z, 2, 0.45, '#d8cdb6');
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * U.TAU, s = U.rand(0.5, 2.0);
        this.parts.push({
          alive: true, x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(0.5, 2.4),
          size: U.rand(0.01, 0.026), color: color || '#ffd9a0', add: true,
          life: U.rand(0.12, 0.3), maxLife: 0.3, grav: 5
        });
      }
      this.trimParts();
    },

    bloodAt(x, y, z, n, color) {
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

    trimParts() { if (this.parts.length > 220) this.parts.splice(0, this.parts.length - 220); },

    addTracer(sx0, sy0, x1, y1, z1, color) {
      this.tracers.push({ alive: true, sx0, sy0, x1, y1, z1, color: color || '#fff', life: 0.07, maxLife: 0.07 });
      if (this.tracers.length > 40) this.tracers.shift();
    },

    addDamageNumber(x, y, z, text, crit) {
      this.dmgNums.push({
        alive: true, x: x + U.rand(-.2, .2), y: y + U.rand(-.2, .2), z, text, crit,
        rise: 0, life: 0.85, maxLife: 0.85, tilt: U.rand(-0.22, 0.22)
      });
      if (this.dmgNums.length > 24) this.dmgNums.shift();
    },

    updateFx(dt) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life -= dt;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.z += p.vz * dt; p.vz -= p.grav * dt;
        if (p.z < 0.02) { p.z = 0.02; p.vz *= -0.32; p.vx *= 0.6; p.vy *= 0.6; }
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
      this.loot.forEach(l => { l.t += dt; });
      this.pickups = this.loot.filter(l => l.alive);
      if (this.loot.length - this.pickups.length > 160) this.loot = this.pickups.slice();
    }
  };

  g.BR = BR;
})(window);
