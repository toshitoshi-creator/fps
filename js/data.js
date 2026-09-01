/* ===== data.js — weapons / enemies / stages / upgrades ===== */
(function (g) {
  'use strict';

  /* ---------------------------------------------------------------
   * WEAPONS
   * -------------------------------------------------------------*/
  const WEAPONS = [
    {
      id: 'ar', name: 'MK-7 RIFLE', short: 'RIFLE', cat: 'ASSAULT RIFLE',
      desc: 'あらゆる状況に対応する標準支給アサルトライフル。扱いやすく安定した性能。',
      damage: 20, pellets: 1, rpm: 620, mag: 30, reserve: 210, reserveMax: 240,
      reload: 1.85, spread: 1.0, moveSpread: 1.6, recoil: 1.0, crit: 2.0,
      range: 26, falloff: 0.55, fireMode: 'auto', zoom: 1.0, sfx: 'shot_rifle',
      price: 0, color: '#7fe3ff', unlockNote: '初期装備',
      shake: 0.55, flash: 0.32
    },
    {
      id: 'smg', name: 'VIPER SMG', short: 'SMG', cat: 'SUBMACHINE GUN',
      desc: '圧倒的な連射速度で近距離を制圧する。突撃兵の掃討に有効。',
      damage: 12, pellets: 1, rpm: 920, mag: 40, reserve: 300, reserveMax: 340,
      reload: 1.55, spread: 1.9, moveSpread: 1.2, recoil: 0.75, crit: 1.8,
      range: 15, falloff: 0.45, fireMode: 'auto', zoom: 1.0, sfx: 'shot_smg',
      price: 400, color: '#9dffa8', unlockNote: 'コインで購入',
      shake: 0.42, flash: 0.26
    },
    {
      id: 'br', name: 'LANCER DMR', short: 'BURST', cat: 'BURST RIFLE',
      desc: '3点バーストで中距離を制圧。1トリガーで3発、精度が高く弾持ちが良い。',
      damage: 24, pellets: 1, rpm: 780, mag: 27, reserve: 180, reserveMax: 216,
      reload: 1.95, spread: 0.7, moveSpread: 1.3, recoil: 1.3, crit: 2.2,
      range: 34, falloff: 0.6, fireMode: 'burst', burstCount: 3, burstGap: 0.075,
      zoom: 1.0, sfx: 'shot_rifle', price: 650, color: '#c9a8ff', unlockNote: 'STAGE 4 クリアで解放',
      shake: 0.7, flash: 0.36
    },
    {
      id: 'sg', name: 'BREACHER 12', short: 'SHOTGUN', cat: 'SHOTGUN',
      desc: '8発の散弾を同時発射。至近距離で敵を一撃で吹き飛ばす。',
      damage: 13, pellets: 8, rpm: 85, mag: 7, reserve: 64, reserveMax: 80,
      reload: 2.55, spread: 5.6, moveSpread: 1.0, recoil: 3.4, crit: 1.6,
      range: 11, falloff: 0.30, fireMode: 'semi', zoom: 1.0, sfx: 'shot_shotgun',
      price: 0, color: '#ffb020', unlockNote: 'STAGE 2 クリアで解放',
      shake: 1.5, flash: 0.6
    },
    {
      id: 'sr', name: 'LONGBOW SR', short: 'SNIPER', cat: 'SNIPER RIFLE',
      desc: '超長距離から一撃必殺。ヘッドショットで大型の敵も沈黙させる。',
      damage: 125, pellets: 1, rpm: 52, mag: 5, reserve: 40, reserveMax: 56,
      reload: 2.75, spread: 0.18, moveSpread: 3.2, recoil: 4.6, crit: 3.0,
      range: 60, falloff: 0.9, fireMode: 'semi', zoom: 2.3, sfx: 'shot_sniper',
      price: 900, color: '#ff7a7a', unlockNote: 'コインで購入',
      shake: 1.9, flash: 0.75
    },
    {
      id: 'rl', name: 'TEMPEST RL', short: 'HEAVY', cat: 'HEAVY WEAPON',
      desc: 'チャージして撃つ爆裂弾。長く溜めるほど威力と爆風範囲が広がる。群れに刺さる。',
      damage: 70, pellets: 1, rpm: 42, mag: 4, reserve: 24, reserveMax: 36,
      reload: 3.2, spread: 0.9, moveSpread: 1.4, recoil: 5.2, crit: 1.4,
      range: 40, falloff: 0.85, fireMode: 'charge', chargeTime: 0.9, chargeBonus: 1.6,
      projSpeed: 22, splash: 2.3, splashMin: 0.35,
      zoom: 1.0, sfx: 'shot_rocket', price: 1500, color: '#ff9f4a', unlockNote: 'コインで購入',
      shake: 2.4, flash: 0.9
    }
  ];
  const WEAPON_BY_ID = {};
  WEAPONS.forEach((w, i) => {
    w.index = i;
    w.auto = w.fireMode === 'auto';
    WEAPON_BY_ID[w.id] = w;
  });

  /* ---------------------------------------------------------------
   * WEAPON UPGRADES (per weapon) & PLAYER UPGRADES
   * -------------------------------------------------------------*/
  const WEAPON_UPGRADES = [
    { key: 'dmg', name: '攻撃力', max: 6, cost: [120, 200, 320, 480, 700, 980], eff: l => '+' + (l * 14) + '%' },
    { key: 'mag', name: '装弾数', max: 5, cost: [100, 180, 300, 460, 660], eff: l => '+' + (l * 20) + '%' },
    { key: 'rld', name: 'リロード速度', max: 5, cost: [110, 190, 300, 450, 640], eff: l => '-' + (l * 9) + '%' },
    { key: 'ctl', name: '反動制御', max: 5, cost: [90, 160, 260, 400, 580], eff: l => '-' + (l * 12) + '%' }
  ];
  const PLAYER_UPGRADES = [
    { key: 'hp', name: '最大HP', max: 6, cost: [130, 220, 340, 500, 720, 1000], eff: l => '+' + (l * 20) },
    { key: 'spd', name: '移動速度', max: 5, cost: [120, 210, 340, 500, 720], eff: l => '+' + (l * 7) + '%' },
    { key: 'amo', name: '弾薬所持数', max: 5, cost: [100, 170, 280, 420, 600], eff: l => '+' + (l * 15) + '%' },
    { key: 'arm', name: '装甲', max: 5, cost: [150, 250, 400, 600, 850], eff: l => '-' + (l * 6) + '% 被ダメ' },
    { key: 'crt', name: 'クリティカル倍率', max: 5, cost: [140, 240, 380, 560, 800], eff: l => '+' + (l * 15) + '%' }
  ];

  /* ---------------------------------------------------------------
   * ENEMIES
   * -------------------------------------------------------------*/
  const ENEMIES = {
    grunt: {
      id: 'grunt', name: '一般兵', hp: 62, speed: 1.35, radius: 0.34, height: 0.92,
      dmg: 7, atkRange: 10, atkMin: 2.0, atkCd: 1.55, burst: 2, burstGap: 0.13,
      windup: 0.34, projSpeed: 8.5, sight: 17, fov: 105, turn: 3.4,
      coins: 18, xp: 12, score: 100,
      accuracy: 0.72, melee: false, palette: { main: '#4fd48a', sec: '#2fae6b', trim: '#d4ff8f', visor: '#ffffff' }
    },
    rusher: {
      id: 'rusher', name: '突撃兵', hp: 48, speed: 2.65, radius: 0.32, height: 0.88,
      dmg: 11, atkRange: 1.5, atkMin: 0, atkCd: 1.1, burst: 1, burstGap: 0,
      windup: 0.28, projSpeed: 0, sight: 15, fov: 140, turn: 5.0,
      coins: 20, xp: 14, score: 120,
      accuracy: 1, melee: true, palette: { main: '#ff5f7a', sec: '#d63a58', trim: '#ffd23f', visor: '#ffffff' }
    },
    shooter: {
      id: 'shooter', name: '狙撃兵', hp: 54, speed: 1.05, radius: 0.33, height: 0.90,
      dmg: 11, atkRange: 17, atkMin: 7.5, atkCd: 2.2, burst: 1, burstGap: 0,
      windup: 0.75, laser: true, projSpeed: 12.5, sight: 22, fov: 95, turn: 2.6,
      coins: 24, xp: 18, score: 150,
      accuracy: 0.86, melee: false, keepDist: 11, palette: { main: '#5aa8ff', sec: '#3a7ad6', trim: '#c7e9ff', visor: '#ffffff' }
    },
    heavy: {
      id: 'heavy', name: '重装兵', hp: 155, speed: 0.88, radius: 0.44, height: 1.05,
      dmg: 9, atkRange: 9, atkMin: 1.6, atkCd: 2.1, burst: 3, burstGap: 0.16,
      windup: 0.5, projSpeed: 9, sight: 16, fov: 100, turn: 2.0,
      coins: 55, xp: 45, score: 350,
      accuracy: 0.66, melee: false, armor: 0.18, palette: { main: '#ffa33f', sec: '#d97a1f', trim: '#ffe08f', visor: '#ffffff' }
    },
    elite: {
      id: 'elite', name: '精鋭兵', hp: 105, speed: 1.95, radius: 0.34, height: 0.96,
      dmg: 9, atkRange: 14, atkMin: 3.0, atkCd: 1.5, burst: 3, burstGap: 0.11,
      windup: 0.4, projSpeed: 13, sight: 21, fov: 120, turn: 4.2,
      coins: 42, xp: 38, score: 300,
      accuracy: 0.9, melee: false, armor: 0.08, retreatAt: 0.45, keepDist: 7,
      palette: { main: '#e05fd6', sec: '#a03a96', trim: '#ffd23f', visor: '#ffffff' }
    },
    boss: {
      id: 'boss', name: 'TITAN-01', hp: 1100, speed: 1.15, radius: 0.75, height: 1.55,
      dmg: 11, atkRange: 20, atkMin: 0, atkCd: 1.7, burst: 3, burstGap: 0.18,
      windup: 0.45, projSpeed: 10, sight: 40, fov: 360, turn: 2.2,
      coins: 600, xp: 500, score: 3000,
      accuracy: 0.8, melee: false, armor: 0.12, boss: true,
      palette: { main: '#b45fff', sec: '#7a3fd0', trim: '#ffd23f', visor: '#ffffff' }
    }
  };

  /* ---------------------------------------------------------------
   * STAGES  (map legend)
   *   #  wall        =  panel wall      %  crate / cover     *  hazard wall
   *   .  floor       P  player spawn
   *   g grunt   r rusher   s shooter   h heavy   B boss
   * -------------------------------------------------------------*/
  const STAGES = [
    {
      id: 1, name: 'TRAINING GROUND', jp: '訓練施設',
      objective: 'eliminate', par: 70, reward: 120, tutorial: true,
      hpMul: 0.85, dmgMul: 0.7, aiMul: 0.8,
      brief: '訓練施設に侵入したドローン兵を全て排除せよ。基本操作を確認しながら進め。',
      map: [
        '####################',
        '#........#.........#',
        '#..P.....#....g....#',
        '#........#.........#',
        '#......%%%.........#',
        '#..................#',
        '#........#....%....#',
        '####..####....%....#',
        '#........#....%....#',
        '#...g....#....%..g.#',
        '#........#....%....#',
        '#........#.........#',
        '#........#.........#',
        '####################'
      ],
      dir: 0
    },
    {
      id: 2, name: 'CARGO DEPOT', jp: '貨物集積所',
      objective: 'eliminate', par: 105, reward: 180,
      hpMul: 1.0, dmgMul: 0.9, aiMul: 1.0,
      brief: '貨物集積所を制圧。突撃兵が接近してくる。狭い通路に注意しろ。',
      unlockWeapon: 'sg',
      map: [
        '########################',
        '#..........#...........#',
        '#..P.......#....g......#',
        '#.....%%...#.....%%....#',
        '#.....%%...#.....%%....#',
        '#..........#...g.......#',
        '#......................#',
        '####.####..#####...#####',
        '#.......#..#....r......#',
        '#...r...#..#...........#',
        '#.......#..#....%%.....#',
        '#..%%...#..#....%%.....#',
        '#..%%......#...........#',
        '#.......g..#......g....#',
        '#..........#...........#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 3, name: 'SIGNAL RELAY', jp: '中継基地',
      objective: 'count', target: 5, par: 130, reward: 240,
      hpMul: 1.1, dmgMul: 0.95, aiMul: 1.1,
      brief: '中継基地の防衛部隊を5体以上撃破し、通信網を遮断せよ。全滅させる必要はない。',
      map: [
        '########################',
        '#......................#',
        '#..P..%%........%%.....#',
        '#.....%%...s....%%.....#',
        '#......................#',
        '#...#####......#####...#',
        '#...#.....g........#...#',
        '#...#..............#...#',
        '#...#....%%%%%%....#...#',
        '#........#....#.....s..#',
        '#...s....#....#........#',
        '#..#######....#######..#',
        '#......................#',
        '#....g........g...r....#',
        '#......................#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 4, name: 'CROSSFIRE YARD', jp: '包囲された広場',
      objective: 'survive', duration: 50, par: 55, reward: 300,
      hpMul: 1.0, dmgMul: 0.95, aiMul: 1.05,
      brief: '四方から敵が湧き続ける。50秒間生き延びろ。倒しきる必要はない、動き続けろ。',
      unlockWeapon: 'br',
      spawnEvery: 5.5, spawnBatch: 2, spawnMax: 10,
      spawnTable: ['grunt', 'grunt', 'rusher', 'shooter', 'rusher'],
      map: [
        '########################',
        '#o....................o#',
        '#..%%....%%....%%..%%..#',
        '#..%%....%%....%%..%%..#',
        '#......................#',
        '#.....P................#',
        '#......................#',
        '#..%%....%%....%%..%%..#',
        '#..%%....%%....%%..%%..#',
        '#......................#',
        '#......................#',
        '#..%%....%%....%%..%%..#',
        '#..%%....%%....%%..%%..#',
        '#......................#',
        '#o....................o#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 5, name: 'IRON BUNKER', jp: '鉄壁の掩体壕',
      objective: 'eliminate', par: 165, reward: 320,
      hpMul: 1.2, dmgMul: 1.0, aiMul: 1.15,
      brief: '重装兵が守る掩体壕を突破せよ。装甲は厚い。頭部を狙え。',
      map: [
        '########################',
        '#.....#..........#.....#',
        '#..P..#....g.....#..h..#',
        '#.....#..........#.....#',
        '#.....#...%%%%...#.....#',
        '#............#.........#',
        '##.##.###.#..#.###.##.##',
        '#...#...#.#..#.#...#...#',
        '#.s.#.h.#.#..#.#.h.#.s.#',
        '#...#...#.#..#.#...#...#',
        '##.##.###.#..#.###.##.##',
        '#............#.........#',
        '#.....#...%%%%...#.....#',
        '#..r..#..........#..r..#',
        '#.....#.....g....#.....#',
        '#.....#..........#.....#',
        '#......................#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 6, name: 'NARROW VAULT', jp: '狭隘な金庫室',
      objective: 'eliminate', par: 140, reward: 340,
      hpMul: 1.25, dmgMul: 1.0, aiMul: 1.2,
      brief: '通路が狭く逃げ場がない。突撃兵が角から飛び出してくる。ショットガンが有効だ。',
      map: [
        '##################',
        '#....#.......#...#',
        '#.P..#..r#...#.g.#',
        '#....#...#...#...#',
        '#..###...#...#...#',
        '#........#.......#',
        '####.#####...#####',
        '#..r...#.....#...#',
        '#..##..#..#..#.h.#',
        '#..##..#..#..#...#',
        '#......#..#......#',
        '#.g#####..####...#',
        '#.........r......#',
        '##################'
      ],
      dir: 0
    },
    {
      id: 7, name: 'SWARM PLAZA', jp: '殲滅広場',
      objective: 'eliminate', par: 190, reward: 400,
      hpMul: 1.15, dmgMul: 1.0, aiMul: 1.25,
      brief: '大量の敵が展開している。柱を盾にして各個撃破しろ。爆裂弾が刺さる。',
      map: [
        '##########################',
        '#........................#',
        '#..%%....g....g....%%....#',
        '#..%%..............%%....#',
        '#.....r............r.....#',
        '#.....P..................#',
        '#........................#',
        '#......%%%%....%%%%......#',
        '#..g...%%%%....%%%%...g..#',
        '#......%%%%....%%%%......#',
        '#..s...%%%%....%%%%...s..#',
        '#........................#',
        '#........................#',
        '#..%%.....g....g...%%....#',
        '#..%%..............%%....#',
        '#.....r............r.....#',
        '#........................#',
        '##########################'
      ],
      dir: 0
    },
    {
      id: 8, name: 'RELAY POINTS', jp: '拠点確保',
      objective: 'capture', holdTime: 3, par: 175, reward: 440,
      hpMul: 1.2, dmgMul: 1.0, aiMul: 1.15,
      brief: '3つの中継地点を確保せよ。各地点に留まればゲージが溜まる。敵は妨害してくる。',
      map: [
        '########################',
        '#......................#',
        '#..C....s...%%..s...C..#',
        '#...........%%.........#',
        '#......................#',
        '#....%%%.....e....%%%..#',
        '#....%%%..........%%%..#',
        '#.........r............#',
        '#.........P............#',
        '#..............r.......#',
        '#....%%%..........%%%..#',
        '#....%%%.....g....%%%..#',
        '#......................#',
        '#...........%%.........#',
        '#.....C.....%%.....h...#',
        '#......................#',
        '#......................#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 9, name: 'ELITE GAUNTLET', jp: '精鋭迎撃線',
      objective: 'reach', reachKills: 4, par: 150, reward: 520,
      hpMul: 1.35, dmgMul: 1.1, aiMul: 1.3,
      brief: '精鋭部隊を4体以上排除して封鎖を解き、右奥の脱出地点へ到達せよ。全滅させる必要はない。',
      map: [
        '########################',
        '#..P.......#.....e.....#',
        '#..........#...........#',
        '#....%%..e.#....%%.....#',
        '#....%%....#....%%.....#',
        '#......................#',
        '#####..####............#',
        '#....e.....#####..######',
        '#..........#.....e.....#',
        '#...%%%....#...%%%.....#',
        '#...%%%....#...%%%.....#',
        '#....h.....#...........#',
        '######..####......e....#',
        '#..........####..#######',
        '#....e.....#...........#',
        '#....%%....#....%%....X#',
        '#....%%....#....%%.....#',
        '########################'
      ],
      dir: 0
    },
    {
      id: 10, name: 'TITAN ARENA', jp: '決戦場',
      objective: 'boss', par: 210, reward: 900, boss: true,
      hpMul: 1.5, dmgMul: 1.12, aiMul: 1.35,
      brief: '最終目標「TITAN-01」を撃破せよ。護衛部隊も随時投入される。',
      map: [
        '########################',
        '#......................#',
        '#..P...................#',
        '#.....%%.......%%......#',
        '#.....%%.......%%......#',
        '#......................#',
        '#......................#',
        '#...%%...........%%....#',
        '#...%%.....B.....%%....#',
        '#...%%...........%%....#',
        '#......................#',
        '#......................#',
        '#.....%%.......%%......#',
        '#.....%%.......%%......#',
        '#......................#',
        '#......s.......s...r...#',
        '#......................#',
        '########################'
      ],
      dir: 0,
      waves: [
        { hp: 0.78, enemies: [{ t: 'grunt', x: 2.5, y: 2.5 }, { t: 'grunt', x: 21.5, y: 2.5 }, { t: 'rusher', x: 2.5, y: 15.5 }] },
        { hp: 0.55, enemies: [{ t: 'elite', x: 21.5, y: 15.5 }, { t: 'shooter', x: 2.5, y: 8.5 }] },
        { hp: 0.32, enemies: [{ t: 'heavy', x: 11.5, y: 15.5 }, { t: 'elite', x: 2.5, y: 11.5 }] },
        { hp: 0.15, enemies: [{ t: 'rusher', x: 11.5, y: 2.5 }, { t: 'grunt', x: 2.5, y: 11.5 }, { t: 'grunt', x: 21.5, y: 11.5 }] }
      ]
    }
  ];

  const CUSTOM_KEY = 'steel_protocol_custom_stage';
  const CUSTOM_ID = 99;

  /**
   * tools/scan2map.html が localStorage に書き込んだスキャンマップを取り込む。
   * 壊れたデータでゲームが起動しなくなることが無いよう、形が合わないものは黙って捨てる。
   */
  function loadCustomStage() {
    let raw = null;
    try { raw = localStorage.getItem(CUSTOM_KEY); } catch (e) { return null; }
    if (!raw) return null;
    let s;
    try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || !Array.isArray(s.map) || s.map.length < 5) return null;
    const w = s.map[0] && s.map[0].length;
    if (!w || w < 5 || w > 64 || s.map.length > 64) return null;
    if (!s.map.every(r => typeof r === 'string' && r.length === w)) return null;
    const joined = s.map.join('');
    if (joined.indexOf('P') < 0) return null;                 // 開始地点が無い
    if (!/[grshB]/.test(joined)) return null;                 // 敵がいない
    return Object.assign({
      id: CUSTOM_ID, custom: true,
      name: 'SCANNED SITE', jp: 'スキャンマップ',
      objective: 'eliminate', par: 120, reward: 220,
      hpMul: 1.0, dmgMul: 1.0, aiMul: 1.05,
      theme: { ceil: '#1e2630', ceil2: '#131a22', floor: '#38424e', floor2: '#232a33', fog: '#2a333e', walls: ['#6f8091', '#59697a', '#7d8f6a', '#8a6a52'] },
      brief: '実地スキャンから生成された地形。敵を全滅させろ。',
      dir: 0
    }, s, { id: CUSTOM_ID, custom: true });
  }

  function installCustomStage() {
    const i = STAGES.findIndex(s => s.custom);
    if (i >= 0) STAGES.splice(i, 1);
    const c = loadCustomStage();
    if (c) STAGES.push(c);
    return c;
  }

  function clearCustomStage() {
    try { localStorage.removeItem(CUSTOM_KEY); } catch (e) { }
    const i = STAGES.findIndex(s => s.custom);
    if (i >= 0) STAGES.splice(i, 1);
  }

  const builtinStages = () => STAGES.filter(s => !s.custom);

  const ENEMY_CHARS = { g: 'grunt', r: 'rusher', s: 'shooter', h: 'heavy', e: 'elite', B: 'boss' };
  const WALL_CHARS = { '#': 1, '=': 2, '%': 3, '*': 4 };

  /* マップ文字列を { w,h,grid,spawn,enemies,zones,spawnPoints } に展開する */
  function parseMap(stage) {
    const rows = stage.map;
    const h = rows.length, w = rows[0].length;
    const grid = new Uint8Array(w * h);
    let spawn = { x: 1.5, y: 1.5 };
    const enemies = [], zones = [], spawnPoints = [];
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const c = row[x] || '#';
        if (WALL_CHARS[c]) { grid[y * w + x] = WALL_CHARS[c]; continue; }
        grid[y * w + x] = 0;
        const cx = x + 0.5, cy = y + 0.5;
        if (c === 'P') spawn = { x: cx, y: cy };
        else if (c === 'X') zones.push({ kind: 'exit', x: cx, y: cy });
        else if (c === 'C') zones.push({ kind: 'capture', x: cx, y: cy });
        else if (c === 'o') spawnPoints.push({ x: cx, y: cy });
        else if (ENEMY_CHARS[c]) enemies.push({ t: ENEMY_CHARS[c], x: cx, y: cy });
      }
    }
    zones.forEach((z, i) => { z.id = i; z.progress = 0; z.done = false; });
    return { w, h, grid, spawn, enemies, zones, spawnPoints };
  }

  /* rank thresholds from time + accuracy + damage taken */
  function computeRank(stage, timeSec, accuracy, hpRatio) {
    let score = 0;
    const t = stage.par;
    score += U.clamp(1 - (timeSec - t * 0.55) / (t * 1.1), 0, 1) * 42;
    score += U.clamp(accuracy / 0.55, 0, 1) * 28;
    score += U.clamp(hpRatio, 0, 1) * 30;
    if (score >= 88) return 'S';
    if (score >= 72) return 'A';
    if (score >= 54) return 'B';
    if (score >= 34) return 'C';
    return 'D';
  }

  g.DATA = {
    WEAPONS, WEAPON_BY_ID, ENEMIES, STAGES,
    WEAPON_UPGRADES, PLAYER_UPGRADES,
    parseMap, computeRank, ENEMY_CHARS, WALL_CHARS,
    CUSTOM_KEY, CUSTOM_ID, loadCustomStage, installCustomStage, clearCustomStage, builtinStages
  };
})(window);
