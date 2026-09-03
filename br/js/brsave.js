/* ===== brsave.js — ローカル保存 =============================================
 * 保存: レベル / XP / 通貨 / 戦績 / 設定 / 操作レイアウト / ミッション
 * 試合中の状態はここに書かない（オンライン化時にサーバ権威へ移すため）。
 * ========================================================================= */
(function (g) {
  'use strict';
  const KEY = 'last_island_save_v1';
  const MAX_LEVEL = 50;
  const AIM = { OFF: 1.0, LOW: 1.15, MED: 1.30, HIGH: 1.50 };
  const GYRO = ['OFF', 'ADS', 'ALWAYS'];

  function xpForLevel(l) { return Math.round(110 * Math.pow(l, 1.32)); }

  function defaults() {
    return {
      v: 1,
      level: 1, xp: 0, totalXp: 0, coins: 0,
      stats: { matches: 0, wins: 0, kills: 0, damage: 0, headshots: 0, top10: 0, bestPlace: 99, bestKills: 0, survived: 0 },
      missions: null, missionDay: '',
      settings: {
        sens: 200, adsSens: 70, aim: 'MED', gyro: 'OFF', gyroSens: 100,
        quality: 'AUTO', btnScale: 100, btnOpacity: 100, autoPick: 1,
        sfx: 1, bgm: 1, vibrate: 1, lefty: 0, bots: 15
      }
    };
  }

  const MISSION_POOL = [
    { id: 'kill3', text: '1試合で3キル', goal: 3, kind: 'killsInMatch', xp: 220, coin: 60 },
    { id: 'top5', text: 'TOP 5 に入る', goal: 1, kind: 'top5', xp: 260, coin: 70 },
    { id: 'dmg600', text: '合計600ダメージ', goal: 600, kind: 'damage', xp: 200, coin: 50 },
    { id: 'surv180', text: '合計3分間生存', goal: 180, kind: 'survive', xp: 180, coin: 40 },
    { id: 'head3', text: 'ヘッドショット3回', goal: 3, kind: 'headshots', xp: 240, coin: 60 },
    { id: 'loot20', text: 'アイテムを20個拾う', goal: 20, kind: 'loot', xp: 160, coin: 40 },
    { id: 'win1', text: '1回勝利する', goal: 1, kind: 'wins', xp: 500, coin: 150 }
  ];

  const BRSave = {
    data: null,
    MAX_LEVEL, AIM, GYRO, xpForLevel,

    load() {
      let d = null;
      try { const raw = localStorage.getItem(KEY); if (raw) d = JSON.parse(raw); } catch (e) { d = null; }
      const def = defaults();
      if (!d || typeof d !== 'object' || d.v !== def.v) d = def;
      this.data = Object.assign({}, def, d);
      this.data.settings = Object.assign({}, def.settings, d.settings || {});
      this.data.stats = Object.assign({}, def.stats, d.stats || {});
      this.data.level = U.clamp(this.data.level | 0, 1, MAX_LEVEL) || 1;
      this.data.xp = Math.max(0, this.data.xp | 0);
      if (!AIM[this.data.settings.aim]) this.data.settings.aim = 'MED';
      if (GYRO.indexOf(this.data.settings.gyro) < 0) this.data.settings.gyro = 'OFF';
      this.data.settings.bots = U.clamp(this.data.settings.bots | 0, 5, 29) || 15;
      this.rollMissions();
      return this.data;
    },

    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; } },
    wipe() { try { localStorage.removeItem(KEY); } catch (e) { } this.data = defaults(); this.rollMissions(); this.save(); return this.data; },

    aimAssist() { return AIM[this.data.settings.aim] || 1.3; },

    levelInfo() {
      const lv = this.data.level;
      const need = lv >= MAX_LEVEL ? 0 : xpForLevel(lv);
      return { level: lv, xp: this.data.xp, need, ratio: need ? U.clamp(this.data.xp / need, 0, 1) : 1, max: lv >= MAX_LEVEL };
    },

    addXp(n) {
      n = Math.max(0, n | 0);
      if (!n) return 0;
      this.data.totalXp += n;
      if (this.data.level >= MAX_LEVEL) { this.save(); return 0; }
      this.data.xp += n;
      let up = 0;
      while (this.data.level < MAX_LEVEL && this.data.xp >= xpForLevel(this.data.level)) {
        this.data.xp -= xpForLevel(this.data.level);
        this.data.level++; up++;
      }
      if (this.data.level >= MAX_LEVEL) this.data.xp = 0;
      this.save();
      return up;
    },

    /* --- デイリーミッション --- */
    rollMissions() {
      const day = new Date().toISOString().slice(0, 10);
      if (this.data.missionDay === day && Array.isArray(this.data.missions)) return;
      const pool = MISSION_POOL.slice();
      const pick = [];
      for (let i = 0; i < 3 && pool.length; i++) {
        pick.push(Object.assign({}, pool.splice((Math.random() * pool.length) | 0, 1)[0], { prog: 0, done: false, claimed: false }));
      }
      this.data.missions = pick;
      this.data.missionDay = day;
      this.save();
    },

    /** 試合結果をミッションと戦績へ反映する */
    applyMatch(r) {
      const s = this.data.stats;
      s.matches++;
      s.kills += r.kills;
      s.damage += Math.round(r.damage);
      s.headshots += r.headshots;
      s.survived += Math.round(r.survived);
      if (r.won) s.wins++;
      if (r.placement <= 10) s.top10++;
      if (r.placement < s.bestPlace) s.bestPlace = r.placement;
      if (r.kills > s.bestKills) s.bestKills = r.kills;

      (this.data.missions || []).forEach(m => {
        if (m.done) return;
        switch (m.kind) {
          case 'killsInMatch': m.prog = Math.max(m.prog, r.kills); break;
          case 'top5': if (r.placement <= 5) m.prog = 1; break;
          case 'damage': m.prog += Math.round(r.damage); break;
          case 'survive': m.prog += Math.round(r.survived); break;
          case 'headshots': m.prog += r.headshots; break;
          case 'loot': m.prog += r.lootPicked; break;
          case 'wins': if (r.won) m.prog = 1; break;
        }
        if (m.prog >= m.goal) { m.done = true; }
      });

      // XP: 順位・キル・ダメージ・生存
      const placeXp = Math.round(Math.max(0, (r.total - r.placement + 1)) * 9);
      const xp = 60 + placeXp + r.kills * 45 + Math.round(r.damage * 0.12) + Math.round(r.survived * 0.35)
        + (r.won ? 300 : 0);
      const coins = 20 + r.kills * 12 + (r.won ? 120 : 0) + Math.max(0, 16 - r.placement) * 4;
      this.data.coins += coins;
      const up = this.addXp(xp);
      this.save();
      return { xp, coins, levelUp: up };
    },

    claimMission(id) {
      const m = (this.data.missions || []).find(x => x.id === id);
      if (!m || !m.done || m.claimed) return null;
      m.claimed = true;
      this.data.coins += m.coin;
      this.addXp(m.xp);
      this.save();
      return m;
    }
  };

  g.BRSave = BRSave;
})(window);
