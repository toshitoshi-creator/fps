/* ===== glchar.js — 人物・武器・小物の3Dメッシュ（WebGL用） ====================
 * 骨格とアニメーションは Model3D をそのまま使い（当たり判定・一人称と共通）、
 * 見た目だけを写実寄り（PUBG系）に作り直す。
 *   ・服: 上着 / パンツ（迷彩あり）/ ブーツ / 手袋。個体ごとに服装が変わる
 *   ・装備: 実際に拾った「ヘルメットLv」「ベストLv」が見た目に出る
 *   ・武器: クラスごとに別の形（AR / SMG / SG / LMG / DMR / SR / HG）
 * 頂点: pos3 nrm3 uv2 col3 bone1 layer1 = 13要素
 * ========================================================================= */
(function (g) {
  'use strict';

  const STRIDE = 13;
  const BONES = Model3D.RIG.map(b => b.name).concat(['weapon']);
  const BI = {}; BONES.forEach((b, i) => { BI[b] = i; });
  const lin = h => GLC.lin(h);
  const PROF = Model3D.PROF;

  function part(bone, a, b, r0, r1, sides, col, opt) {
    return Object.assign({ bone, a, b, r0, r1, sides, col, mat: 'cloth' }, opt || {});
  }
  function ball(bone, c, rx, ry, rz, sides, col, mat, prof) {
    return part(bone, [c[0], c[1], c[2] - rz], [c[0], c[1], c[2] + rz], [rx, ry], [rx, ry], sides, col, { prof: prof || PROF.sph5, mat: mat || 'skin' });
  }
  /** 箱（a→b が長さ方向、r = [高さ方向の半径, 横方向の半径]）。面ごとに法線を立てる */
  function bx(bone, a, b, r0, r1, col, mat, opt) {
    return part(bone, a, b, r0, r1 || r0, 4, col, Object.assign({ box: true, mat: mat || 'polymer' }, opt || {}));
  }

  /* =======================================================================
   * 服装（個体差）
   * ===================================================================== */
  const OUTFITS = [
    { name: 'ranger', shirt: '#5d6448', pants: '#4a4d3a', camo: 'pants', boot: '#3a2e24', glove: '#7a6448' },
    { name: 'civil', shirt: '#c9c4b8', pants: '#34445c', camo: '', boot: '#5a4632', glove: '' },
    { name: 'hoodie', shirt: '#7d2f2a', pants: '#3b3b3e', camo: '', boot: '#2c2c2e', glove: '' },
    { name: 'tactical', shirt: '#2f3540', pants: '#6d6450', camo: '', boot: '#2a241e', glove: '#5a4a38' },
    { name: 'desert', shirt: '#9a8a66', pants: '#8a7b5c', camo: 'both', boot: '#6a5638', glove: '#6a5a44' },
    { name: 'black', shirt: '#2a2a2c', pants: '#2e2e30', camo: '', boot: '#1c1c1c', glove: '#1a1a1a' },
    { name: 'track', shirt: '#2e4a7a', pants: '#26303e', camo: '', boot: '#e0e0dc', glove: '' },
    { name: 'forest', shirt: '#4a5a3a', pants: '#4a5a3a', camo: 'both', boot: '#3a3024', glove: '#2e2e2a' }
  ];
  const SKINS = ['#e6b893', '#d19a72', '#a97452', '#7b4f35', '#f0caa8'];
  const HAIRS = ['#2b2118', '#4a3a2a', '#6b4a2f', '#161616', '#8a6a45', '#a08060'];

  /** 誰がどんな格好か（id から決まる = 毎試合同じ人は同じ服） */
  function lookFor(c) {
    const h = Model3D.hash32(String(c.id || c.name || 'x'));
    const o = c.isPlayer ? OUTFITS[0] : OUTFITS[h % OUTFITS.length];
    return {
      outfit: o,
      skin: SKINS[(h >>> 5) % SKINS.length],
      hair: HAIRS[(h >>> 9) % HAIRS.length],
      hairStyle: (h >>> 13) % 3,
      cap: ((h >>> 15) & 3) === 0,
      build: 0.94 + ((h >>> 17) & 15) / 15 * 0.14,
      height: 0.96 + ((h >>> 21) & 15) / 15 * 0.08,
      pack: 1 + ((h >>> 24) % 3)
    };
  }

  /* =======================================================================
   * 体（写実寄りの比率。顔は小さく、関節はなめらかに）
   * ===================================================================== */
  function bodyParts(look, lod) {
    const P = [];
    const cam = look.outfit.camo;
    const pantsCamo = cam === 'pants' || cam === 'both', shirtCamo = cam === 'both';
    // 腰・胴
    P.push(part('pelvis', [0, 0, -0.058], [0, 0, 0.052], [0.078, 0.100], [0.070, 0.092], 8, 'pants', { prof: PROF.hip, camo: pantsCamo }));
    P.push(part('spine', [0, 0, -0.016], [0, 0, 0.104], [0.068, 0.090], [0.078, 0.106], 8, 'shirt', { prof: PROF.waist, camo: shirtCamo }));
    P.push(part('chest', [0, 0, -0.008], [0, 0, 0.094], [0.082, 0.112], [0.064, 0.094], 8, 'shirt', { prof: PROF.chest, camo: shirtCamo }));
    P.push(part('chest', [-0.010, 0, 0.060], [-0.006, 0, 0.100], [0.056, 0.100], [0.042, 0.072], 8, 'shirt', { ao: 0.9, camo: shirtCamo }));
    // 襟
    P.push(part('neck', [-0.004, 0, -0.030], [-0.004, 0, -0.004], [0.046, 0.050], [0.040, 0.044], 8, 'shirt', {}));
    P.push(part('neck', [-0.004, 0, -0.020], [-0.004, 0, 0.050], [0.033, 0.035], [0.031, 0.034], 8, 'skin', { mat: 'skin', ao: 0.8 }));
    // 頭（卵形）+ 顎 + 鼻 + 耳 + 眉
    P.push(part('head', [0.006, 0, -0.006], [-0.006, 0, 0.150], [0.074, 0.066], [0.078, 0.068], 10, 'skin',
      { prof: [[0.00, 0.50, 0.55], [0.14, 0.82, 0.84], [0.40, 0.98, 1.00], [0.70, 1.00, 1.00], [0.90, 0.84, 0.86], [1.00, 0.40, 0.44]], mat: 'skin' }));
    if (lod === 0) {
      P.push(part('head', [0.056, 0, 0.066], [0.074, 0, 0.050], [0.016, 0.012], [0.009, 0.008], 6, 'skin', { mat: 'skin' }));      // 鼻
      P.push(part('head', [0.052, 0, 0.090], [0.060, 0, 0.088], [0.010, 0.050], [0.008, 0.046], 6, 'hairc', { mat: 'hair' }));    // 眉
      P.push(ball('head', [0.058, 0.026, 0.076], 0.006, 0.010, 0.005, 6, 'eye', 'glass', PROF.sph3));
      P.push(ball('head', [0.058, -0.026, 0.076], 0.006, 0.010, 0.005, 6, 'eye', 'glass', PROF.sph3));
      P.push(part('head', [0.060, 0.018, 0.036], [0.060, -0.018, 0.036], [0.004, 0.005], [0.004, 0.005], 4, 'lip', { mat: 'skin', box: true }));
      P.push(ball('head', [-0.006, 0.068, 0.064], 0.018, 0.008, 0.022, 6, 'skin', 'skin', PROF.sph3));
      P.push(ball('head', [-0.006, -0.068, 0.064], 0.018, 0.008, 0.022, 6, 'skin', 'skin', PROF.sph3));
    }
    // 腕（長袖。手首から先は手袋か素手）
    const glove = !!look.outfit.glove;
    [['L', 1], ['R', -1]].forEach(([S, sgn]) => {
      P.push(ball('shoulder' + S, [0, sgn * 0.010, 0.002], 0.048, 0.048, 0.046, 8, 'shirt', 'cloth', PROF.sph4));
      P.push(part('arm' + S + 'U', [0, 0, 0.006], [0, 0, -0.152], [0.040, 0.041], [0.033, 0.034], 8, 'shirt', { prof: PROF.limbUp, camo: shirtCamo }));
      P.push(ball('arm' + S + 'L', [0, 0, 0.004], 0.033, 0.034, 0.032, 8, 'shirt', 'cloth', PROF.sph4));
      P.push(part('arm' + S + 'L', [0, 0, -0.004], [0, 0, -0.128], [0.032, 0.033], [0.026, 0.027], 8, 'shirt', { prof: PROF.limbLo, camo: shirtCamo }));
      P.push(part('arm' + S + 'L', [0, 0, -0.118], [0, 0, -0.146], [0.028, 0.029], [0.030, 0.031], 8, 'shirt', { ao: 0.85 }));   // 袖口
      const hc = glove ? 'glove' : 'skin', hm = glove ? 'rubber' : 'skin';
      P.push(part('hand' + S, [0, 0, 0.006], [0.004, 0, -0.042], [0.025, 0.018], [0.024, 0.017], 8, hc, { prof: PROF.sph5, mat: hm }));
      P.push(part('hand' + S, [0.004, 0, -0.038], [0.008, 0, -0.064], [0.022, 0.016], [0.016, 0.012], 6, hc, { mat: hm }));
      P.push(part('hand' + S, [0.006, sgn * 0.015, -0.014], [0.020, sgn * 0.025, -0.036], [0.010, 0.009], [0.008, 0.008], 6, hc, { mat: hm }));
    });
    // 脚（パンツ + ブーツ）
    [['L', 1], ['R', -1]].forEach(([S]) => {
      P.push(ball('leg' + S + 'U', [0, 0, 0.012], 0.058, 0.060, 0.052, 8, 'pants', 'cloth', PROF.sph4));
      P.push(part('leg' + S + 'U', [0, 0, 0.020], [0, 0, -0.218], [0.060, 0.063], [0.046, 0.048], 8, 'pants', { prof: PROF.limbUp, camo: pantsCamo }));
      P.push(ball('leg' + S + 'L', [0, 0, 0.006], 0.047, 0.049, 0.046, 8, 'pants', 'cloth', PROF.sph4));
      P.push(part('leg' + S + 'L', [0, 0, 0.000], [0, 0, -0.150], [0.046, 0.048], [0.036, 0.038], 8, 'pants', { prof: PROF.limbLo, camo: pantsCamo }));
      // ブーツの筒
      P.push(part('leg' + S + 'L', [0, 0, -0.130], [0, 0, -0.212], [0.040, 0.042], [0.037, 0.039], 8, 'boot', { mat: 'rubber', prof: PROF.waist }));
      P.push(part('foot' + S, [-0.030, 0, -0.012], [0.032, 0, -0.022], [0.034, 0.038], [0.031, 0.037], 8, 'boot', { prof: PROF.waist, mat: 'rubber' }));
      P.push(part('foot' + S, [0.030, 0, -0.022], [0.072, 0, -0.026], [0.029, 0.036], [0.016, 0.028], 8, 'boot', { mat: 'rubber' }));
      P.push(bx('foot' + S, [-0.036, 0, -0.034], [0.074, 0, -0.036], [0.008, 0.036], [0.008, 0.030], 'sole', 'rubber'));
      // 膝当て
      if (lod === 0 && look.outfit.name !== 'civil' && look.outfit.name !== 'track') {
        P.push(part('leg' + S + 'L', [0.030, 0, 0.030], [0.040, 0, -0.030], [0.020, 0.036], [0.018, 0.032], 6, 'gear2', { mat: 'polymer', prof: PROF.waist }));
      }
    });
    // 髪 / 帽子
    if (look.cap) {
      P.push(part('head', [-0.006, 0, 0.080], [-0.004, 0, 0.160], [0.080, 0.072], [0.080, 0.072], 10, 'cap',
        { prof: [[0.00, 0.99, 0.99], [0.40, 1.00, 1.00], [0.80, 0.86, 0.88], [1.00, 0.40, 0.42]], mat: 'cloth' }));
      P.push(part('head', [0.050, 0, 0.096], [0.110, 0, 0.090], [0.010, 0.060], [0.006, 0.054], 8, 'cap', { mat: 'cloth' }));
    } else {
      // 0 = 坊主に近い短髪 / 1 = 普通 / 2 = 襟足が長い
      const k = look.hairStyle === 0 ? 0.985 : 1.01;
      P.push(part('head', [-0.010, 0, look.hairStyle === 0 ? 0.070 : 0.056], [-0.006, 0, 0.156], [0.080, 0.070], [0.080, 0.070], 10, 'hairc',
        { prof: [[0.00, 0.92 * k, 0.94 * k], [0.35, k, k], [0.72, 0.95 * k, 0.95 * k], [1.00, 0.46, 0.48]], mat: 'hair' }));
      if (look.hairStyle === 2) P.push(part('head', [-0.060, 0, 0.020], [-0.074, 0, 0.080], [0.030, 0.058], [0.024, 0.050], 8, 'hairc', { prof: PROF.waist, mat: 'hair' }));
    }
    // ベルト + ポーチ
    P.push(part('pelvis', [0, 0, 0.032], [0, 0, 0.050], [0.082, 0.104], [0.082, 0.104], 8, 'belt', { mat: 'rubber', ao: 0.85 }));
    if (lod === 0) {
      P.push(bx('pelvis', [0.010, 0.100, -0.010], [0.010, 0.106, 0.028], [0.024, 0.012], null, 'gear', 'gear'));
      P.push(bx('pelvis', [-0.030, -0.098, -0.010], [-0.030, -0.104, 0.028], [0.022, 0.012], null, 'gear', 'gear'));
    }
    return P;
  }

  /* --- 装備: ヘルメット / ベスト / バックパック（レベルで形が変わる） --- */
  function gearParts(helmet, vest, pack) {
    const P = [];
    if (helmet === 1) {
      // Lv1: バイク用風の丸いヘルメット
      P.push(part('head', [-0.006, 0, 0.034], [-0.004, 0, 0.170], [0.090, 0.082], [0.090, 0.082], 10, 'helm1',
        { prof: [[0.00, 0.88, 0.88], [0.22, 1.00, 1.00], [0.55, 1.00, 1.00], [0.80, 0.88, 0.88], [1.00, 0.46, 0.48]], mat: 'polymer' }));
      P.push(part('head', [0.050, 0.070, 0.050], [0.050, -0.070, 0.050], [0.006, 0.006], [0.006, 0.006], 6, 'gear2', { mat: 'rubber' }));
    } else if (helmet === 2) {
      // Lv2: 軍用ヘルメット（カバー + バンド）
      P.push(part('head', [-0.008, 0, 0.046], [-0.006, 0, 0.166], [0.092, 0.084], [0.092, 0.084], 10, 'helm2',
        { prof: [[0.00, 0.96, 0.96], [0.20, 1.02, 1.02], [0.52, 1.00, 1.00], [0.80, 0.86, 0.86], [1.00, 0.44, 0.46]], mat: 'cloth', camo: true }));
      P.push(part('head', [-0.008, 0, 0.074], [-0.008, 0, 0.086], [0.093, 0.086], [0.092, 0.085], 10, 'gear2', { mat: 'rubber', ao: 0.8 }));
      P.push(part('head', [0.060, 0, 0.090], [0.096, 0, 0.082], [0.010, 0.066], [0.006, 0.058], 8, 'helm2', { mat: 'cloth' }));
    } else if (helmet >= 3) {
      // Lv3: 特殊部隊用（フェイスガード付き）
      P.push(part('head', [-0.008, 0, 0.030], [-0.006, 0, 0.170], [0.096, 0.088], [0.096, 0.088], 10, 'helm3',
        { prof: [[0.00, 0.98, 0.98], [0.20, 1.03, 1.03], [0.55, 1.00, 1.00], [0.82, 0.86, 0.86], [1.00, 0.42, 0.44]], mat: 'polymer' }));
      P.push(part('head', [0.074, 0, 0.020], [0.086, 0, 0.100], [0.030, 0.074], [0.028, 0.070], 8, 'helm3', { prof: PROF.waist, mat: 'metal' }));
      P.push(bx('head', [0.090, 0.040, 0.066], [0.090, -0.040, 0.066], [0.006, 0.012], null, 'gear2', 'metal'));
      P.push(bx('head', [0.090, 0.040, 0.046], [0.090, -0.040, 0.046], [0.006, 0.012], null, 'gear2', 'metal'));
    }
    if (vest >= 1) {
      const vc = 'vest' + vest;
      P.push(part('chest', [0.004, 0, -0.024], [0.004, 0, 0.090], [0.092, 0.120], [0.074, 0.104], 8, vc, { prof: PROF.chest, mat: 'gear' }));
      P.push(part('spine', [0.004, 0, 0.020], [0.004, 0, 0.108], [0.086, 0.110], [0.090, 0.116], 8, vc, { mat: 'gear' }));
      // 肩ベルト
      P.push(bx('chest', [0.040, 0.062, 0.086], [-0.040, 0.062, 0.086], [0.010, 0.020], null, vc, 'gear'));
      P.push(bx('chest', [0.040, -0.062, 0.086], [-0.040, -0.062, 0.086], [0.010, 0.020], null, vc, 'gear'));
      if (vest >= 2) {
        // マガジンポーチ（前面に3つ）
        [-0.042, 0, 0.042].forEach(y => P.push(bx('chest', [0.088, y, -0.010], [0.092, y, 0.040], [0.018, 0.018], null, 'gear2', 'gear')));
        P.push(bx('spine', [0.090, 0.050, 0.030], [0.094, 0.050, 0.070], [0.016, 0.022], null, 'gear2', 'gear'));
      }
      if (vest >= 3) {
        // 襟と肩の防護
        P.push(part('chest', [-0.006, 0, 0.078], [-0.006, 0, 0.114], [0.070, 0.098], [0.056, 0.084], 8, vc, { mat: 'gear', ao: 0.85 }));
        P.push(ball('shoulderL', [0.004, 0.018, 0.012], 0.054, 0.050, 0.030, 8, vc, 'gear', PROF.sph3));
        P.push(ball('shoulderR', [0.004, -0.018, 0.012], 0.054, 0.050, 0.030, 8, vc, 'gear', PROF.sph3));
        P.push(bx('chest', [0.094, 0.030, 0.050], [0.098, 0.030, 0.074], [0.012, 0.014], null, 'gear2', 'gear'));
      }
    }
    if (pack >= 1) {
      const s = [0, 0.85, 1.0, 1.18][pack];
      P.push(part('chest', [-0.098 * s, 0, -0.040], [-0.098 * s, 0, 0.090 * s], [0.046 * s, 0.086 * s], [0.042 * s, 0.080 * s], 8, 'pack',
        { prof: [[0.00, 0.84, 0.88], [0.25, 1.00, 1.00], [0.80, 1.00, 1.00], [1.00, 0.82, 0.86]], mat: 'gear' }));
      P.push(part('chest', [-0.140 * s, 0, -0.010], [-0.140 * s, 0, 0.050], [0.016, 0.060 * s], [0.014, 0.054 * s], 8, 'pack2', { prof: PROF.waist, mat: 'gear' }));
      P.push(bx('chest', [-0.100 * s, 0.084 * s, -0.020], [-0.100 * s, 0.084 * s, 0.040], [0.022, 0.016], null, 'pack2', 'gear'));
      P.push(bx('chest', [-0.100 * s, -0.084 * s, -0.020], [-0.100 * s, -0.084 * s, 0.040], [0.022, 0.016], null, 'pack2', 'gear'));
      if (pack >= 3) P.push(part('chest', [-0.098, 0.050, 0.112], [-0.098, -0.050, 0.112], [0.030, 0.030], [0.030, 0.030], 8, 'pack2', { mat: 'gear' }));   // 丸めたマット
    }
    return P;
  }

  /* =======================================================================
   * 武器。骨 'weapon'（または 'vm'）のローカル: -Z=銃口 / +X=上 / +Y=左
   * グリップ付近 z≈-0.03、ハンドガード z≈-0.185 に手が来る（Model3D.poseWeapon）
   * ===================================================================== */
  function gunParts(cls, bone, fine) {
    const B = bone || 'weapon';
    const P = [];
    // レールの刻み（一人称のときだけ。近くで見るので細部が効く）
    const rail = (za, zb, x, y, side) => {
      if (!fine) return;
      for (let z = za - 0.006; z > zb; z -= 0.013) {
        if (side) P.push(bx(B, [x, y, z], [x, y, z - 0.006], [0.006, 0.004], null, 'weapon', 'metal'));
        else P.push(bx(B, [x, y, z], [x, y, z - 0.006], [0.004, 0.009], null, 'weapon', 'metal'));
      }
    };
    const M = 'weapon', M2 = 'weapon2', W = 'wood';
    const cyl = (za, zb, r0, r1, col, mat, x, y, sides) =>
      P.push(part(B, [x || 0, y || 0, za], [x || 0, y || 0, zb], [r0, r0], [r1 == null ? r0 : r1, r1 == null ? r0 : r1], sides || 10, col, { mat: mat || 'metal' }));
    const box = (za, zb, hx, hy, col, mat, x, y, hx2, hy2) =>
      P.push(bx(B, [x || 0, y || 0, za], [x || 0, y || 0, zb], [hx, hy], [hx2 == null ? hx : hx2, hy2 == null ? hy : hy2], col, mat || 'metal'));
    const seg = (a, b, hx, hy, col, mat) => P.push(bx(B, a, b, [hx, hy], null, col, mat || 'metal'));
    const grip = (col) => seg([-0.012, 0, -0.030], [-0.068, 0, -0.010], 0.012, 0.012, col || 'grip', 'rubber');
    const scope = (za, zb, r, x) => {
      cyl(za, zb, r, r, M, 'metal', x, 0, 12);
      cyl(za - 0.012, za + 0.004, r * 1.35, r, M, 'metal', x, 0, 12);
      cyl(zb - 0.004, zb + 0.016, r, r * 1.3, M, 'metal', x, 0, 12);
      cyl(zb + 0.016, zb + 0.018, r * 1.2, r * 1.2, 'lens', 'glass', x, 0, 12);
      box(za + 0.02, za + 0.03, 0.012, 0.006, M, 'metal', x - r - 0.004);
      box(zb - 0.03, zb - 0.02, 0.012, 0.006, M, 'metal', x - r - 0.004);
    };
    let muzzle;
    switch (cls) {
      case 'PISTOL': {
        box(0.012, -0.120, 0.016, 0.011, M, 'metal', 0.006);                // スライド
        box(0.000, -0.100, 0.010, 0.010, M2, 'polymer', -0.014);            // フレーム
        seg([-0.010, 0, -0.012], [-0.070, 0, 0.004], 0.013, 0.011, 'grip', 'rubber');
        seg([-0.022, 0, -0.030], [-0.030, 0, -0.056], 0.004, 0.006, M2, 'polymer');
        cyl(-0.120, -0.126, 0.005, 0.005, M2, 'metal', 0.004);
        muzzle = [0.004, 0, -0.128];
        break;
      }
      case 'SMG': {
        box(0.010, -0.170, 0.024, 0.014, M2, 'polymer');                    // レシーバ（箱型）
        box(-0.170, -0.215, 0.018, 0.013, M2, 'polymer');
        cyl(-0.215, -0.262, 0.006, 0.006, M, 'metal');
        cyl(-0.262, -0.282, 0.010, 0.010, M, 'metal');
        seg([-0.022, 0, -0.100], [-0.105, 0, -0.106], 0.016, 0.009, M, 'metal');   // 真っすぐな弾倉
        grip();
        seg([0.004, 0, 0.010], [-0.010, 0, 0.120], 0.006, 0.006, M, 'metal');      // 折り畳みストック
        seg([-0.010, 0, 0.120], [-0.050, 0, 0.126], 0.010, 0.012, M2, 'rubber');
        box(-0.040, -0.090, 0.006, 0.010, M, 'metal', 0.028);                // レール
        rail(-0.010, -0.160, 0.032, 0);
        // 小型ドットサイト（中抜きの枠）
        box(-0.058, -0.086, 0.004, 0.011, M, 'metal', 0.036);
        box(-0.060, -0.084, 0.012, 0.0025, M, 'metal', 0.050, 0.011);
        box(-0.060, -0.084, 0.012, 0.0025, M, 'metal', 0.050, -0.011);
        box(-0.060, -0.084, 0.0025, 0.013, M, 'metal', 0.063);
        muzzle = [0, 0, -0.284];
        break;
      }
      case 'SHOTGUN': {
        box(0.010, -0.120, 0.024, 0.016, M, 'metal');                         // 機関部
        cyl(-0.120, -0.420, 0.010, 0.010, M, 'metal', 0.006, 0, 10);           // 銃身
        cyl(-0.130, -0.390, 0.009, 0.009, M, 'metal', -0.016, 0, 10);          // チューブ弾倉
        box(-0.170, -0.300, 0.018, 0.018, W, 'cloth', -0.014);                 // 木のフォアエンド
        seg([-0.008, 0, 0.004], [-0.050, 0, 0.060], 0.013, 0.012, W, 'cloth');  // グリップ（木）
        seg([-0.020, 0, 0.040], [-0.010, 0, 0.230], 0.030, 0.016, W, 'cloth');  // 木のストック
        seg([-0.030, 0, 0.225], [0.020, 0, 0.232], 0.036, 0.018, 'grip', 'rubber');
        cyl(-0.410, -0.414, 0.004, 0.004, M, 'metal', 0.019, 0, 6);            // 照星
        muzzle = [0.006, 0, -0.424];
        break;
      }
      case 'LMG': {
        box(0.020, -0.200, 0.032, 0.022, M, 'metal');                         // 大きな機関部
        box(0.030, -0.180, 0.008, 0.024, M2, 'metal', 0.034);                  // フィードカバー
        box(-0.200, -0.300, 0.020, 0.018, M2, 'polymer');                      // ハンドガード
        cyl(-0.300, -0.440, 0.009, 0.009, M, 'metal', 0, 0, 10);
        cyl(-0.440, -0.466, 0.013, 0.011, M, 'metal', 0, 0, 10);
        box(-0.070, -0.150, 0.042, 0.030, 'weapon3', 'polymer', -0.058, 0.010); // 箱型弾倉
        grip();
        seg([-0.004, 0, 0.020], [-0.018, 0, 0.170], 0.028, 0.016, M2, 'polymer');
        seg([-0.040, 0, 0.160], [0.018, 0, 0.170], 0.036, 0.018, 'grip', 'rubber');
        seg([-0.018, 0.012, -0.380], [-0.090, 0.040, -0.360], 0.004, 0.004, M, 'metal');  // 二脚
        seg([-0.018, -0.012, -0.380], [-0.090, -0.040, -0.360], 0.004, 0.004, M, 'metal');
        muzzle = [0, 0, -0.470];
        break;
      }
      case 'DMR': {
        box(0.010, -0.170, 0.020, 0.013, M, 'metal');
        seg([-0.012, 0, -0.160], [-0.018, 0, -0.300], 0.016, 0.016, W, 'cloth');  // 木のハンドガード
        cyl(-0.170, -0.420, 0.007, 0.006, M, 'metal', 0.004, 0, 10);
        cyl(-0.420, -0.445, 0.010, 0.010, M, 'metal', 0.004, 0, 10);
        seg([-0.022, 0, -0.080], [-0.080, 0, -0.090], 0.016, 0.008, M, 'metal');
        seg([-0.006, 0, 0.000], [-0.050, 0, 0.040], 0.013, 0.012, W, 'cloth');
        seg([-0.020, 0, 0.030], [-0.006, 0, 0.220], 0.028, 0.015, W, 'cloth');
        seg([-0.030, 0, 0.215], [0.018, 0, 0.222], 0.032, 0.017, 'grip', 'rubber');
        scope(-0.030, -0.150, 0.014, 0.048);
        muzzle = [0.004, 0, -0.448];
        break;
      }
      case 'SNIPER': {
        // ボルトアクション（木の一体ストック + 大型スコープ）
        seg([-0.004, 0, 0.240], [-0.010, 0, -0.330], 0.022, 0.016, W, 'cloth');
        seg([-0.030, 0, 0.060], [-0.020, 0, 0.240], 0.030, 0.015, W, 'cloth');
        seg([-0.040, 0, 0.236], [0.020, 0, 0.244], 0.036, 0.017, 'grip', 'rubber');
        box(0.020, -0.130, 0.018, 0.013, M, 'metal', 0.016);
        cyl(-0.130, -0.520, 0.008, 0.006, M, 'metal', 0.016, 0, 10);
        cyl(-0.520, -0.545, 0.010, 0.010, M, 'metal', 0.016, 0, 10);
        seg([0.020, 0, -0.020], [0.020, -0.050, -0.010], 0.005, 0.005, M, 'metal');   // ボルトハンドル
        P.push(ball(B, [0.020, -0.052, -0.010], 0.008, 0.008, 0.008, 8, M, 'metal'));
        scope(-0.020, -0.200, 0.017, 0.058);
        muzzle = [0.016, 0, -0.548];
        break;
      }
      default: {
        // AR（M4系）
        box(0.012, -0.160, 0.024, 0.015, M, 'metal');                         // レシーバ
        box(0.000, -0.230, 0.004, 0.010, M, 'metal', 0.028);                   // トップレール
        rail(0.000, -0.230, 0.034, 0);
        P.push(part(B, [0, 0, -0.160], [0, 0, -0.270], [0.020, 0.020], [0.020, 0.020], 8, M2, { mat: 'polymer' }));  // 八角のハンドガード
        rail(-0.165, -0.268, 0, 0.021, true); rail(-0.165, -0.268, 0, -0.021, true);
        box(-0.030, -0.070, 0.006, 0.002, 'grip', 'metal', 0.008, -0.0155);    // 排莢口
        box(-0.004, -0.020, 0.004, 0.012, M2, 'metal', 0.022);                 // チャージングハンドル
        cyl(-0.270, -0.330, 0.006, 0.006, M, 'metal', 0, 0, 10);
        cyl(-0.330, -0.360, 0.010, 0.010, M, 'metal', 0, 0, 10);               // フラッシュハイダー
        // 少し湾曲した弾倉
        seg([-0.020, 0, -0.080], [-0.070, 0, -0.092], 0.016, 0.009, M, 'metal');
        seg([-0.068, 0, -0.092], [-0.112, 0, -0.112], 0.015, 0.009, M, 'metal');
        if (fine) for (let k = 0; k < 4; k++) seg([-0.030 - k * 0.018, 0.0092, -0.082 - k * 0.004], [-0.034 - k * 0.018, 0.0092, -0.083 - k * 0.004], 0.012, 0.0012, 'weapon2', 'metal');
        grip();
        seg([-0.022, 0, -0.030], [-0.032, 0, -0.060], 0.004, 0.006, M, 'metal');  // トリガーガード
        cyl(0.012, 0.070, 0.010, 0.010, M, 'metal', 0.006, 0, 8);              // バッファチューブ
        seg([-0.030, 0, 0.060], [0.020, 0, 0.066], 0.012, 0.014, M2, 'polymer'); // ストック
        seg([-0.020, 0, 0.060], [0.012, 0, 0.130], 0.034, 0.014, M2, 'polymer');
        seg([-0.036, 0, 0.126], [0.018, 0, 0.134], 0.036, 0.016, 'grip', 'rubber');
        // ホロサイト（中が抜けた窓。ADSではこの窓越しに赤い点を見る）
        box(-0.050, -0.100, 0.006, 0.014, M, 'metal', 0.034);          // 台座
        box(-0.056, -0.098, 0.018, 0.003, M, 'metal', 0.056, 0.015);   // 左の柱
        box(-0.056, -0.098, 0.018, 0.003, M, 'metal', 0.056, -0.015);  // 右の柱
        box(-0.054, -0.100, 0.003, 0.018, M, 'metal', 0.076);          // 天井
        box(-0.240, -0.250, 0.010, 0.004, M, 'metal', 0.028);                  // 照星
        seg([-0.018, 0, -0.200], [-0.060, 0, -0.205], 0.010, 0.010, M2, 'rubber'); // フォアグリップ
        muzzle = [0, 0, -0.362];
      }
    }
    return { parts: P, muzzle };
  }

  /** 一人称: 武器 + 手袋 + 袖（骨 'vm' ひとつに全部付ける） */
  function vmParts(cls, look) {
    const G = gunParts(cls, 'vm', true);
    const grip = cls === 'PISTOL' ? -0.020 : -0.028;
    const fore = cls === 'PISTOL' ? -0.050 : (cls === 'SMG' ? -0.180 : (cls === 'SNIPER' ? -0.250 : -0.205));
    const hc = look && look.outfit.glove ? 'glove' : 'skin', hm = hc === 'glove' ? 'rubber' : 'skin';
    const P = G.parts.slice();
    // 右手（グリップを握る）
    P.push(part('vm', [-0.010, 0, grip + 0.018], [-0.062, 0, grip + 0.006], [0.026, 0.024], [0.023, 0.022], 10, hc, { mat: hm, prof: PROF.sph5 }));
    P.push(part('vm', [-0.030, 0.016, grip - 0.006], [-0.030, 0.016, grip - 0.030], [0.008, 0.010], [0.007, 0.009], 6, hc, { mat: hm }));
    P.push(part('vm', [-0.056, -0.008, grip + 0.010], [-0.140, -0.050, grip + 0.120], [0.024, 0.024], [0.034, 0.033], 10, 'shirt', { mat: 'cloth' }));
    P.push(part('vm', [-0.056, -0.008, grip + 0.012], [-0.068, -0.012, grip + 0.028], [0.027, 0.027], [0.030, 0.030], 10, 'shirt', { mat: 'cloth', ao: 0.85 }));
    // 左手（ハンドガード）
    if (cls === 'PISTOL') {
      P.push(part('vm', [-0.030, 0.020, grip + 0.010], [-0.060, 0.012, grip - 0.004], [0.024, 0.022], [0.022, 0.020], 10, hc, { mat: hm, prof: PROF.sph5 }));
      P.push(part('vm', [-0.060, 0.020, grip + 0.010], [-0.150, 0.070, grip + 0.120], [0.024, 0.024], [0.033, 0.032], 10, 'shirt', { mat: 'cloth' }));
    } else {
      P.push(part('vm', [0.004, 0.030, fore], [-0.030, 0.020, fore + 0.004], [0.024, 0.020], [0.022, 0.019], 10, hc, { mat: hm, prof: PROF.sph5 }));
      P.push(part('vm', [-0.004, -0.024, fore - 0.004], [-0.020, -0.016, fore - 0.004], [0.008, 0.012], [0.007, 0.010], 6, hc, { mat: hm }));
      P.push(part('vm', [-0.026, 0.028, fore + 0.012], [-0.130, 0.090, fore + 0.130], [0.023, 0.023], [0.033, 0.032], 10, 'shirt', { mat: 'cloth' }));
    }
    return { parts: P, muzzle: G.muzzle };
  }

  /* =======================================================================
   * メッシュ化
   * ===================================================================== */
  const LYR = () => WorldTex.L;
  function layerFor(pt) {
    const Lr = LYR();
    if (pt.camo) return Lr.CAMO;
    switch (pt.mat) {
      case 'skin': return Lr.SKIN;
      case 'metal': case 'polymer': return Lr.GUN;
      case 'glass': return Lr.WHITE;
      case 'rubber': case 'gear': case 'hair': case 'cloth': default:
        return pt.col === 'wood' ? Lr.WOOD : Lr.FABRIC;
    }
  }
  const _v = [0, 0, 0];
  /**
   * 部品リスト → 頂点配列（骨ローカル座標のまま）。
   * @param colors 色キー → 線形RGB
   * @param boneMap 骨名 → 番号
   */
  function meshParts(parts, colors, boneMap, lod) {
    const Bd = new GLC.Builder(STRIDE);
    const RG = Raster3D;
    parts.forEach(pt => {
      const bi = boneMap[pt.bone];
      if (bi == null) return;
      const layer = layerFor(pt);
      let col = colors[pt.col] || colors.shirt || [0.5, 0.5, 0.5];
      if (pt.camo) col = colors.camoTint || [1, 1, 1];
      if (pt.ao) col = [col[0] * pt.ao, col[1] * pt.ao, col[2] * pt.ao];
      const a = pt.a, b = pt.b;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const alen = Math.hypot(dx, dy, dz) || 1e-5;
      const ad = [dx / alen, dy / alen, dz / alen];
      const ax = RG.crossAxes(dx, dy, dz);
      const e1 = [0, 0, 0], e2 = [0, 0, 0];
      e1[ax[0]] = 1; e2[ax[1]] = 1;
      const push = (p, n, u, v) => Bd.push([p[0], p[1], p[2], n[0], n[1], n[2], u, v, col[0], col[1], col[2], bi, layer]);

      if (pt.box) {
        // 箱: 8頂点・6面（断面は e1 × e2 の長方形）
        const r0 = pt.r0, r1 = pt.r1;
        const corner = (t, s1, s2) => {
          const ra = (t ? r1[0] : r0[0]), rb = (t ? r1[1] : r0[1]);
          const c = t ? b : a;
          return [c[0] + e1[0] * ra * s1 + e2[0] * rb * s2, c[1] + e1[1] * ra * s1 + e2[1] * rb * s2, c[2] + e1[2] * ra * s1 + e2[2] * rb * s2];
        };
        const face = (p0, p1, p2, p3, n) => { push(p0, n, 0, 0); push(p1, n, 1, 0); push(p2, n, 1, 1); push(p0, n, 0, 0); push(p2, n, 1, 1); push(p3, n, 0, 1); };
        const C = (t, s1, s2) => corner(t, s1, s2);
        const neg = v => [-v[0], -v[1], -v[2]];
        face(C(0, 1, -1), C(0, 1, 1), C(1, 1, 1), C(1, 1, -1), e1);
        face(C(0, -1, 1), C(0, -1, -1), C(1, -1, -1), C(1, -1, 1), neg(e1));
        face(C(0, -1, 1), C(0, 1, 1), C(1, 1, 1), C(1, -1, 1), e2);
        face(C(0, 1, -1), C(0, -1, -1), C(1, -1, -1), C(1, 1, -1), neg(e2));
        face(C(0, -1, -1), C(0, 1, -1), C(0, 1, 1), C(0, -1, 1), neg(ad));
        face(C(1, -1, -1), C(1, 1, -1), C(1, 1, 1), C(1, -1, 1), ad);
        return;
      }
      let sides = pt.sides;
      if (lod >= 1) sides = Math.min(sides, 6);
      const prof = pt.prof && !(lod >= 2) ? pt.prof : null;
      const K = prof ? prof.length : 2;
      const rings = [];
      for (let k = 0; k < K; k++) {
        const t = prof ? prof[k][0] : k;
        const ps = prof ? prof[k][1] : 1, pd = prof ? prof[k][2] : 1;
        const c = [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
        const ra = (pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t) * ps;
        const rb = (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t) * pd;
        let slope = 0;
        if (K > 2) {
          const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
          const t0 = prof[k0][0], t1 = prof[k1][0];
          const rm = (kk, tt) => ((pt.r0[0] + (pt.r1[0] - pt.r0[0]) * tt) * prof[kk][1] + (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * tt) * prof[kk][2]) * 0.5;
          slope = (rm(k1, t1) - rm(k0, t0)) / (Math.max(1e-4, t1 - t0) * alen);
        } else {
          slope = ((pt.r1[0] + pt.r1[1]) - (pt.r0[0] + pt.r0[1])) * 0.5 / alen;
        }
        const ring = [];
        for (let i = 0; i <= sides; i++) {
          const an = i / sides * Math.PI * 2;
          const co = Math.cos(an), si = Math.sin(an);
          const p = [c[0] + e1[0] * ra * co + e2[0] * rb * si, c[1] + e1[1] * ra * co + e2[1] * rb * si, c[2] + e1[2] * ra * co + e2[2] * rb * si];
          const u0 = co / (ra || 1e-4), u1 = si / (rb || 1e-4);
          let n = [e1[0] * u0 + e2[0] * u1, e1[1] * u0 + e2[1] * u1, e1[2] * u0 + e2[2] * u1];
          let l = Math.hypot(n[0], n[1], n[2]) || 1;
          n = [n[0] / l - ad[0] * slope, n[1] / l - ad[1] * slope, n[2] / l - ad[2] * slope];
          l = Math.hypot(n[0], n[1], n[2]) || 1;
          ring.push({ p, n: [n[0] / l, n[1] / l, n[2] / l], u: i / sides, v: t * alen * 6 });
        }
        rings.push(ring);
      }
      for (let k = 0; k < K - 1; k++) for (let i = 0; i < sides; i++) {
        const A = rings[k][i], Bq = rings[k][i + 1], Cq = rings[k + 1][i + 1], D = rings[k + 1][i];
        push(A.p, A.n, A.u, A.v); push(Bq.p, Bq.n, Bq.u, Bq.v); push(Cq.p, Cq.n, Cq.u, Cq.v);
        push(A.p, A.n, A.u, A.v); push(Cq.p, Cq.n, Cq.u, Cq.v); push(D.p, D.n, D.u, D.v);
      }
      // 蓋
      const r0 = rings[0], rl = rings[K - 1];
      const ca = [a[0] + dx * (prof ? prof[0][0] : 0), a[1] + dy * (prof ? prof[0][0] : 0), a[2] + dz * (prof ? prof[0][0] : 0)];
      const cb = [a[0] + dx * (prof ? prof[K - 1][0] : 1), a[1] + dy * (prof ? prof[K - 1][0] : 1), a[2] + dz * (prof ? prof[K - 1][0] : 1)];
      const na = [-ad[0], -ad[1], -ad[2]];
      for (let i = 0; i < sides; i++) {
        push(ca, na, 0.5, 0.5); push(r0[i + 1].p, na, 0, 0); push(r0[i].p, na, 1, 0);
        push(cb, ad, 0.5, 0.5); push(rl[i].p, ad, 0, 0); push(rl[i + 1].p, ad, 1, 0);
      }
    });
    return Bd.data();
  }
  void _v;

  /** 色キー → 線形色 */
  function colorsFor(look) {
    const o = look.outfit;
    const c = {
      shirt: lin(o.shirt), pants: lin(o.pants), boot: lin(o.boot), sole: lin('#1e1e1e'),
      glove: lin(o.glove || '#2a2a28'), skin: lin(look.skin), hairc: lin(look.hair), cap: lin(o.name === 'track' ? '#2a2a2a' : '#4a4a3a'),
      eye: lin('#1a1612'), lip: lin('#8a5a4a'), belt: lin('#2a2622'),
      gear: lin('#3b3f36'), gear2: lin('#2e312c'),
      helm1: lin('#d8d8d2'), helm2: lin('#5a6248'), helm3: lin('#3e4638'),
      vest1: lin('#2c3446'), vest2: lin('#2a2b2a'), vest3: lin('#4e5540'),
      pack: lin(['#4a4c3a', '#3a3f48', '#5a4a36'][Model3D.hash32(o.name) % 3]), pack2: lin('#34362e'),
      weapon: lin('#3a3e42'), weapon2: lin('#2e3134'), weapon3: lin('#4b5140'), wood: lin('#8a6038'),
      grip: lin('#1c1d1e'), lens: lin('#6a9ab8')
    };
    c.camoTint = o.name === 'desert' ? lin('#e8d8b0') : [1, 1, 1];
    return c;
  }

  const cache = {};
  /** 装備の組み合わせごとに1回だけメッシュ化してキャッシュ */
  function charMesh(look, helmet, vest, pack, wcls, lod) {
    const key = look.outfit.name + look.skin + look.hair + look.hairStyle + (look.cap ? 'c' : '') + '|' + helmet + vest + pack + '|' + (wcls || '-') + '|' + lod;
    let m = cache[key];
    if (m) return m;
    let parts = bodyParts(look, lod);
    if (helmet) parts = parts.filter(p => !(p.col === 'hairc' && p.bone === 'head' && p.mat === 'hair' && p.r0[0] > 0.05) && p.col !== 'cap');
    parts = parts.concat(gearParts(helmet, vest, pack));
    const colors = colorsFor(look);
    let data = meshParts(parts, colors, BI, lod);
    if (wcls) {
      // 銃は「x=上 / y=左」で作ってあるので、Model3D の武器骨（x=右 / y=上）へ回す
      const gd = toWeaponAxes(meshParts(gunParts(wcls, 'weapon').parts, colors, BI, lod));
      const all = new Float32Array(data.length + gd.length);
      all.set(data); all.set(gd, data.length);
      data = all;
    }
    m = cache[key] = { key, data, gl: null };
    return m;
  }
  /** 銃の座標系（x=上, y=左）→ 武器骨の座標系（x=右, y=上） */
  function toWeaponAxes(d) {
    for (let i = 0; i < d.length; i += STRIDE) {
      const x = d[i], y = d[i + 1];
      d[i] = -y; d[i + 1] = x;
      const nx = d[i + 3], ny = d[i + 4];
      d[i + 3] = -ny; d[i + 4] = nx;
    }
    return d;
  }
  function muzzleOf(cls) {
    const m = gunParts(cls, 'weapon').muzzle;
    return [-m[1], m[0], m[2]];
  }

  function vmMesh(wcls, look) {
    const key = 'vm|' + wcls + '|' + look.outfit.name + look.skin;
    let m = cache[key];
    if (m) return m;
    const set = vmParts(wcls, look);
    m = cache[key] = { key, data: meshParts(set.parts, colorsFor(look), { vm: 0 }, 0), muzzle: set.muzzle, gl: null };
    return m;
  }

  /* =======================================================================
   * 小物（輸送機・パラシュート・落ちているアイテム）: lit 形式 12要素
   * ===================================================================== */
  function litFromChar(data) {
    // char形式(13) → lit形式(12)（骨番号を捨てる）
    const n = data.length / STRIDE, out = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const s = i * STRIDE, d = i * 12;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3]; out[d + 4] = data[s + 4]; out[d + 5] = data[s + 5];
      out[d + 6] = data[s + 6]; out[d + 7] = data[s + 7]; out[d + 8] = data[s + 12];
      out[d + 9] = data[s + 8]; out[d + 10] = data[s + 9]; out[d + 11] = data[s + 10];
    }
    return out;
  }

  /** 輸送機（C-130風）。+X が機首、原点が重心、大きさは世界単位 */
  function planeMesh() {
    const Lr = LYR();
    const B = new GLC.Builder(12);
    const Wd = GLWorld;
    const body = lin('#8a9486'), dark = lin('#3a3f3a'), glass = lin('#203040');
    // 胴体: 回転体を横倒しに（輪切りを並べる）
    const segs = [[-8, 0.5], [-6.5, 1.25], [-4, 1.5], [3, 1.5], [5.5, 1.3], [7, 0.95], [7.8, 0.5]];
    const S = 14;
    for (let k = 0; k < segs.length - 1; k++) {
      const [x0, r0] = segs[k], [x1, r1] = segs[k + 1];
      for (let i = 0; i < S; i++) {
        const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
        const P = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r * 0.95 + (x < -4 ? (x + 4) * -0.12 : 0)];
        const N = a => [0, Math.cos(a), Math.sin(a)];
        const q = [P(x0, r0, a0), P(x1, r1, a0), P(x1, r1, a1), P(x0, r0, a1)];
        Wd.quad(B, q[0], q[1], q[2], q[3], N((a0 + a1) / 2), [x0 * 0.2, i / S, x1 * 0.2, i / S, x1 * 0.2, (i + 1) / S, x0 * 0.2, (i + 1) / S], Lr.PLANE, body);
      }
    }
    // 操縦席の窓
    Wd.obox(B, 6.6, 0, 0.55, 0.5, 0.75, 0.35, 0, Lr.WHITE, glass, 1);
    // 主翼（高翼）
    Wd.box(B, -1.2, -9.5, 1.35, 1.2, 9.5, 1.55, Lr.PLANE, body, 0.3);
    // エンジン4基
    [-6.2, -3.4, 3.4, 6.2].forEach(y => {
      Wd.box(B, -0.2, y - 0.35, 0.95, 2.4, y + 0.35, 1.4, Lr.PLANE, shade(body, 0.9), 0.5);
      Wd.box(B, 2.4, y - 0.05, 1.12, 2.5, y + 0.05, 1.22, Lr.GUN, dark, 1);
    });
    // 尾翼
    Wd.box(B, -8.2, -3.8, 1.0, -6.4, 3.8, 1.15, Lr.PLANE, body, 0.3);
    Wd.quad(B, [-8.3, 0, 1.0], [-6.2, 0, 1.0], [-7.4, 0, 4.4], [-8.4, 0, 4.4], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], Lr.PLANE, body);
    Wd.quad(B, [-6.2, 0.02, 1.0], [-8.3, 0.02, 1.0], [-8.4, 0.02, 4.4], [-7.4, 0.02, 4.4], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], Lr.PLANE, body);
    // 開いた後部ランプ
    Wd.quad(B, [-6.6, -1.1, -1.1], [-6.6, 1.1, -1.1], [-9.2, 1.1, -1.9], [-9.2, -1.1, -1.9], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], Lr.PLANE, shade(body, 0.7));
    return B.data();
  }
  function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  /** プロペラ（回転させて描く） */
  function propMesh() {
    const B = new GLC.Builder(12);
    const c = lin('#202020');
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      const dy = Math.cos(a), dz = Math.sin(a);
      GLWorld.quad(B, [0, 0, 0], [0, dy * 1.3 - dz * 0.12, dz * 1.3 + dy * 0.12], [0, dy * 1.3 + dz * 0.12, dz * 1.3 - dy * 0.12], [0, 0, 0], [1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], LYR().GUN, c);
    }
    return B.data();
  }
  /** パラシュートの傘（キャラの頭上）。原点は人物の足元 */
  function chuteMesh() {
    const Lr = LYR();
    const B = new GLC.Builder(12);
    const col = lin('#ffffff');
    const W = 1.35, D = 0.62, Z = 2.05, CURVE = 0.55;
    const SU = 12, SV = 3;
    const P = (u, v) => {
      const a = (u - 0.5) * Math.PI * 0.95;
      return [(v - 0.5) * D * 2, Math.sin(a) * W, Z + Math.cos(a) * CURVE];
    };
    for (let i = 0; i < SU; i++) for (let j = 0; j < SV; j++) {
      const u0 = i / SU, u1 = (i + 1) / SU, v0 = j / SV, v1 = (j + 1) / SV;
      const a = (u0 + u1) / 2 - 0.5;
      const n = [0, Math.sin(a * Math.PI * 0.95), Math.cos(a * Math.PI * 0.95)];
      GLWorld.quad(B, P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), n, [u0, v0, u1, v0, u1, v1, u0, v1], Lr.CHUTE, col);
    }
    // 吊り索
    const lc = lin('#dddddd');
    [[0.02, 0.1], [0.98, 0.1], [0.02, 0.9], [0.98, 0.9], [0.3, 0.5], [0.7, 0.5]].forEach(([u, v]) => {
      const top = P(u, v), bot = [0, (u - 0.5) * 0.12, 0.8];
      GLWorld.quad(B, bot, top, [top[0] + 0.01, top[1], top[2]], [bot[0] + 0.01, bot[1], bot[2]], [1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], Lr.WHITE, lc);
    });
    return B.data();
  }

  /** 落ちているアイテム。種類ごとに形を変える（地面に置いた状態） */
  function lootMesh(kind, id) {
    const Lr = LYR();
    const B = new GLC.Builder(12);
    const Wd = GLWorld;
    if (kind === 'weapon') {
      const def = BRDATA.WEAPON_BY_ID[id];
      const cls = def ? def.cls : 'AR';
      const G = gunParts(cls, 'w');
      const d = litFromChar(meshParts(G.parts, colorsFor(lookFor({ id: 'loot' })), { w: 0 }, 1));
      // 武器ローカル(-Z前 / +X上) → 地面に横倒し: 世界 x = -z, y = y, z = x
      for (let i = 0; i < d.length; i += 12) {
        const x = d[i], y = d[i + 1], z = d[i + 2];
        d[i] = -z * 1.7; d[i + 1] = x * 1.7; d[i + 2] = y * 1.7 + 0.03;
        const nx = d[i + 3], ny = d[i + 4], nz = d[i + 5];
        d[i + 3] = -nz; d[i + 4] = nx; d[i + 5] = ny;
      }
      return d;
    }
    if (kind === 'ammo') {
      const col = lin({ light: '#c8a040', medium: '#5a7a3a', heavy: '#7a3a2a', shell: '#a0402a' }[id] || '#6a6a50');
      Wd.obox(B, 0, 0, 0, 0.13, 0.09, 0.09, 0, Lr.GUN, col, 1);
      Wd.obox(B, 0, 0, 0.09, 0.135, 0.095, 0.012, 0, Lr.GUN, shade(col, 0.7), 1);
      return B.data();
    }
    const def = BRDATA.ITEMS[id] || {};
    if (def.kind === 'armor') {
      const c = lin(['#2c3446', '#2c3446', '#2a2b2a', '#4e5540'][def.level || 1]);
      Wd.obox(B, 0, 0, 0, 0.16, 0.22, 0.05, 0, Lr.FABRIC, c, 1);
      Wd.obox(B, 0.02, 0, 0.05, 0.1, 0.16, 0.035, 0, Lr.FABRIC, shade(c, 0.8), 1);
      return B.data();
    }
    if (def.kind === 'helmet') {
      const c = lin(['#d8d8d2', '#d8d8d2', '#5a6248', '#3e4638'][def.level || 1]);
      Wd.blob(B, 0, 0, 0.02, 0.15, 0.14, 0.12, 0.04, Lr.GUN, c, () => 0.5, true);
      return B.data();
    }
    if (id === 'medkit') {
      Wd.obox(B, 0, 0, 0, 0.16, 0.11, 0.08, 0, Lr.WHITE, lin('#e8e8e4'), 1);
      Wd.obox(B, 0, 0, 0.08, 0.02, 0.07, 0.004, 0, Lr.WHITE, lin('#c02020'), 1);
      Wd.obox(B, 0, 0, 0.08, 0.07, 0.02, 0.004, 0, Lr.WHITE, lin('#c02020'), 1);
      return B.data();
    }
    if (id === 'bandage') {
      Wd.cylinder(B, 0, 0, 0, 0.1, 0.06, 0.06, 10, Lr.FABRIC, lin('#e8e0d0'), true, 1);
      Wd.cylinder(B, 0.1, 0.04, 0, 0.1, 0.06, 0.06, 10, Lr.FABRIC, lin('#e8e0d0'), true, 1);
      return B.data();
    }
    if (id === 'energy') {
      Wd.cylinder(B, 0, 0, 0, 0.18, 0.045, 0.045, 10, Lr.BARREL, lin('#2a6ac0'), true, 1);
      return B.data();
    }
    if (id === 'frag') {
      Wd.blob(B, 0, 0, 0.07, 0.06, 0.06, 0.07, 0.05, Lr.GUN, lin('#4a5238'), () => 0.5, false);
      Wd.cylinder(B, 0, 0, 0.13, 0.16, 0.02, 0.02, 6, Lr.GUN, lin('#8a8a80'), true, 1);
      return B.data();
    }
    Wd.obox(B, 0, 0, 0, 0.1, 0.1, 0.1, 0, Lr.WHITE, lin('#cccccc'), 1);
    return B.data();
  }

  g.GLChar = {
    STRIDE, BONES, BI, OUTFITS, lookFor, bodyParts, gearParts, gunParts, vmParts,
    charMesh, vmMesh, planeMesh, propMesh, chuteMesh, lootMesh, colorsFor, meshParts, muzzleOf, toWeaponAxes
  };
})(window);
