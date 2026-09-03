/* =========================================================================
 * model3d.js — 人型3Dキャラクター（骨格 / 装備 / 手続きアニメ / ラスタライザ）
 *
 * 既存のレイキャスティング描画を捨てずに、キャラクターと武器だけを
 * 「本物の3D形状」として描くための土台。板ポリ（ビルボード）ではなく、
 * 骨に沿って並べた角柱の集合を毎フレーム姿勢計算して画面へ投影する。
 *
 *   キャラクター座標系:  +X = 前, +Y = 左, +Z = 上   原点 = 足元の中心
 *   身長 1.0 に正規化して定義し、描画時に世界の大きさへ拡大する。
 *
 *   骨格:
 *     pelvis ─ spine ─ chest ─ neck ─ head
 *                   ├ armL(upper→lower→hand)
 *                   └ armR(upper→lower→hand)
 *     pelvis ├ legL(upper→lower→foot)
 *            └ legR(upper→lower→foot)
 * ======================================================================= */
(function (g) {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* =======================================================================
   * 1. 骨格の定義
   *  pos は親の原点からの相対位置（身長1.0基準）。
   *  各骨のローカル -Z 方向が「骨の伸びる向き」。
   * ===================================================================== */
  const RIG = [
    { name: 'pelvis', parent: null, pos: [0, 0, 0.50] },
    { name: 'spine', parent: 'pelvis', pos: [0, 0, 0.09] },
    { name: 'chest', parent: 'spine', pos: [0, 0, 0.12] },
    { name: 'neck', parent: 'chest', pos: [0, 0, 0.09] },
    { name: 'head', parent: 'neck', pos: [0, 0, 0.045] },

    { name: 'shoulderL', parent: 'chest', pos: [0, 0.105, 0.085] },
    { name: 'armLU', parent: 'shoulderL', pos: [0, 0.022, -0.012] },
    { name: 'armLL', parent: 'armLU', pos: [0, 0, -0.155] },
    { name: 'handL', parent: 'armLL', pos: [0, 0, -0.150] },

    { name: 'shoulderR', parent: 'chest', pos: [0, -0.105, 0.085] },
    { name: 'armRU', parent: 'shoulderR', pos: [0, -0.022, -0.012] },
    { name: 'armRL', parent: 'armRU', pos: [0, 0, -0.155] },
    { name: 'handR', parent: 'armRL', pos: [0, 0, -0.150] },

    { name: 'legLU', parent: 'pelvis', pos: [0, 0.068, -0.015] },
    { name: 'legLL', parent: 'legLU', pos: [0, 0, -0.225] },
    { name: 'footL', parent: 'legLL', pos: [0, 0, -0.215] },

    { name: 'legRU', parent: 'pelvis', pos: [0, -0.068, -0.015] },
    { name: 'legRL', parent: 'legRU', pos: [0, 0, -0.225] },
    { name: 'footR', parent: 'legRL', pos: [0, 0, -0.215] }
  ];

  const BONE_INDEX = {};
  RIG.forEach((b, i) => { BONE_INDEX[b.name] = i; });

  /* =======================================================================
   * 2. 体のパーツ（角柱）
   *   a→b の間を、断面 r0→r1 の N角柱で埋める。
   *   col は palette のキー。sides=4 で箱、6 で腕脚、8 で頭。
   * ===================================================================== */
  function part(bone, a, b, r0, r1, sides, col, opt) {
    return Object.assign({ bone, a, b, r0, r1, sides, col }, opt || {});
  }

  /** 素体。体格(build)と身長は描画時に係数で効かせる */
  function bodyParts() {
    return [
      // 胴。腰でくびれ、胸で広がるようにして「板」に見せない
      part('pelvis', [0, 0, -0.050], [0, 0, 0.050], [0.072, 0.094], [0.064, 0.084], 8, 'pants'),
      part('spine', [0, 0, -0.012], [0, 0, 0.100], [0.062, 0.082], [0.072, 0.100], 8, 'main'),
      part('chest', [0, 0, -0.005], [0, 0, 0.088], [0.076, 0.106], [0.062, 0.088], 8, 'main'),
      part('neck', [-0.004, 0, -0.015], [-0.004, 0, 0.048], [0.034, 0.036], [0.034, 0.038], 6, 'skin'),
      // 頭。顎→頭蓋→頭頂の3段。少し大きめにして小さな画面でも顔の向きが分かるように
      part('head', [0.004, 0, -0.005], [-0.004, 0, 0.048], [0.052, 0.055], [0.068, 0.071], 8, 'skin'),
      part('head', [-0.004, 0, 0.048], [-0.006, 0, 0.112], [0.068, 0.071], [0.070, 0.073], 8, 'skin'),
      part('head', [-0.006, 0, 0.112], [-0.004, 0, 0.150], [0.070, 0.073], [0.040, 0.046], 8, 'skin'),
      part('head', [0.052, 0, 0.060], [0.070, 0, 0.056], [0.026, 0.044], [0.014, 0.030], 6, 'skin'), // 鼻梁
      part('head', [0.040, 0, 0.006], [0.058, 0, 0.014], [0.024, 0.038], [0.014, 0.026], 6, 'skin'), // 顎

      part('shoulderL', [0, -0.012, 0.014], [0, 0.030, -0.010], [0.044, 0.046], [0.036, 0.038], 6, 'main'),
      part('armLU', [0, 0, 0.014], [0, 0, -0.148], [0.037, 0.038], [0.029, 0.030], 6, 'main'),
      part('armLL', [0, 0, 0.004], [0, 0, -0.145], [0.029, 0.030], [0.023, 0.024], 6, 'skin'),
      part('handL', [0, 0, 0], [0.006, 0, -0.050], [0.025, 0.021], [0.021, 0.017], 6, 'skin'),

      part('shoulderR', [0, 0.012, 0.014], [0, -0.030, -0.010], [0.044, 0.046], [0.036, 0.038], 6, 'main'),
      part('armRU', [0, 0, 0.014], [0, 0, -0.148], [0.037, 0.038], [0.029, 0.030], 6, 'main'),
      part('armRL', [0, 0, 0.004], [0, 0, -0.145], [0.029, 0.030], [0.023, 0.024], 6, 'skin'),
      part('handR', [0, 0, 0], [0.006, 0, -0.050], [0.025, 0.021], [0.021, 0.017], 6, 'skin'),

      part('legLU', [0, 0, 0.030], [0, 0, -0.218], [0.055, 0.058], [0.042, 0.044], 6, 'pants'),
      part('legLL', [0, 0, 0.006], [0, 0, -0.208], [0.042, 0.044], [0.030, 0.032], 6, 'pants'),
      part('footL', [-0.024, 0, -0.014], [0.062, 0, -0.022], [0.030, 0.034], [0.024, 0.028], 6, 'boot'),

      part('legRU', [0, 0, 0.030], [0, 0, -0.218], [0.055, 0.058], [0.042, 0.044], 6, 'pants'),
      part('legRL', [0, 0, 0.006], [0, 0, -0.208], [0.042, 0.044], [0.030, 0.032], 6, 'pants'),
      part('footR', [-0.024, 0, -0.014], [0.062, 0, -0.022], [0.030, 0.034], [0.024, 0.028], 6, 'boot')
    ];
  }

  /**
   * 一人称で描くぶんの腕。肘まで描くとカメラに近すぎて画面を覆うので、
   * 手首から先＋手袋だけを出す（FPSのビューモデルの定石）。
   */
  /**
   * 一人称のビューモデル一式（武器＋両手＋袖）。
   * 三人称の腕をそのまま映すと、手がカメラのすぐ手前に来て画面を覆うため、
   * FPSの定石どおり「視点空間に置いた武器」に手を直付けした専用の組物を使う。
   * すべて武器ローカル座標（-Z=銃口方向 / +X=上 / +Y=左）。
   */
  function vmParts(cls) {
    const k = WEAPON_CLASS[cls] || WEAPON_CLASS.AR;
    const s = k.s;
    const w = weaponParts(cls, 'vm');
    // 画面では武器が主役なので、一人称のときだけ銃を少し太く見せる
    const FAT = 1.4;
    const gun = w.parts.map(pt => Object.assign({}, pt, {
      r0: [pt.r0[0] * FAT, pt.r0[1] * FAT],
      r1: [pt.r1[0] * FAT, pt.r1[1] * FAT]
    }));
    const grip = -0.045 - 0.02 * s;
    const fore = w.muzzle[2] * 0.55;
    const hands = [
      // 右手（グリップ）と、そこから画面下へ伸びる袖
      part('vm', [-0.014, 0, grip + 0.022], [-0.050, 0, grip - 0.004], [0.025, 0.022], [0.022, 0.020], 6, 'glove'),
      part('vm', [-0.048, -0.010, grip - 0.004], [-0.118, -0.058, grip + 0.076], [0.023, 0.021], [0.027, 0.025], 6, 'sleeve'),
      // 左手（ハンドガード）と袖
      part('vm', [0.008, 0.026, fore], [0.008, -0.026, fore], [0.023, 0.021], [0.023, 0.021], 6, 'glove'),
      part('vm', [0.002, 0.024, fore + 0.010], [-0.100, 0.072, fore + 0.086], [0.022, 0.020], [0.026, 0.024], 6, 'sleeve')
    ];
    return { parts: gun.concat(hands), muzzle: w.muzzle };
  }

  /* --- 装備。独立した部品リストとして着脱できる ------------------------ */
  const GEAR = {
    helmet(level) {
      const p = [
        part('head', [-0.006, 0, 0.052], [-0.004, 0, 0.152], [0.076, 0.079], [0.048, 0.054], 8, 'gear'),
        part('head', [0.040, 0, 0.086], [0.082, 0, 0.078], [0.026, 0.070], [0.012, 0.062], 6, 'gear') // ひさし
      ];
      if (level >= 2) p.push(part('head', [-0.014, 0.070, 0.056], [-0.014, 0.080, 0.098], [0.028, 0.016], [0.024, 0.014], 4, 'gear2'),
        part('head', [-0.014, -0.070, 0.056], [-0.014, -0.080, 0.098], [0.028, 0.016], [0.024, 0.014], 4, 'gear2'));
      if (level >= 3) p.push(part('head', [0.062, 0, 0.040], [0.064, 0, 0.086], [0.024, 0.062], [0.022, 0.060], 6, 'visor'));
      return p;
    },
    vest() {
      return [
        part('chest', [0.004, 0, -0.002], [0.004, 0, 0.086], [0.082, 0.110], [0.068, 0.094], 8, 'gear'),
        part('chest', [0.070, 0.040, 0.016], [0.070, 0.040, 0.052], [0.016, 0.022], [0.014, 0.020], 4, 'gear2'),
        part('chest', [0.070, -0.040, 0.016], [0.070, -0.040, 0.052], [0.016, 0.022], [0.014, 0.020], 4, 'gear2')
      ];
    },
    backpack() {
      return [
        part('chest', [-0.084, 0, 0.004], [-0.084, 0, 0.078], [0.038, 0.080], [0.034, 0.072], 4, 'gear2'),
        part('chest', [-0.120, 0, 0.018], [-0.120, 0, 0.058], [0.014, 0.062], [0.012, 0.054], 4, 'gear')
      ];
    },
    pouches() {
      return [
        part('pelvis', [0.020, 0.090, -0.014], [0.020, 0.100, 0.018], [0.024, 0.018], [0.022, 0.016], 4, 'gear'),
        part('pelvis', [0.020, -0.090, -0.014], [0.020, -0.100, 0.018], [0.024, 0.018], [0.022, 0.016], 4, 'gear')
      ];
    },
    gloves() {
      return [
        part('handL', [0, 0, 0.006], [0.004, 0, -0.050], [0.026, 0.022], [0.022, 0.018], 6, 'gear2'),
        part('handR', [0, 0, 0.006], [0.004, 0, -0.050], [0.026, 0.022], [0.022, 0.018], 6, 'gear2')
      ];
    },
    boots() {
      return [
        part('footL', [-0.028, 0, -0.012], [0.066, 0, -0.022], [0.034, 0.038], [0.026, 0.030], 6, 'gear2'),
        part('legLL', [0, 0, -0.145], [0, 0, -0.203], [0.036, 0.038], [0.034, 0.036], 6, 'gear2'),
        part('footR', [-0.028, 0, -0.012], [0.066, 0, -0.022], [0.034, 0.038], [0.026, 0.030], 6, 'gear2'),
        part('legRL', [0, 0, -0.145], [0, 0, -0.203], [0.036, 0.038], [0.034, 0.036], 6, 'gear2')
      ];
    },
    hair(style) {
      if (style === 0) return [];
      if (style === 1) return [part('head', [-0.010, 0, 0.070], [-0.006, 0, 0.150], [0.074, 0.077], [0.044, 0.050], 8, 'hair')];
      return [
        part('head', [-0.012, 0, 0.056], [-0.008, 0, 0.150], [0.076, 0.079], [0.046, 0.052], 8, 'hair'),
        part('head', [-0.052, 0, 0.040], [-0.058, 0, 0.086], [0.030, 0.062], [0.024, 0.052], 6, 'hair')
      ];
    }
  };

  /* =======================================================================
   * 2b. 武器の3Dモデル
   *   右手ボーンに付ける。手のローカル軸は構えたとき
   *     -Z = 前（銃口方向） / +X = 上 / +Y = 左
   *   になるので、そのまま「銃口が向いている方向」と一致する。
   *   WeaponRoot ├ Body ├ Magazine ├ Barrel ├ Muzzle ├ Sight ├ Stock
   * ===================================================================== */
  const WEAPON_CLASS = {
    PISTOL: { s: 0.52, barrel: 0.06, stock: 0, scope: 0 },
    SMG: { s: 0.72, barrel: 0.09, stock: 0.05, scope: 0 },
    AR: { s: 1.00, barrel: 0.13, stock: 0.09, scope: 0 },
    SHOTGUN: { s: 1.05, barrel: 0.15, stock: 0.10, scope: 0, fat: 1.25 },
    LMG: { s: 1.15, barrel: 0.14, stock: 0.09, scope: 0, fat: 1.35 },
    DMR: { s: 1.15, barrel: 0.16, stock: 0.10, scope: 1 },
    SNIPER: { s: 1.30, barrel: 0.19, stock: 0.11, scope: 1 }
  };

  /** 武器クラスから部品リストを作る。muzzle は銃口の位置（手ローカル） */
  function weaponParts(cls, bone) {
    const k = WEAPON_CLASS[cls] || WEAPON_CLASS.AR;
    const s = k.s, fat = k.fat || 1;
    const B = bone || 'weapon';
    const recvEnd = -(0.05 + 0.14 * s);
    const barEnd = recvEnd - k.barrel;
    const list = [
      // Body（レシーバ）
      part(B, [0, 0, -0.03], [0, 0, recvEnd], [0.021 * fat, 0.015 * fat], [0.019 * fat, 0.014 * fat], 4, 'weapon'),
      // Barrel
      part(B, [0, 0, recvEnd], [0, 0, barEnd], [0.009 * fat, 0.009 * fat], [0.008 * fat, 0.008 * fat], 6, 'weapon2'),
      // Magazine
      part(B, [-0.008, 0, recvEnd * 0.55], [-0.052 * s - 0.01, 0, recvEnd * 0.62], [0.019, 0.009], [0.016, 0.008], 4, 'weapon2'),
      // Grip
      part(B, [-0.008, 0, -0.045], [-0.048, 0, -0.018], [0.014, 0.011], [0.012, 0.009], 4, 'weapon2')
    ];
    if (k.stock) list.push(part(B, [0.002, 0, -0.03], [0.004, 0, k.stock], [0.018, 0.012], [0.016, 0.011], 4, 'weapon'));
    // Sight
    list.push(part(B, [0.020 * fat, 0, recvEnd * 0.62], [0.022 * fat, 0, recvEnd * 0.92],
      [0.007, 0.008], [0.006, 0.007], 4, 'weapon2'));
    if (k.scope) list.push(part(B, [0.030, 0, recvEnd * 0.50], [0.032, 0, recvEnd * 0.95],
      [0.013, 0.013], [0.012, 0.012], 6, 'weapon'));
    return { parts: list, muzzle: [0, 0, barEnd - 0.005], length: -barEnd };
  }

  /* =======================================================================
   * 3. キャラクター定義（データとして持つ）
   * ===================================================================== */
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }
  const SKIN = ['#f0c39a', '#d99b6c', '#a9714a', '#7a4d31', '#f6d9b8'];
  const HAIRC = ['#2b2118', '#4a3a2a', '#6b4a2f', '#161616', '#8a6a45'];

  /**
   * 見た目の個体差。id から決まるので毎フレーム同じ姿になる。
   * @returns {CharacterDefinition}
   */
  function defineCharacter(id, palette, opt) {
    const h = hash32(String(id));
    const r = n => ((h >>> n) & 255) / 255;
    const o = opt || {};
    return {
      id: String(id),
      bodyType: r(3) > 0.5 ? 'heavy' : 'slim',
      height: o.height != null ? o.height : lerp(0.94, 1.06, r(0)),
      build: o.build != null ? o.build : lerp(0.90, 1.12, r(3)),
      skin: SKIN[(h >>> 6) % SKIN.length],
      hair: (h >>> 11) % 3,
      hairColor: HAIRC[(h >>> 13) % HAIRC.length],
      helmet: o.helmet != null ? o.helmet : (h >>> 16) % 3,          // 0..2
      vest: o.vest != null ? o.vest : ((h >>> 19) & 1),
      backpack: o.backpack != null ? o.backpack : ((h >>> 21) & 1),
      gloves: 1, boots: 1, pouches: ((h >>> 23) & 1),
      palette: palette || {},
      animationSet: 'humanoid'
    };
  }

  /** 定義から実際の描画パーツ一覧を組み立てる（装備の付け外しはここで完結） */
  function buildParts(def, lod) {
    let list = bodyParts();
    if (lod <= 1) {
      if (def.hair) list = list.concat(GEAR.hair(def.hair));
      if (def.helmet) list = list.concat(GEAR.helmet(def.helmet));
      if (def.vest) list = list.concat(GEAR.vest());
      if (def.backpack) list = list.concat(GEAR.backpack());
      if (def.boots) list = list.concat(GEAR.boots());
    }
    if (lod === 0) {
      if (def.gloves) list = list.concat(GEAR.gloves());
      if (def.pouches) list = list.concat(GEAR.pouches());
    }
    if (lod >= 1) list = list.map(p => Object.assign({}, p, { sides: Math.min(p.sides, 4) }));
    if (lod >= 2) {
      // 遠景は指・鼻・ひさしのような細部を落とす
      list = list.filter(p => (p.r0[0] + p.r0[1]) > 0.055);
    }
    return list;
  }

  /* =======================================================================
   * 4. 姿勢 — 状態から各骨の回転を作る（手続きアニメーション）
   *   すべて「既にゲーム側にある状態」からのみ作るので、
   *   ゲームロジックには一切触らない。
   * ===================================================================== */
  const POSE_KEYS = ['IDLE', 'WALK', 'RUN', 'SPRINT', 'CROUCH', 'PRONE', 'AIM',
    'FIRE', 'RELOAD', 'SWITCH', 'HIT', 'DEATH', 'FALL', 'CHUTE', 'LAND'];

  /** 骨の回転量を入れる箱（毎フレーム使い回す） */
  function newPose() {
    const p = {};
    RIG.forEach(b => { p[b.name] = { rx: 0, ry: 0, rz: 0 }; });
    p._root = { x: 0, y: 0, z: 0, lean: 0, roll: 0, yaw: 0, crouch: 1 };
    return p;
  }

  /**
   * 状態からポーズを組み立てる。
   * @param {object} P     newPose() の箱
   * @param {object} c     combatant（既存のフィールドだけを読む）
   * @param {number} t     アニメ時間
   */
  function animate(P, c, t, opt) {
    opt = opt || {};
    const R0 = P._root;
    for (const k in P) { if (k === '_root') continue; P[k].rx = P[k].ry = P[k].rz = 0; }
    R0.x = R0.y = R0.z = 0; R0.lean = 0; R0.roll = 0; R0.yaw = 0; R0.crouch = 1;

    const dead = !c.alive || c.state === 'dead';
    const stance = c.stance || 'stand';
    const moving = !!c.moving;
    const sprint = !!c.sprinting;
    const aiming = opt.aiming != null ? !!opt.aiming : !!c.aiming;
    const armed = opt.armed != null ? !!opt.armed : !!(c.weapons ? c.weapons[c.wIdx] : c.weapon);

    /* --- 死亡: 倒れ込む ------------------------------------------------ */
    if (dead) {
      const k = clamp((c.deadT || 0) / 0.75, 0, 1);
      const e = 1 - Math.pow(1 - k, 2.2);          // ease-out
      R0.roll = e * 1.52;                           // 横倒し
      R0.z = -e * 0.42;                             // 地面に接するまで落とす
      R0.lean = e * 0.24;
      P.head.ry = 0.30 * e; P.chest.ry = 0.16 * e;
      P.armLU.rx = -0.7 * e; P.armRU.rx = 0.7 * e;
      P.armLU.ry = -0.5 * e; P.armRU.ry = -0.5 * e;
      P.legLU.ry = -0.55 * e; P.legRU.ry = -0.25 * e;
      P.legLL.ry = 0.75 * e; P.legRL.ry = 0.45 * e;
      return P;
    }

    /* --- 降下・パラシュート -------------------------------------------- */
    if (c.state === 'drop') {
      const sw = Math.sin(t * 3.4);
      if (c.chute) {                                 // ぶら下がり
        R0.lean = -0.12 + sw * 0.05;
        P.armLU.rx = -1.55; P.armRU.rx = 1.55;
        P.armLU.ry = -0.55; P.armRU.ry = -0.55;
        P.armLL.ry = -0.35; P.armRL.ry = -0.35;
        P.legLU.ry = -0.45 + sw * 0.10; P.legRU.ry = -0.30 - sw * 0.10;
        P.legLL.ry = 0.55; P.legRL.ry = 0.45;
      } else {                                       // フリーフォール（うつ伏せ）
        R0.lean = 1.15;
        R0.z = 0.16;
        P.armLU.rx = -1.30; P.armRU.rx = 1.30;
        P.armLU.ry = -0.90; P.armRU.ry = -0.90;
        P.armLL.ry = -0.75; P.armRL.ry = -0.75;
        P.legLU.ry = 0.35 + sw * 0.10; P.legRU.ry = 0.35 - sw * 0.10;
        P.legLL.ry = 0.55; P.legRL.ry = 0.55;
        P.head.ry = -0.55;
      }
      return P;
    }

    /* --- 立ちの基本姿勢。棒立ちに見せないよう膝と肘を少し曲げておく --- */
    if (stance === 'stand') {
      P.legLU.ry = -0.05; P.legRU.ry = -0.05;
      P.legLL.ry = 0.11; P.legRL.ry = 0.11;
      P.footL.ry = -0.06; P.footR.ry = -0.06;
      P.legLU.rx = 0.045; P.legRU.rx = -0.045;   // 足を肩幅に開く
      P.armLU.rx = -0.12; P.armRU.rx = 0.12;
      P.armLL.ry = -0.22; P.armRL.ry = -0.22;
    }

    /* --- 姿勢（立ち／しゃがみ／伏せ） ---------------------------------- */
    if (stance === 'crouch') {
      R0.crouch = 0.80; R0.z = -0.12; R0.lean = 0.14;
      P.legLU.ry = -0.62; P.legRU.ry = -0.62;
      P.legLL.ry = 1.20; P.legRL.ry = 1.20;
      P.footL.ry = -0.55; P.footR.ry = -0.55;
      P.pelvis.ry = 0.20;
    } else if (stance === 'prone') {
      R0.lean = 1.42; R0.z = -0.40;
      P.legLU.ry = 0.20; P.legRU.ry = 0.20;
      P.legLU.rx = 0.22; P.legRU.rx = -0.22;
      P.legLL.ry = 0.35; P.legRL.ry = 0.35;
      P.head.ry = -0.75;
    }

    /* --- 移動（歩き／走り／全力） -------------------------------------- */
    const gait = sprint ? 2.0 : (moving ? 1.0 : 0);
    if (gait > 0 && stance !== 'prone') {
      const spd = sprint ? 10.5 : 7.2;
      const amp = sprint ? 0.85 : 0.55;
      const ph = t * spd;
      const s = Math.sin(ph), s2 = Math.sin(ph * 2);
      P.legLU.ry += -s * amp * 0.62;
      P.legRU.ry += s * amp * 0.62;
      P.legLL.ry += clamp(-s, 0, 1) * amp * 0.85 + 0.12;
      P.legRL.ry += clamp(s, 0, 1) * amp * 0.85 + 0.12;
      P.footL.ry += s * 0.22; P.footR.ry += -s * 0.22;
      // 上下動と体のひねり
      R0.z += (Math.abs(s2) * 0.5 - 0.25) * amp * 0.055;
      R0.yaw += s * 0.10 * amp;
      P.chest.rz += -s * 0.14 * amp;
      P.pelvis.rz += s * 0.10 * amp;
      R0.lean += sprint ? 0.20 : 0.07;
      if (!aiming) {                              // 銃を構えていない時だけ腕を振る
        P.armLU.ry += s * amp * 0.70;
        P.armRU.ry += -s * amp * 0.70;
        P.armLL.ry += -0.35 - clamp(s, 0, 1) * 0.3;
        P.armRL.ry += -0.35 - clamp(-s, 0, 1) * 0.3;
      }
    } else if (stance !== 'prone') {
      // 待機。呼吸と体重移動でただの置物にしない
      const br = Math.sin(t * 1.7);
      R0.z += br * 0.006;
      P.chest.ry += br * 0.035;
      P.head.ry += Math.sin(t * 1.3 + 1) * 0.05;
      P.head.rz += Math.sin(t * 0.55) * 0.10;
      if (!aiming) {
        P.armLU.ry += br * 0.05; P.armRU.ry += -br * 0.05;
        P.armLU.rx += -0.10; P.armRU.rx += 0.10;
        P.armLL.ry += -0.30; P.armRL.ry += -0.30;
      }
    }

    /* --- 武器の構え。肘を曲げ、体を半身にして「構えている」形にする --- */
    if (armed) {
      const hi = aiming ? 1 : 0.66;                 // ADSで頬付けする
      P.armRU.ry += -0.95 * hi;
      P.armRU.rx += 0.34 * hi;
      P.armRL.ry += -0.80 * hi;
      P.armRL.rz += -0.34 * hi;
      P.armLU.ry += -1.15 * hi;
      P.armLU.rx += -0.62 * hi;
      P.armLL.ry += -1.05 * hi;
      P.armLL.rz += 0.40 * hi;
      if (aiming && stance === 'stand') {
        R0.yaw += 0.24;                             // 半身に構える
        P.chest.rz += -0.30; P.head.rz += 0.16;
        P.legLU.ry += -0.16; P.legRU.ry += 0.14;    // 左足を前に
        P.legLL.ry += 0.14; P.legRL.ry += 0.18;
        R0.z += -0.012;
      } else if (aiming) { P.chest.rz += -0.16; P.head.rz += 0.10; }
    }

    /* --- 発砲の反動 ---------------------------------------------------- */
    if (c.atkFlash > 0) {
      const k = clamp(c.atkFlash / 0.18, 0, 1);
      P.armRU.ry += 0.30 * k; P.armLU.ry += 0.26 * k;
      P.armRL.ry += 0.22 * k;
      P.chest.ry += -0.10 * k;
      R0.lean += -0.06 * k;
    }

    /* --- リロード（弾倉を抜いて差す） ---------------------------------- */
    if (c.reloading && c.reloadTotal) {
      const k = clamp(1 - c.reloadLeft / c.reloadTotal, 0, 1);
      const s = Math.sin(k * Math.PI);
      P.armLU.ry += 0.95 * s;
      P.armLU.rx += -0.35 * s;
      P.armLL.ry += -0.75 * s;
      P.armRU.ry += 0.22 * s;
      P.chest.ry += 0.10 * s;
      P.head.ry += 0.18 * s;
    }

    /* --- 武器の持ち替え ------------------------------------------------ */
    if (c.switchT > 0 && c.switchTotal) {
      const s = Math.sin(clamp(c.switchT / c.switchTotal, 0, 1) * Math.PI);
      P.armRU.ry += 0.85 * s; P.armLU.ry += 0.75 * s;
      P.chest.ry += 0.12 * s;
    }

    /* --- 被弾のけぞり -------------------------------------------------- */
    if (c.hurtT > 0) {
      const k = clamp(c.hurtT / 0.16, 0, 1);
      P.chest.ry += -0.26 * k;
      P.head.ry += -0.30 * k;
      R0.lean += -0.10 * k;
      P.armLU.rx += -0.25 * k; P.armRU.rx += 0.25 * k;
    }
    return P;
  }

  /** 今の状態を表すアニメ名（テストと表示用） */
  function poseName(c) {
    if (!c.alive || c.state === 'dead') return 'DEATH';
    if (c.state === 'drop') return c.chute ? 'CHUTE' : 'FALL';
    if (c.hurtT > 0) return 'HIT';
    if (c.reloading) return 'RELOAD';
    if (c.switchT > 0) return 'SWITCH';
    if (c.atkFlash > 0) return 'FIRE';
    if (c.stance === 'prone') return 'PRONE';
    if (c.stance === 'crouch') return 'CROUCH';
    if (c.sprinting) return 'SPRINT';
    if (c.moving) return c.aiming ? 'WALK' : 'RUN';
    if (c.aiming) return 'AIM';
    return 'IDLE';
  }

  /* =======================================================================
   * 5. 骨 → 世界行列
   * ===================================================================== */
  // 行列は 9 要素の配列 [m00..m22]（列は基底ベクトル）
  function matMul(a, b, out) {
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) {
      out[r * 3 + cc] = a[r * 3] * b[cc] + a[r * 3 + 1] * b[3 + cc] + a[r * 3 + 2] * b[6 + cc];
    }
    return out;
  }
  function eulerMat(rx, ry, rz, out) {
    // Rz(yaw) * Ry(pitch) * Rx(roll)
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    out[0] = cz * cy; out[1] = cz * sy * sx - sz * cx; out[2] = cz * sy * cx + sz * sx;
    out[3] = sz * cy; out[4] = sz * sy * sx + cz * cx; out[5] = sz * sy * cx - cz * sx;
    out[6] = -sy; out[7] = cy * sx; out[8] = cy * cx;
    return out;
  }

  const _tmpA = new Float32Array(9), _tmpB = new Float32Array(9);

  /** 骨ごとの {m: 行列, o: 原点} を求める */
  function solve(P, scaleXY, scaleZ, out) {
    const res = out || {};
    for (let i = 0; i < RIG.length; i++) {
      const b = RIG[i];
      const r = P[b.name];
      const slot = res[b.name] || (res[b.name] = { m: new Float32Array(9), o: new Float32Array(3) });
      eulerMat(r.rx, r.ry, r.rz, _tmpA);
      if (b.parent) {
        const par = res[b.parent];
        matMul(par.m, _tmpA, slot.m);
        const px = b.pos[0] * scaleXY, py = b.pos[1] * scaleXY, pz = b.pos[2] * scaleZ;
        slot.o[0] = par.o[0] + par.m[0] * px + par.m[1] * py + par.m[2] * pz;
        slot.o[1] = par.o[1] + par.m[3] * px + par.m[4] * py + par.m[5] * pz;
        slot.o[2] = par.o[2] + par.m[6] * px + par.m[7] * py + par.m[8] * pz;
      } else {
        // 根の骨には全身の傾き（lean/roll/yaw）を掛ける
        const R0 = P._root;
        eulerMat(R0.roll, R0.lean, R0.yaw, _tmpB);
        matMul(_tmpB, _tmpA, slot.m);
        slot.o[0] = R0.x * scaleXY;
        slot.o[1] = R0.y * scaleXY;
        slot.o[2] = (b.pos[2] * P._root.crouch + R0.z) * scaleZ;
      }
    }
    return res;
  }

  /* =======================================================================
   * 5b. 武器の保持と腕のIK
   *   「武器の位置と向き」を先に決め、両手をそこへ合わせる。
   *   こうすると銃口は必ず狙っている方向を向き、手は必ずグリップの上に乗る。
   * ===================================================================== */

  /** 局所 -Z が dir を向く行列を作る（ref は肘や銃の上方向のヒント） */
  function aimMatrix(dir, ref, out) {
    const zx = -dir[0], zy = -dir[1], zz = -dir[2];
    let xx = ref[1] * zz - ref[2] * zy;
    let xy = ref[2] * zx - ref[0] * zz;
    let xz = ref[0] * zy - ref[1] * zx;
    let l = Math.hypot(xx, xy, xz);
    if (l < 1e-6) { xx = 1; xy = 0; xz = 0; l = 1; }
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx;
    out[3] = xy; out[4] = yy; out[5] = zy;
    out[6] = xz; out[7] = yz; out[8] = zz;
    return out;
  }

  const _ikv = new Float32Array(3), _ike = new Float32Array(3);
  const _wl = [0, 0, 0], _wp = [0, 0, 0];

  /**
   * 2本の骨で手を target へ届かせる（肘の向きは pole で決める）。
   * sk の上腕・前腕・手の行列と原点を直接書き換える。
   */
  function ik2(sk, upper, lower, hand, target, pole, l1, l2) {
    const S = sk[upper].o;
    let vx = target[0] - S[0], vy = target[1] - S[1], vz = target[2] - S[2];
    let d = Math.hypot(vx, vy, vz) || 1e-5;
    const maxd = (l1 + l2) * 0.995, mind = Math.abs(l1 - l2) + 0.02;
    if (d > maxd) { const k = maxd / d; vx *= k; vy *= k; vz *= k; d = maxd; }
    else if (d < mind) { const k = mind / d; vx *= k; vy *= k; vz *= k; d = mind; }
    const ux = vx / d, uy = vy / d, uz = vz / d;
    const a1 = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    // 回転軸 = 手方向 × pole
    let ax = uy * pole[2] - uz * pole[1];
    let ay = uz * pole[0] - ux * pole[2];
    let az = ux * pole[1] - uy * pole[0];
    let al = Math.hypot(ax, ay, az);
    if (al < 1e-5) { ax = 0; ay = 0; az = 1; al = 1; }
    ax /= al; ay /= al; az /= al;
    // Rodrigues 回転で上腕の向きを出す
    const c = Math.cos(-a1), sn = Math.sin(-a1), t = 1 - c;
    const dot = ax * ux + ay * uy + az * uz;
    const ex = ux * c + (ay * uz - az * uy) * sn + ax * dot * t;
    const ey = uy * c + (az * ux - ax * uz) * sn + ay * dot * t;
    const ez = uz * c + (ax * uy - ay * ux) * sn + az * dot * t;

    _ikv[0] = ex; _ikv[1] = ey; _ikv[2] = ez;
    aimMatrix(_ikv, pole, sk[upper].m);
    const elx = S[0] + ex * l1, ely = S[1] + ey * l1, elz = S[2] + ez * l1;
    const lo = sk[lower];
    lo.o[0] = elx; lo.o[1] = ely; lo.o[2] = elz;
    let fx = target[0] - elx, fy = target[1] - ely, fz = target[2] - elz;
    const fl = Math.hypot(fx, fy, fz) || 1e-5;
    _ike[0] = fx / fl; _ike[1] = fy / fl; _ike[2] = fz / fl;
    aimMatrix(_ike, pole, lo.m);
    const h = sk[hand];
    if (h) {
      h.o[0] = target[0]; h.o[1] = target[1]; h.o[2] = target[2];
      h.m.set(lo.m);
    }
  }

  /**
   * 武器を構える。武器フレーム(sk.weapon)を作り、両手をグリップと前handguardへ。
   * @param opt {aim:0..1, recoil, reloadK, lower:0..1, fp:bool}
   */
  function poseWeapon(sk, opt) {
    const o = opt || {};
    const aim = o.aim || 0;
    const rec = o.recoil || 0;
    const rl = o.reloadK || 0;
    const lower = o.lower || 0;                 // 1 = 銃を下げる（走り・素手待機）

    // 位置: 腰だめ → ADS で目の高さ・中央へ
    // 腕の長さ(0.305)に対して届く範囲に置く。前に出しすぎると肘が伸び切って
    // 一人称の前腕がカメラ方向を向き、見た目が破綻する。
    const px = lerp(0.135, 0.170, aim) - rec * 0.022 - lower * 0.035;
    const py = lerp(-0.100, -0.020, aim) + rl * 0.02;
    const pz = lerp(0.745, 0.850, aim) - lower * 0.10 - rl * 0.06 + rec * 0.012;
    // 向き: 腰だめは少し下向き、ADSで水平
    const dz = lerp(-0.16, 0.0, aim) + rec * 0.16 + lower * -0.35;
    const dy = lerp(0.10, 0.0, aim) + rl * 0.12;
    // 一人称では銃を真正面に向けると真後ろから見る形になり形が分からないので、
    // FPSの慣習どおりわずかに傾けて側面を見せる（弾は照準の位置から出る）
    const cy2 = Math.cos(o.cantYaw || 0), sy2 = Math.sin(o.cantYaw || 0);
    const cp2 = Math.cos(o.cantPitch || 0), sp2 = Math.sin(o.cantPitch || 0);
    let ddx = 1, ddy = dy, ddz = dz;
    let t2 = ddx * cy2 - ddy * sy2; ddy = ddx * sy2 + ddy * cy2; ddx = t2;
    t2 = ddx * cp2 + ddz * sp2; ddz = -ddx * sp2 + ddz * cp2; ddx = t2;
    const dl = Math.hypot(ddx, ddy, ddz);
    const dir = [ddx / dl, ddy / dl, ddz / dl];
    const w = sk.weapon || (sk.weapon = { m: new Float32Array(9), o: new Float32Array(3) });
    aimMatrix(dir, [0, 0, 1], w.m);
    // 位置は胸のボーンを基準にする。こうすると、しゃがみ・伏せ・のけぞりで
    // 上体が下がったときに武器も一緒に下がり、頭上に構える形にならない。
    const CHEST_Z = 0.71;
    _wl[0] = px; _wl[1] = py; _wl[2] = pz - CHEST_Z;
    boneToChar(sk, 'chest', _wl, 1, 1, _wp);
    w.o[0] = _wp[0]; w.o[1] = _wp[1]; w.o[2] = _wp[2];

    // 手の位置（武器ローカル: -Z が銃口方向）
    const grip = [0.004, 0, -0.028];
    const fore = [-0.004, 0, -0.185 - aim * 0.02];
    const rt = [0, 0, 0], lt = [0, 0, 0];
    boneToChar(sk, 'weapon', grip, 1, 1, rt);
    boneToChar(sk, 'weapon', fore, 1, 1, lt);
    if (rl > 0) {                                // リロード中は左手が弾倉へ下がる
      lt[0] -= 0.05 * rl; lt[1] -= 0.04 * rl; lt[2] -= 0.16 * rl;
    }
    const poleR = o.fp ? [-0.15, -0.35, -1] : [-0.35, -0.55, -0.85];
    const poleL = o.fp ? [-0.15, 0.35, -1] : [-0.35, 0.55, -0.85];
    ik2(sk, 'armRU', 'armRL', 'handR', rt, poleR, 0.155, 0.150);
    ik2(sk, 'armLU', 'armLL', 'handL', lt, poleL, 0.155, 0.150);
    return w;
  }

  /** 骨ローカル座標 → キャラ座標 */
  function boneToChar(sk, boneName, v, sxy, sz, out) {
    const b = sk[boneName];
    const x = v[0] * sxy, y = v[1] * sxy, z = v[2] * sz;
    out[0] = b.o[0] + b.m[0] * x + b.m[1] * y + b.m[2] * z;
    out[1] = b.o[1] + b.m[3] * x + b.m[4] * y + b.m[5] * z;
    out[2] = b.o[2] + b.m[6] * x + b.m[7] * y + b.m[8] * z;
    return out;
  }

  g.Model3D = {
    RIG, BONE_INDEX, POSE_KEYS, GEAR,
    hash32, defineCharacter, buildParts, bodyParts, vmParts, weaponParts, WEAPON_CLASS,
    newPose, animate, poseName, solve, boneToChar,
    matMul, eulerMat, aimMatrix, ik2, poseWeapon
  };
})(window);
