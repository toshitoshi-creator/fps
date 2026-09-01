/* ===== save.js — persistent progress (localStorage) ===== */
(function (g) {
  'use strict';
  const KEY = 'steel_protocol_save_v1';
  const DEFAULT_SENS = 200;      // 画面幅いっぱいの1スワイプでおよそ115度振り向ける
  const MAX_LEVEL = 30;
  // レベル L → L+1 に必要な経験値
  function xpForLevel(l) { return Math.round(80 * Math.pow(l, 1.42)); }
  // エイムアシストの強さ（当たり判定の横幅倍率）
  const AIM_LEVELS = { OFF: 1.0, LOW: 1.15, MED: 1.32, HIGH: 1.55 };

  function defaultSave() {
    const wu = {};
    DATA.WEAPONS.forEach(w => { wu[w.id] = { dmg: 0, mag: 0, rld: 0, ctl: 0 }; });
    return {
      v: 1,
      coins: 0,
      cleared: [],                 // クリア済みステージ id
      ranks: {},                   // stageId -> ランク (S/A/B/C/D)
      stars: {},                   // stageId -> 星の数 (1..3)
      bestTime: {},                // stageId -> 秒
      level: 1, xp: 0, totalXp: 0,
      headshots: 0, bestCombo: 0,
      unlocked: ['ar'],            // weapon ids owned
      equipped: 'ar',
      wUpg: wu,                    // per-weapon upgrade levels
      pUpg: { hp: 0, spd: 0, amo: 0, arm: 0, crt: 0 },
      settings: {
        sens: DEFAULT_SENS, sfx: 1, bgm: 1, shake: 1, lefty: 0,
        quality: 'AUTO', aim: 'MED', vibrate: 1, skin: 'POP'
      },
      setRev: 1,
      totalKills: 0, totalPlays: 0, seenTutorial: 0
    };
  }

  const Save = {
    data: null,

    load() {
      let d = null;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) d = JSON.parse(raw);
      } catch (e) { d = null; }
      const def = defaultSave();
      if (!d || typeof d !== 'object' || d.v !== def.v) d = def;
      const hadSetRev = !!d.setRev;      // 判定は必ずマージ前の生データで行う
      // deep-merge so new fields survive older saves
      this.data = Object.assign({}, def, d);
      this.data.settings = Object.assign({}, def.settings, d.settings || {});
      this.data.pUpg = Object.assign({}, def.pUpg, d.pUpg || {});
      this.data.wUpg = Object.assign({}, def.wUpg, d.wUpg || {});
      DATA.WEAPONS.forEach(w => {
        this.data.wUpg[w.id] = Object.assign({ dmg: 0, mag: 0, rld: 0, ctl: 0 }, this.data.wUpg[w.id] || {});
      });
      if (!Array.isArray(this.data.cleared)) this.data.cleared = [];
      if (!this.data.stars || typeof this.data.stars !== 'object') this.data.stars = {};
      this.data.level = U.clamp(this.data.level | 0, 1, MAX_LEVEL) || 1;
      this.data.xp = Math.max(0, this.data.xp | 0);
      this.data.totalXp = Math.max(0, this.data.totalXp | 0);
      this.data.headshots = Math.max(0, this.data.headshots | 0);
      this.data.bestCombo = Math.max(0, this.data.bestCombo | 0);
      // エイムアシストは旧仕様(0/1)から4段階へ移行
      const a = this.data.settings.aim;
      if (a === 1 || a === true) this.data.settings.aim = 'MED';
      else if (a === 0 || a === false) this.data.settings.aim = 'OFF';
      if (!AIM_LEVELS[this.data.settings.aim]) this.data.settings.aim = 'MED';
      if (this.data.settings.vibrate !== 0) this.data.settings.vibrate = 1;
      if (!Array.isArray(this.data.unlocked) || !this.data.unlocked.length) this.data.unlocked = ['ar'];
      if (this.data.unlocked.indexOf('ar') < 0) this.data.unlocked.push('ar');
      if (this.data.unlocked.indexOf(this.data.equipped) < 0) this.data.equipped = 'ar';
      // 旧デフォルト(120)のまま遊んでいた人だけ新デフォルトへ寄せる。自分で変えた値は尊重する
      if (!hadSetRev) {
        if (this.data.settings.sens === 120) this.data.settings.sens = DEFAULT_SENS;
        this.data.setRev = 1;
      }
      this.data.settings.sens = U.clamp(this.data.settings.sens | 0, 60, 400) || DEFAULT_SENS;
      if (this.data.settings.skin !== 'MIL') this.data.settings.skin = 'POP';
      this.data.coins = Math.max(0, this.data.coins | 0);
      return this.data;
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; }
      catch (e) { return false; }
    },

    wipe() {
      try { localStorage.removeItem(KEY); } catch (e) { }
      this.data = defaultSave();
      this.save();
      return this.data;
    },

    /* --- queries --- */
    maxStage() {                       // highest playable built-in stage number
      const n = DATA.builtinStages().length;
      const c = this.data.cleared;
      let m = 1;
      for (let i = 1; i <= n; i++) if (c.indexOf(i) >= 0) m = Math.max(m, i + 1);
      return Math.min(m, n);
    },
    isStageUnlocked(id) {
      if (id === DATA.CUSTOM_ID) return true;      // 自作/スキャンマップは常に開放
      return id === 1 || this.data.cleared.indexOf(id - 1) >= 0;
    },
    owns(wid) { return this.data.unlocked.indexOf(wid) >= 0; },
    ownedWeapons() { return DATA.WEAPONS.filter(w => this.owns(w.id)); },

    /* --- mutations --- */
    addCoins(n) { this.data.coins = Math.max(0, this.data.coins + (n | 0)); this.save(); },
    spend(n) {
      if (this.data.coins < n) return false;
      this.data.coins -= n; this.save(); return true;
    },
    unlockWeapon(wid) {
      if (!this.owns(wid)) { this.data.unlocked.push(wid); this.save(); return true; }
      return false;
    },
    equip(wid) { if (this.owns(wid)) { this.data.equipped = wid; this.save(); } },
    upgradeWeapon(wid, key) {
      const def = DATA.WEAPON_UPGRADES.find(u => u.key === key);
      const lv = this.data.wUpg[wid][key];
      if (!def || lv >= def.max) return 'max';
      const cost = def.cost[lv];
      if (!this.spend(cost)) return 'poor';
      this.data.wUpg[wid][key] = lv + 1; this.save(); return 'ok';
    },
    upgradePlayer(key) {
      const def = DATA.PLAYER_UPGRADES.find(u => u.key === key);
      const lv = this.data.pUpg[key];
      if (!def || lv >= def.max) return 'max';
      const cost = def.cost[lv];
      if (!this.spend(cost)) return 'poor';
      this.data.pUpg[key] = lv + 1; this.save(); return 'ok';
    },
    clearStage(id, rank, timeSec, coins, stars) {
      // スキャンマップのクリアは本編の進行度には数えない（コインと記録は入る）
      if (id !== DATA.CUSTOM_ID && this.data.cleared.indexOf(id) < 0) this.data.cleared.push(id);
      const order = { D: 0, C: 1, B: 2, A: 3, S: 4 };
      const prev = this.data.ranks[id];
      if (!prev || order[rank] > order[prev]) this.data.ranks[id] = rank;
      if (stars) {
        const prevS = this.data.stars[id] || 0;
        if (stars > prevS) this.data.stars[id] = stars;
      }
      const bt = this.data.bestTime[id];
      if (!bt || timeSec < bt) this.data.bestTime[id] = Math.round(timeSec * 10) / 10;
      this.data.coins += (coins | 0);
      const st = DATA.STAGES.find(s => s.id === id);
      let newWeapon = null;
      if (st && st.unlockWeapon && !this.owns(st.unlockWeapon)) {
        this.data.unlocked.push(st.unlockWeapon);
        newWeapon = DATA.WEAPON_BY_ID[st.unlockWeapon];
      }
      this.save();
      return newWeapon;
    },

    /* --- レベル / 経験値 --- */
    MAX_LEVEL,
    xpForLevel,
    AIM_LEVELS,
    aimAssist() { return AIM_LEVELS[this.data.settings.aim] || 1.32; },
    levelInfo() {
      const lv = this.data.level;
      const need = lv >= MAX_LEVEL ? 0 : xpForLevel(lv);
      return { level: lv, xp: this.data.xp, need, ratio: need ? U.clamp(this.data.xp / need, 0, 1) : 1, max: lv >= MAX_LEVEL };
    },
    /** 経験値を加算し、上がったレベル数を返す */
    addXp(n) {
      n = Math.max(0, n | 0);
      if (!n) return 0;
      this.data.totalXp += n;
      if (this.data.level >= MAX_LEVEL) { this.save(); return 0; }
      this.data.xp += n;
      let gained = 0;
      while (this.data.level < MAX_LEVEL && this.data.xp >= xpForLevel(this.data.level)) {
        this.data.xp -= xpForLevel(this.data.level);
        this.data.level++;
        gained++;
      }
      if (this.data.level >= MAX_LEVEL) this.data.xp = 0;
      this.save();
      return gained;
    },
    /** レベルアップで得られる恒常ボーナス */
    levelBonus() {
      const n = this.data.level - 1;
      return {
        hp: n * 7,
        dmg: 1 + n * 0.025,
        speed: 1 + n * 0.012,
        reload: Math.max(0.65, 1 - n * 0.01)
      };
    },

    /* --- derived player/weapon stats --- */
    playerStats() {
      const p = this.data.pUpg;
      const lb = this.levelBonus();
      return {
        maxHp: 115 + p.hp * 22 + lb.hp,
        speed: 3.05 * (1 + p.spd * 0.07) * lb.speed,
        ammoMul: 1 + p.amo * 0.15,
        armor: p.arm * 0.06,
        critBonus: p.crt * 0.15,
        levelDmg: lb.dmg,
        levelReload: lb.reload
      };
    },
    weaponStats(wid) {
      const base = DATA.WEAPON_BY_ID[wid];
      const u = this.data.wUpg[wid] || { dmg: 0, mag: 0, rld: 0, ctl: 0 };
      const ps = this.playerStats();
      return {
        base,
        id: wid,
        name: base.name,
        cat: base.cat,
        damage: base.damage * (1 + u.dmg * 0.14) * ps.levelDmg,
        pellets: base.pellets,
        rpm: base.rpm,
        mag: Math.round(base.mag * (1 + u.mag * 0.20)),
        reserveMax: Math.round(base.reserveMax * ps.ammoMul),
        startReserve: Math.round(base.reserve * ps.ammoMul),
        reload: base.reload * (1 - u.rld * 0.09) * ps.levelReload,
        spread: base.spread * (1 - u.ctl * 0.12),
        moveSpread: base.moveSpread * (1 - u.ctl * 0.12),
        recoil: base.recoil * (1 - u.ctl * 0.12),
        crit: base.crit * (1 + ps.critBonus),
        range: base.range,
        falloff: base.falloff,
        auto: base.auto,
        fireMode: base.fireMode,
        burstCount: base.burstCount || 3,
        burstGap: base.burstGap || 0.075,
        chargeTime: base.chargeTime || 0,
        chargeBonus: base.chargeBonus || 1,
        projSpeed: base.projSpeed || 0,
        splash: base.splash || 0,
        splashMin: base.splashMin || 0.3,
        zoom: base.zoom,
        sfx: base.sfx,
        shake: base.shake,
        flash: base.flash,
        levels: u
      };
    }
  };

  g.Save = Save;
})(window);
