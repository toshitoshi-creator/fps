/* ===== brdata.js — バトルロイヤルのゲームデータ ==============================
 * バランス値はここに集約し、ロジック側に数値を埋め込まない。
 * (Unity移植時は ScriptableObject に1対1で対応させられる形にしてある)
 * ========================================================================= */
(function (g) {
  'use strict';

  /* ---------------- 弾薬 ---------------- */
  const AMMO = {
    light: { id: 'light', name: 'ライト弾', color: '#ffd23f', stack: 180 },
    medium: { id: 'medium', name: 'ミディアム弾', color: '#4ad4c4', stack: 150 },
    heavy: { id: 'heavy', name: 'ヘビー弾', color: '#ff5f7a', stack: 60 },
    shell: { id: 'shell', name: 'シェル', color: '#ff9f4a', stack: 40 }
  };

  /* ---------------- 武器 (10種) ----------------
   * fireMode: auto / semi / burst
   * ballistic: hitscan / projectile (長距離武器は弾速あり)
   */
  const WEAPONS = [
    {
      id: 'p9', name: 'P9 SIDEARM', short: 'P9', cls: 'PISTOL', tier: 'common',
      damage: 22, headMul: 2.0, rpm: 400, mag: 12, reload: 1.5, range: 18, falloff: 0.5,
      spread: 1.4, moveSpread: 1.4, recoil: 1.0, ammo: 'light', fireMode: 'semi',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_smg', color: '#c9d4e0'
    },
    {
      id: 'wasp', name: 'WASP SMG', short: 'WASP', cls: 'SMG', tier: 'common',
      damage: 14, headMul: 1.7, rpm: 900, mag: 30, reload: 1.7, range: 14, falloff: 0.42,
      spread: 2.0, moveSpread: 1.1, recoil: 0.8, ammo: 'light', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_smg', color: '#9dffa8'
    },
    {
      id: 'hornet', name: 'HORNET SMG', short: 'HORNET', cls: 'SMG', tier: 'uncommon',
      damage: 17, headMul: 1.7, rpm: 780, mag: 35, reload: 1.9, range: 17, falloff: 0.45,
      spread: 1.7, moveSpread: 1.1, recoil: 0.9, ammo: 'light', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_smg', color: '#8ad46a'
    },
    {
      id: 'vector', name: 'VECTOR AR', short: 'VECTOR', cls: 'AR', tier: 'common',
      damage: 21, headMul: 2.0, rpm: 620, mag: 30, reload: 2.0, range: 30, falloff: 0.55,
      spread: 1.1, moveSpread: 1.5, recoil: 1.1, ammo: 'medium', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_rifle', color: '#7fe3ff'
    },
    {
      id: 'raptor', name: 'RAPTOR AR', short: 'RAPTOR', cls: 'AR', tier: 'rare',
      damage: 27, headMul: 2.0, rpm: 520, mag: 30, reload: 2.1, range: 36, falloff: 0.6,
      spread: 0.9, moveSpread: 1.5, recoil: 1.35, ammo: 'medium', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_rifle', color: '#4ad4c4'
    },
    {
      id: 'lance', name: 'LANCE BR', short: 'LANCE', cls: 'AR', tier: 'uncommon',
      damage: 25, headMul: 2.1, rpm: 760, mag: 27, reload: 2.0, range: 34, falloff: 0.6,
      spread: 0.75, moveSpread: 1.3, recoil: 1.25, ammo: 'medium', fireMode: 'burst',
      burstCount: 3, burstGap: 0.075, ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_rifle', color: '#c9a8ff'
    },
    {
      id: 'breach', name: 'BREACH SG', short: 'BREACH', cls: 'SHOTGUN', tier: 'uncommon',
      damage: 13, pellets: 8, headMul: 1.5, rpm: 80, mag: 6, reload: 2.6, range: 10, falloff: 0.28,
      spread: 5.4, moveSpread: 1.0, recoil: 3.2, ammo: 'shell', fireMode: 'semi',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_shotgun', color: '#ffb020'
    },
    {
      id: 'tide', name: 'TIDE SG', short: 'TIDE', cls: 'SHOTGUN', tier: 'rare',
      damage: 11, pellets: 10, headMul: 1.5, rpm: 150, mag: 8, reload: 3.0, range: 11, falloff: 0.3,
      spread: 6.2, moveSpread: 1.0, recoil: 2.6, ammo: 'shell', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_shotgun', color: '#ff9f4a'
    },
    {
      id: 'saw', name: 'SAW LMG', short: 'SAW', cls: 'LMG', tier: 'epic',
      damage: 24, headMul: 1.8, rpm: 700, mag: 75, reload: 4.2, range: 32, falloff: 0.55,
      spread: 1.9, moveSpread: 2.4, recoil: 1.5, ammo: 'medium', fireMode: 'auto',
      ballistic: 'hitscan', zoom: 1.0, sfx: 'shot_rifle', color: '#ffd23f'
    },
    {
      id: 'marksman', name: 'MARKSMAN DMR', short: 'DMR', cls: 'DMR', tier: 'rare',
      damage: 52, headMul: 2.3, rpm: 260, mag: 12, reload: 2.4, range: 55, falloff: 0.8,
      spread: 0.3, moveSpread: 3.0, recoil: 2.4, ammo: 'heavy', fireMode: 'semi',
      ballistic: 'projectile', bulletSpeed: 160, zoom: 2.0, sfx: 'shot_sniper', color: '#ff7a7a'
    },
    {
      id: 'longview', name: 'LONGVIEW SR', short: 'LONGVIEW', cls: 'SNIPER', tier: 'legendary',
      damage: 118, headMul: 2.6, rpm: 45, mag: 5, reload: 3.2, range: 90, falloff: 0.95,
      spread: 0.14, moveSpread: 3.6, recoil: 4.8, ammo: 'heavy', fireMode: 'semi',
      ballistic: 'projectile', bulletSpeed: 210, zoom: 4.0, sfx: 'shot_sniper', color: '#ff5f9e'
    }
  ];
  const WEAPON_BY_ID = {};
  WEAPONS.forEach((w, i) => {
    w.index = i;
    w.pellets = w.pellets || 1;
    w.headMul = w.headMul || 2.0;
    WEAPON_BY_ID[w.id] = w;
  });

  /* ---------------- 消耗品・装備 ---------------- */
  const ITEMS = {
    bandage: { id: 'bandage', name: '包帯', kind: 'heal', heal: 18, useTime: 1.6, stack: 8, tier: 'common' },
    medkit: { id: 'medkit', name: 'メドキット', kind: 'heal', heal: 60, useTime: 3.2, stack: 3, tier: 'rare' },
    energy: { id: 'energy', name: 'エナジー', kind: 'boost', heal: 0, speed: 1.25, dur: 15, useTime: 2.0, stack: 4, tier: 'uncommon' },
    armor1: { id: 'armor1', name: 'アーマー Lv1', kind: 'armor', level: 1, ap: 45, tier: 'common' },
    armor2: { id: 'armor2', name: 'アーマー Lv2', kind: 'armor', level: 2, ap: 80, tier: 'rare' },
    armor3: { id: 'armor3', name: 'アーマー Lv3', kind: 'armor', level: 3, ap: 120, tier: 'legendary' },
    helm1: { id: 'helm1', name: 'ヘルメット Lv1', kind: 'helmet', level: 1, reduce: 0.20, tier: 'common' },
    helm2: { id: 'helm2', name: 'ヘルメット Lv2', kind: 'helmet', level: 2, reduce: 0.35, tier: 'rare' },
    helm3: { id: 'helm3', name: 'ヘルメット Lv3', kind: 'helmet', level: 3, reduce: 0.50, tier: 'legendary' },
    frag: { id: 'frag', name: 'フラググレネード', kind: 'throw', dmg: 95, radius: 4.5, fuse: 2.4, stack: 4, tier: 'uncommon' }
  };

  const RARITY = {
    common: { name: 'COMMON', color: '#c9d4e0', w: 100 },
    uncommon: { name: 'UNCOMMON', color: '#6ee06e', w: 55 },
    rare: { name: 'RARE', color: '#5aa8ff', w: 26 },
    epic: { name: 'EPIC', color: '#c07aff', w: 10 },
    legendary: { name: 'LEGENDARY', color: '#ffb020', w: 4 }
  };

  /* ---------------- ロケーション別ルートテーブル ---------------- */
  // weight: そのエリアで抽選される相対確率
  const LOOT_TABLES = {
    city: { weapon: 44, ammo: 24, heal: 15, armor: 16, throw: 3, tierBoost: 1.0 },
    military: { weapon: 36, ammo: 20, heal: 11, armor: 29, throw: 6, tierBoost: 2.2 },
    industrial: { weapon: 38, ammo: 27, heal: 15, armor: 18, throw: 4, tierBoost: 1.3 },
    harbor: { weapon: 36, ammo: 28, heal: 16, armor: 18, throw: 4, tierBoost: 1.2 },
    village: { weapon: 35, ammo: 28, heal: 22, armor: 14, throw: 2, tierBoost: 0.7 },
    forest: { weapon: 29, ammo: 31, heal: 28, armor: 11, throw: 2, tierBoost: 0.5 },
    field: { weapon: 27, ammo: 33, heal: 28, armor: 11, throw: 2, tierBoost: 0.4 }
  };

  /* ---------------- Bot 性格 ---------------- */
  const PERSONALITIES = {
    aggressive: { id: 'aggressive', name: 'AGGRESSIVE', engage: 42, flee: 0.18, aimErr: 0.9, react: 0.30, lootTime: 0.7, pushChance: 0.85 },
    balanced: { id: 'balanced', name: 'BALANCED', engage: 32, flee: 0.30, aimErr: 1.0, react: 0.40, lootTime: 1.0, pushChance: 0.5 },
    defensive: { id: 'defensive', name: 'DEFENSIVE', engage: 26, flee: 0.45, aimErr: 1.1, react: 0.50, lootTime: 1.2, pushChance: 0.25 },
    looter: { id: 'looter', name: 'LOOTER', engage: 20, flee: 0.5, aimErr: 1.25, react: 0.55, lootTime: 1.8, pushChance: 0.2 },
    sniper: { id: 'sniper', name: 'SNIPER', engage: 60, flee: 0.35, aimErr: 0.85, react: 0.45, lootTime: 1.1, pushChance: 0.15, prefer: 'SNIPER' },
    rusher: { id: 'rusher', name: 'RUSHER', engage: 30, flee: 0.10, aimErr: 1.05, react: 0.26, lootTime: 0.5, pushChance: 1.0, prefer: 'SHOTGUN' }
  };
  const PERSONALITY_LIST = Object.keys(PERSONALITIES);

  /* ---------------- 安全地帯フェーズ ---------------- */
  // wait: 縮小開始までの待機秒 / shrink: 縮小にかかる秒 / r: 縮小後の半径 / dps: 圏外ダメージ
  const ZONE_PHASES = [
    { wait: 32, shrink: 34, r: 30, dps: 1.2 },
    { wait: 26, shrink: 30, r: 20, dps: 2.2 },
    { wait: 22, shrink: 26, r: 13, dps: 4.0 },
    { wait: 18, shrink: 22, r: 8, dps: 7.0 },
    { wait: 15, shrink: 20, r: 4, dps: 11.0 },
    { wait: 12, shrink: 18, r: 1.2, dps: 16.0 }
  ];

  /* ---------------- マッチ設定 ---------------- */
  const MATCH = {
    mapSize: 96,
    startRadius: 44,
    botCount: 15,             // 1 player + 15 bots
    lootSpots: 320,
    planeAlt: 120,
    parachuteAt: 26,          // この高度でパラシュートが自動展開
    landAt: 0.55,
    fallSpeed: 34,
    chuteSpeed: 8.5,
    glideSpeed: 11
  };

  const BOT_NAMES = [
    'RAVEN', 'ONYX', 'FLINT', 'ASH', 'VIPER', 'CINDER', 'NOVA', 'HALO',
    'RIFT', 'ECHO', 'DRIFT', 'SABLE', 'QUILL', 'JOLT', 'MIRA', 'TALON',
    'BRIAR', 'CODA', 'WISP', 'GRIT', 'ZEPH', 'LUMEN', 'KITE', 'FORGE'
  ];

  /* Sprites/Render が要求する敵定義の形に合わせたアバター定義 */
  const AVATARS = {
    br_player: { id: 'br_player', name: 'PLAYER', radius: 0.32, height: 0.95, palette: { main: '#4fd48a', sec: '#2fae6b', trim: '#d4ff8f', visor: '#ffffff' } },
    br_a: { id: 'br_a', name: 'BOT-A', radius: 0.32, height: 0.95, palette: { main: '#ff5f7a', sec: '#d63a58', trim: '#ffd23f', visor: '#ffffff' } },
    br_b: { id: 'br_b', name: 'BOT-B', radius: 0.32, height: 0.95, palette: { main: '#5aa8ff', sec: '#3a7ad6', trim: '#c7e9ff', visor: '#ffffff' } },
    br_c: { id: 'br_c', name: 'BOT-C', radius: 0.32, height: 0.95, palette: { main: '#ffa33f', sec: '#d97a1f', trim: '#ffe08f', visor: '#ffffff' } },
    br_d: { id: 'br_d', name: 'BOT-D', radius: 0.32, height: 0.95, palette: { main: '#b45fff', sec: '#7a3fd0', trim: '#ffd23f', visor: '#ffffff' } },
    br_e: { id: 'br_e', name: 'BOT-E', radius: 0.32, height: 0.95, palette: { main: '#4ad4c4', sec: '#2b9c90', trim: '#b8fff5', visor: '#ffffff' } }
  };
  const AVATAR_KEYS = ['br_a', 'br_b', 'br_c', 'br_d', 'br_e'];

  /* マッチの状態遷移。不正な遷移を弾くために許可表を持つ */
  const MATCH_STATES = ['LOBBY', 'WAITING', 'PLANE', 'DROP', 'EARLY_GAME', 'MID_GAME',
    'LATE_GAME', 'FINAL_ZONE', 'VICTORY', 'DEFEAT', 'RESULT'];
  const STATE_FLOW = {
    LOBBY: ['WAITING'],
    WAITING: ['PLANE', 'LOBBY'],
    PLANE: ['DROP'],
    DROP: ['EARLY_GAME'],
    EARLY_GAME: ['MID_GAME', 'VICTORY', 'DEFEAT'],
    MID_GAME: ['LATE_GAME', 'VICTORY', 'DEFEAT'],
    LATE_GAME: ['FINAL_ZONE', 'VICTORY', 'DEFEAT'],
    FINAL_ZONE: ['VICTORY', 'DEFEAT'],
    VICTORY: ['RESULT'],
    DEFEAT: ['RESULT'],
    RESULT: ['LOBBY']
  };

  g.BRDATA = {
    AMMO, WEAPONS, WEAPON_BY_ID, ITEMS, RARITY, LOOT_TABLES,
    PERSONALITIES, PERSONALITY_LIST, ZONE_PHASES, MATCH, BOT_NAMES,
    AVATARS, AVATAR_KEYS, MATCH_STATES, STATE_FLOW
  };
})(window);
