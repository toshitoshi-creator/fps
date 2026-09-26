/* ===== worldtex.js — 手続き生成テクスチャ =====================================
 * 外部アセットを使わずに、写実寄り（PUBG系）の質感を Canvas で描き起こす。
 *
 *   1) 材質レイヤー: 256x256 のタイル可能なテクスチャ群（WebGL2 のテクスチャ配列へ）
 *        RGB = 色 / A = 鏡面の強さ（切り抜き材質では不透明度）
 *   2) 地面: マップ全体を1枚に塗った地表（草・土・砂浜・道路・舗装・畑・床）
 *   3) 地図: 同じ地表から作るUI用の地図（屋根・グリッド・座標つき）
 *
 * すべてマップのシードから決まるので、同じ試合なら毎回同じ見た目になる。
 * ========================================================================= */
(function (g) {
  'use strict';

  const TS = 256;                       // 材質タイルの解像度
  const L = {                           // レイヤー番号
    PLASTER: 0, BRICK: 1, CONCRETE: 2, METAL: 3, WOOD: 4, ROOF: 5, WINDOW: 6,
    CRATE: 7, BARK: 8, NEEDLE: 9, LEAF: 10, ROCK: 11, GRASS: 12, FABRIC: 13,
    CAMO: 14, GUN: 15, INTERIOR: 16, PLANE: 17, CHUTE: 18, WHITE: 19, SKIN: 20,
    BARREL: 21, DETAIL: 22, DOOR: 23
  };
  const LAYERS = 24;

  /* ---------------- 乱数とノイズ ---------------- */
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const PERM = new Float32Array(65536);
  (function () { const r = mulberry(1337); for (let i = 0; i < PERM.length; i++) PERM[i] = r(); })();
  function lat(x, y, p) {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p;
    return PERM[((x * 374761) ^ (y * 668265)) & 65535];
  }
  /** 周期 p で繰り返す値ノイズ（タイル可能） */
  function pn(x, y, p) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = lat(xi, yi, p), b = lat(xi + 1, yi, p), c = lat(xi, yi + 1, p), d = lat(xi + 1, yi + 1, p);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /** fbm。u,v は 0..1 のタイル座標、base は最初の周期 */
  function fbm(u, v, base, oct) {
    let s = 0, amp = 0.5, tot = 0, p = base;
    for (let i = 0; i < (oct || 4); i++) {
      s += pn(u * p, v * p, p) * amp; tot += amp; amp *= 0.5; p *= 2;
    }
    return s / tot;
  }
  // 非周期ノイズ（地面用）
  function vn(x, y) { return pn(x, y, 4096); }
  function vfbm(x, y, oct) {
    let s = 0, amp = 0.5, tot = 0, f = 1;
    for (let i = 0; i < (oct || 4); i++) { s += vn(x * f + i * 17.3, y * f - i * 9.1) * amp; tot += amp; amp *= 0.5; f *= 2.03; }
    return s / tot;
  }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---------------- 材質レイヤー ---------------- */
  function layer(fn) {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const x = c.getContext('2d');
    const id = x.createImageData(TS, TS);
    const d = id.data, out = [0, 0, 0, 255];
    for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
      out[3] = 255;
      fn((px + 0.5) / TS, (py + 0.5) / TS, out, px, py);
      const i = (py * TS + px) * 4;
      d[i] = clamp(out[0], 0, 255); d[i + 1] = clamp(out[1], 0, 255);
      d[i + 2] = clamp(out[2], 0, 255); d[i + 3] = clamp(out[3], 0, 255);
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  function put(o, r, gg, b, a) { o[0] = r; o[1] = gg; o[2] = b; if (a != null) o[3] = a; }

  const MAKERS = {};
  // 漆喰。細かい凹凸と薄い汚れ（色は頂点色で建物ごとに変える）
  MAKERS[L.PLASTER] = (u, v, o) => {
    const n = fbm(u, v, 8, 5), f = fbm(u, v, 64, 2);
    const k = 214 + (n - 0.5) * 38 + (f - 0.5) * 22;
    const stain = sstep(0.62, 0.8, fbm(u + 0.3, v * 0.5, 4, 3)) * 26;
    put(o, k - stain, k - stain * 1.05, k - stain * 1.2, 40);
  };
  // レンガ。8段/1単位、目地、焼きむら
  MAKERS[L.BRICK] = (u, v, o) => {
    const rows = 8, cols = 4;
    const ry = v * rows, row = Math.floor(ry);
    const rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx);
    const fy = ry - row, fx = rx - col;
    const mortar = (fy < 0.10 || fx < 0.05) ? 1 : 0;
    const bn = lat(col, row, 64);
    const n = fbm(u, v, 32, 3);
    if (mortar) { const m = 168 + (n - 0.5) * 30; put(o, m, m - 4, m - 12, 20); return; }
    const base = hex(bn < 0.3 ? '#8a3f2c' : (bn < 0.7 ? '#9c4a33' : '#7a3626'));
    const k = 0.82 + n * 0.36 + (bn - 0.5) * 0.12;
    put(o, base[0] * k, base[1] * k, base[2] * k, 30);
  };
  // コンクリートパネル
  MAKERS[L.CONCRETE] = (u, v, o) => {
    const n = fbm(u, v, 8, 5), f = fbm(u, v, 96, 1);
    let k = 150 + (n - 0.5) * 40 + (f - 0.5) * 18;
    const seamU = Math.abs(u - 0.5) < 0.006 || u < 0.006 || u > 0.994;
    const seamV = v < 0.006 || v > 0.994;
    if (seamU || seamV) k -= 40;
    // 型枠の穴
    const hx = (u * 4) % 1, hy = (v * 4) % 1;
    if (Math.hypot(hx - 0.5, hy - 0.5) < 0.035) k -= 30;
    const streak = sstep(0.5, 0.9, fbm(u * 3, v * 0.3, 8, 2)) * 22;
    put(o, k - streak, k - streak, k - streak * 0.9 + 3, 35);
  };
  // 波板トタン
  MAKERS[L.METAL] = (u, v, o) => {
    const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 12);
    const n = fbm(u, v, 16, 4);
    const rust = sstep(0.6, 0.78, fbm(u, v, 6, 4));
    const k = 118 + rib * 70 + (n - 0.5) * 20;
    put(o, mix(k, 128, rust), mix(k + 4, 74, rust), mix(k + 8, 42, rust), 140 - rust * 110);
  };
  // 下見板張りの木壁
  MAKERS[L.WOOD] = (u, v, o) => {
    const boards = 6;
    const bv = v * boards, b = Math.floor(bv), fb = bv - b;
    const grain = fbm(u * 0.5, v * boards * 0.25 + b * 0.37, 16, 4);
    const tone = lat(b, 3, 97);
    let k = 0.78 + grain * 0.35 + (tone - 0.5) * 0.18;
    if (fb < 0.07) k *= 0.55;                                   // 板の重なりの影
    else if (fb > 0.9) k *= 1.08;
    put(o, 128 * k, 88 * k, 56 * k, 25);
  };
  // 瓦屋根
  MAKERS[L.ROOF] = (u, v, o) => {
    const rows = 7, cols = 7;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx), fx = rx - col;
    const curve = Math.sin(fx * Math.PI);
    const n = fbm(u, v, 16, 3), t = lat(col, row, 49);
    let k = 0.62 + curve * 0.32 + fy * 0.25 + (n - 0.5) * 0.2 + (t - 0.5) * 0.14;
    if (fy > 0.9) k *= 0.55;
    put(o, 150 * k, 70 * k, 48 * k, 60);
  };
  // 窓。枠(不透明) + 硝子(A=0 → シェーダで空を映す)
  MAKERS[L.WINDOW] = (u, v, o) => {
    const fr = 0.09, mid = 0.025;
    const frame = u < fr || u > 1 - fr || v < fr || v > 1 - fr || Math.abs(u - 0.5) < mid || Math.abs(v - 0.45) < mid;
    if (frame) {
      const n = fbm(u, v, 16, 2);
      const k = 220 + (n - 0.5) * 20;
      const sill = v > 1 - fr ? 0.8 : 1;
      put(o, k * sill, k * sill, k * sill * 0.98, 255);
    } else {
      const n = fbm(u, v, 8, 3);
      put(o, 40 + n * 20, 52 + n * 22, 60 + n * 25, 0);
    }
  };
  // 木箱（外枠 + X字の補強）
  MAKERS[L.CRATE] = (u, v, o) => {
    const e = 0.12;
    const edge = u < e || u > 1 - e || v < e || v > 1 - e;
    const diag = Math.abs(u - v) < 0.07 || Math.abs(u + v - 1) < 0.07;
    const plank = (v * 5) % 1;
    const grain = fbm(u * 0.4, v * 5, 16, 4);
    let k = 0.75 + grain * 0.35;
    let r = 150, gg = 112, b = 66;
    if (edge || diag) { r = 128; gg = 92; b = 52; k *= 1.05; }
    else if (plank < 0.05) k *= 0.6;
    if (edge && (u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97)) k *= 0.6;
    // 釘
    const nx = (u * 8) % 1, ny = (v * 8) % 1;
    if (edge && Math.hypot(nx - 0.5, ny - 0.5) < 0.07) { r = gg = b = 70; }
    put(o, r * k, gg * k, b * k, 20);
  };
  // 樹皮
  MAKERS[L.BARK] = (u, v, o) => {
    const n = fbm(u * 3, v * 0.6, 8, 5);
    const ridge = Math.abs(fbm(u * 4, v * 0.25, 8, 3) - 0.5) * 2;
    const k = 0.45 + n * 0.5 - ridge * 0.25;
    put(o, 96 * k + 10, 72 * k + 6, 54 * k + 4, 15);
  };
  // 針葉樹の葉
  MAKERS[L.NEEDLE] = (u, v, o) => {
    const n = fbm(u, v, 16, 5), c = fbm(u, v, 4, 3);
    const clump = sstep(0.35, 0.7, n);
    const k = 0.35 + clump * 0.55 + c * 0.2;
    put(o, 44 * k + 6, 82 * k + 10, 40 * k + 6, 30);
  };
  // 茂みの葉（切り抜き）
  MAKERS[L.LEAF] = (u, v, o, px, py) => {
    let a = 0;
    const r = mulberry(7), N = 90;
    // 葉を散らす（決定的）。重い処理なので簡易な楕円判定
    const cell = MAKERS._leafCells || (MAKERS._leafCells = (() => {
      const arr = [];
      for (let i = 0; i < N; i++) arr.push([r(), r() * 0.85 + 0.12, 0.035 + r() * 0.035, r() * Math.PI, r()]);
      return arr;
    })());
    let best = 0;
    for (let i = 0; i < cell.length; i++) {
      const lf = cell[i];
      let dx = u - lf[0], dy = v - lf[1];
      if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
      const ca = Math.cos(lf[3]), sa = Math.sin(lf[3]);
      const ex = (dx * ca + dy * sa) / lf[2], ey = (-dx * sa + dy * ca) / (lf[2] * 0.45);
      const d = ex * ex + ey * ey;
      if (d < 1) { a = 255; best = Math.max(best, 1 - d * 0.5 + lf[4] * 0.3); }
    }
    const n = fbm(u, v, 8, 3);
    const k = 0.45 + best * 0.4 + n * 0.25;
    put(o, 70 * k, 118 * k, 52 * k, a);
  };
  // 岩（花崗岩 + 苔）
  MAKERS[L.ROCK] = (u, v, o) => {
    const n = fbm(u, v, 6, 6), f = fbm(u, v, 48, 2);
    const crack = sstep(0.47, 0.5, Math.abs(fbm(u, v, 5, 3) - 0.5) * 2) < 0.05 ? 0.7 : 1;
    const k = (0.55 + n * 0.45 + (f - 0.5) * 0.15) * crack;
    const moss = sstep(0.62, 0.74, fbm(u + 0.2, v, 5, 4));
    put(o, mix(128 * k, 86 * k, moss), mix(126 * k, 104 * k, moss), mix(120 * k, 60 * k, moss), 45);
  };
  // 草の葉（切り抜き）
  MAKERS[L.GRASS] = (u, v, o, px) => {
    const blades = MAKERS._blades || (MAKERS._blades = (() => {
      const r = mulberry(99), arr = [];
      for (let i = 0; i < 38; i++) arr.push([r(), 0.35 + r() * 0.65, 0.008 + r() * 0.01, (r() - 0.5) * 0.35, r()]);
      return arr;
    })());
    const h = 1 - v;                    // 下=0 上=1
    let a = 0, tone = 0;
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i];
      if (h > b[1]) continue;
      const t = h / b[1];
      const cx = b[0] + b[3] * t * t;
      const w = b[2] * (1 - t * 0.85);
      if (Math.abs(u - cx) < w) { a = 255; tone = Math.max(tone, b[4]); }
    }
    const k = 0.5 + h * 0.5;
    put(o, (70 + tone * 30) * k, (110 + tone * 30) * k, (40 + tone * 10) * k, a);
  };
  // 布（織り目。色は頂点色）
  MAKERS[L.FABRIC] = (u, v, o) => {
    const w = 0.5 + 0.25 * (Math.sin(u * TS * 1.2) * Math.sin(v * TS * 1.2));
    const n = fbm(u, v, 16, 4);
    const k = 200 + (w - 0.5) * 20 + (n - 0.5) * 30;
    put(o, k, k, k, 12);
  };
  // ウッドランド迷彩
  MAKERS[L.CAMO] = (u, v, o) => {
    const a = fbm(u, v, 4, 4), b = fbm(u + 0.37, v + 0.11, 5, 4), c = fbm(u + 0.7, v + 0.5, 6, 3);
    let col;
    if (a > 0.58) col = hex('#3f4a2e');
    else if (b > 0.57) col = hex('#6b5a3c');
    else if (c > 0.6) col = hex('#26291f');
    else col = hex('#7d8055');
    const n = 0.9 + fbm(u, v, 64, 2) * 0.2;
    put(o, col[0] * n * 1.3, col[1] * n * 1.3, col[2] * n * 1.3, 10);
  };
  // 銃の金属・樹脂（細かいざらつき）
  MAKERS[L.GUN] = (u, v, o) => {
    const n = fbm(u, v, 64, 2), s = fbm(u * 0.2, v * 3, 8, 3);
    const k = 190 + (n - 0.5) * 30 + (s - 0.5) * 18;
    put(o, k, k, k, 150);
  };
  // 室内の壁（漆喰＋薄い汚れ）
  MAKERS[L.INTERIOR] = (u, v, o) => {
    const n = fbm(u, v, 6, 4);
    const stripe = (Math.floor(u * 16) % 2) ? 1 : 0.965;
    const k = (208 + (n - 0.5) * 20) * stripe;
    put(o, k, k * 0.96, k * 0.88, 20);
  };
  // 輸送機（パネルとリベット）
  MAKERS[L.PLANE] = (u, v, o) => {
    const pu = (u * 4) % 1, pv = (v * 3) % 1;
    const n = fbm(u, v, 8, 3);
    let k = 150 + (n - 0.5) * 20;
    if (pu < 0.012 || pv < 0.015) k -= 35;
    const rx = (u * 32) % 1;
    if (pv > 0.03 && pv < 0.06 && Math.abs(rx - 0.5) < 0.18) k -= 25;
    put(o, k * 0.72, k * 0.78, k * 0.66, 90);
  };
  // パラシュート（縞）
  MAKERS[L.CHUTE] = (u, v, o) => {
    const band = Math.floor(u * 8) % 2;
    const n = fbm(u, v, 16, 2);
    const seam = ((u * 8) % 1) < 0.03 ? 0.75 : 1;
    const c = band ? [230, 230, 222] : [230, 120, 40];
    const k = (0.88 + n * 0.2) * seam;
    put(o, c[0] * k, c[1] * k, c[2] * k, 30);
  };
  MAKERS[L.WHITE] = (u, v, o) => { const n = fbm(u, v, 32, 2); const k = 235 + (n - 0.5) * 12; put(o, k, k, k, 60); };
  // 肌
  MAKERS[L.SKIN] = (u, v, o) => {
    const n = fbm(u, v, 32, 3);
    const k = 225 + (n - 0.5) * 22;
    put(o, k, k * 0.97, k * 0.95, 22);
  };
  // ドラム缶
  MAKERS[L.BARREL] = (u, v, o) => {
    const rib = Math.abs(((v * 3) % 1) - 0.5) < 0.03 ? 0.75 : 1;
    const n = fbm(u, v, 16, 4), rust = sstep(0.62, 0.8, fbm(u, v, 6, 4));
    const k = (195 + (n - 0.5) * 30) * rib;
    put(o, mix(k, 140, rust), mix(k, 80, rust), mix(k, 50, rust), 90 - rust * 70);
  };
  // 地面の近景ディテール（グレースケール）
  MAKERS[L.DETAIL] = (u, v, o) => {
    const a = fbm(u, v, 16, 4), b = fbm(u, v, 64, 2);
    const pebble = sstep(0.7, 0.75, fbm(u + 0.5, v, 32, 2)) * 0.25;
    const k = 128 + (a - 0.5) * 90 + (b - 0.5) * 50 + pebble * 128;
    put(o, k, k, k, 255);
  };
  // 扉（木製・パネル）
  MAKERS[L.DOOR] = (u, v, o) => {
    const grain = fbm(u * 0.3, v * 2, 16, 4);
    let k = 0.7 + grain * 0.3;
    const inPanel = (u > 0.15 && u < 0.85) && ((v > 0.1 && v < 0.45) || (v > 0.55 && v < 0.9));
    if (!inPanel) k *= 1.08;
    const edge = (u > 0.13 && u < 0.17) || (u > 0.83 && u < 0.87);
    if (edge) k *= 0.7;
    put(o, 110 * k, 76 * k, 48 * k, 40);
  };

  let _layerCache = null;
  /** 材質レイヤーの Canvas 配列（初回だけ生成） */
  function layers() {
    if (_layerCache) return _layerCache;
    const out = [];
    for (let i = 0; i < LAYERS; i++) out.push(layer(MAKERS[i] || MAKERS[L.WHITE]));
    _layerCache = out;
    return out;
  }

  /* =======================================================================
   * 地表と地図
   * ===================================================================== */
  const GROUND = { origin: -16, size: 128, px: 1024 };

  /** 水からの距離（セル単位）。岸の砂浜や水深に使う */
  function waterDistance(map) {
    const w = map.w, h = map.h, N = w * h;
    const d = new Float32Array(N).fill(1e9);
    const q = [];
    for (let i = 0; i < N; i++) if (map.grid[i] === 4) { d[i] = 0; q.push(i); }
    for (let head = 0; head < q.length; head++) {
      const c = q[head], x = c % w, y = (c / w) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = [1, -1, 0, 0, 1, 1, -1, -1][k], dy = [0, 0, 1, -1, 1, -1, 1, -1][k];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx, nd = d[c] + (k < 4 ? 1 : 1.414);
        if (nd < d[ni]) { d[ni] = nd; q.push(ni); }
      }
    }
    return d;
  }
  /** 陸からの距離（水セルの深さ） */
  function landDistance(map) {
    const w = map.w, h = map.h, N = w * h;
    const d = new Float32Array(N).fill(1e9);
    const q = [];
    for (let i = 0; i < N; i++) if (map.grid[i] !== 4) { d[i] = 0; q.push(i); }
    for (let head = 0; head < q.length; head++) {
      const c = q[head], x = c % w, y = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (d[c] + 1 < d[ni]) { d[ni] = d[c] + 1; q.push(ni); }
      }
    }
    return d;
  }
  function sampleField(f, map, x, y, outside) {
    const w = map.w, h = map.h;
    x -= 0.5; y -= 0.5;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const at = (a, b) => (a < 0 || b < 0 || a >= w || b >= h) ? outside : f[b * w + a];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** ランドマーク間の道路（最小全域木 + 少し曲げる）。水を大きく跨ぐ辺は捨てる */
  function planRoads(map) {
    const lm = map.landmarks.filter(l => l.key !== 'lake');
    const rnd = mulberry(map.seed ^ 0x5eed);
    const inTree = [lm[0]], edges = [];
    const rest = lm.slice(1);
    const waterFrac = (a, b) => {
      let wet = 0; const n = 40;
      for (let i = 0; i <= n; i++) {
        const x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
        if (x < 0 || y < 0 || x >= map.w || y >= map.h || map.grid[y * map.w + x] === 4) wet++;
      }
      return wet / (n + 1);
    };
    while (rest.length) {
      let best = null;
      inTree.forEach(a => rest.forEach(b => {
        const d = Math.hypot(a.x - b.x, a.y - b.y) * (1 + waterFrac(a, b) * 6);
        if (!best || d < best.d) best = { a, b, d };
      }));
      inTree.push(best.b); rest.splice(rest.indexOf(best.b), 1);
      edges.push([best.a, best.b]);
    }
    // 追加で1本（環状にして行き止まりを減らす）
    if (lm.length > 3) edges.push([lm[1], lm[lm.length - 1]]);
    const roads = [];
    edges.forEach(([a, b]) => {
      if (waterFrac(a, b) > 0.12) return;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
      const bend = (rnd() - 0.5) * 0.35 * Math.hypot(b.x - a.x, b.y - a.y);
      const c = { x: mx + nx / nl * bend, y: my + ny / nl * bend };
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, it = 1 - t;
        pts.push({ x: it * it * a.x + 2 * it * t * c.x + t * t * b.x, y: it * it * a.y + 2 * it * t * c.y + t * t * b.y });
      }
      roads.push({ pts, main: a.key === 'city' || b.key === 'city' });
    });
    return roads;
  }

  /** 建物の見た目の型。エリアごとに材質と高さを変える */
  function buildingStyle(b, seed) {
    const r = mulberry((seed ^ (b.x * 73856093) ^ (b.y * 19349663)) >>> 0);
    const pick = arr => arr[(r() * arr.length) | 0];
    const PLASTERS = ['#d9cdb4', '#c9c2b0', '#b8c4c8', '#d8c29a', '#e2ddd0', '#c7b39a', '#a9b59a'];
    let st;
    switch (b.area) {
      case 'city':
        st = r() < 0.4
          ? { wall: L.BRICK, tint: '#ffffff', h: pick([2.4, 2.9]), roof: 'flat', roofTint: '#7d7a74' }
          : { wall: L.PLASTER, tint: pick(PLASTERS), h: pick([1.7, 2.4, 2.9]), roof: r() < 0.6 ? 'flat' : 'gable', roofTint: '#9a5a44' };
        break;
      case 'military':
        st = { wall: L.CONCRETE, tint: pick(['#b9bba6', '#a9ad98', '#c2c0b0']), h: pick([1.7, 2.0]), roof: 'flat', roofTint: '#6f7066' };
        break;
      case 'industrial':
        st = { wall: L.METAL, tint: pick(['#9fb0b8', '#b8b2a0', '#8a9aa6', '#b89a7a']), h: pick([2.2, 2.6]), roof: 'shed', roofTint: '#8a8f94' };
        break;
      case 'harbor':
        st = { wall: pick([L.METAL, L.CONCRETE]), tint: pick(['#7fa0b8', '#a7b3ba', '#c0a080']), h: pick([2.0, 2.4]), roof: 'shed', roofTint: '#7a848c' };
        break;
      case 'village':
        st = r() < 0.5
          ? { wall: L.BRICK, tint: '#ffffff', h: 1.7, roof: 'gable', roofTint: pick(['#a25540', '#8a4a3a', '#6d6258']) }
          : { wall: L.PLASTER, tint: pick(PLASTERS), h: 1.7, roof: 'gable', roofTint: pick(['#a25540', '#5c6470', '#7a4c3a']) };
        break;
      default:
        st = { wall: L.WOOD, tint: pick(['#ffffff', '#e8d8c0', '#d0c0a8']), h: 1.65, roof: 'gable', roofTint: '#6a5a4a' };
    }
    st.floor = st.wall === L.METAL || st.wall === L.CONCRETE ? 'concrete' : (b.area === 'city' && r() < 0.5 ? 'tile' : 'wood');
    return st;
  }

  function paintGround(map) {
    const P = GROUND.px, org = GROUND.origin, size = GROUND.size, spp = size / P;
    const wd = waterDistance(map), ld = landDistance(map);
    const c = document.createElement('canvas');
    c.width = c.height = P;
    const x = c.getContext('2d');
    const id = x.createImageData(P, P);
    const d = id.data;
    const G1 = hex('#5d7a3a'), G2 = hex('#7f8f45'), G3 = hex('#4b6a33'), DRY = hex('#a39a5c');
    const SAND = hex('#cdbb8c'), WET = hex('#9e8f68'), SEABED = hex('#6f7a5c'), DEEP = hex('#3a4a44');
    const DIRT = hex('#86704f'), ROCKY = hex('#8a8676');
    // ランドマークの影響（森は濃く、岩稜は石まじり、集落の周りは乾いた草）
    const lms = map.landmarks;
    for (let py = 0; py < P; py++) {
      const wy = org + (py + 0.5) * spp;
      for (let px = 0; px < P; px++) {
        const wx = org + (px + 0.5) * spp;
        const i = (py * P + px) * 4;
        const wdist = sampleField(wd, map, wx, wy, 0);
        let r, gg, b;
        if (wdist < 0.5) {
          // 水中（浅い所は砂、深い所は暗く）
          const depth = sampleField(ld, map, wx, wy, 20);
          const k = sstep(0, 4, depth);
          r = mix(SAND[0] * 0.85, DEEP[0], k); gg = mix(SAND[1] * 0.85, DEEP[1], k); b = mix(SAND[2] * 0.85, DEEP[2], k);
          const n = vfbm(wx * 0.6, wy * 0.6, 3);
          r *= 0.85 + n * 0.3; gg *= 0.85 + n * 0.3; b *= 0.85 + n * 0.3;
        } else {
          const n1 = vfbm(wx * 0.09, wy * 0.09, 4), n2 = vfbm(wx * 0.5 + 40, wy * 0.5, 3), n3 = vfbm(wx * 2.2, wy * 2.2, 2);
          // 草の基本色（3色＋乾いた草）
          const t1 = sstep(0.35, 0.65, n1);
          r = mix(G3[0], G1[0], t1); gg = mix(G3[1], G1[1], t1); b = mix(G3[2], G1[2], t1);
          const t2 = sstep(0.55, 0.75, n2);
          r = mix(r, G2[0], t2 * 0.6); gg = mix(gg, G2[1], t2 * 0.6); b = mix(b, G2[2], t2 * 0.6);
          const dry = sstep(0.62, 0.8, vfbm(wx * 0.05 + 11, wy * 0.05, 3));
          r = mix(r, DRY[0], dry * 0.55); gg = mix(gg, DRY[1], dry * 0.55); b = mix(b, DRY[2], dry * 0.55);
          // 土のむら
          const dirt = sstep(0.68, 0.82, vfbm(wx * 0.18 + 5, wy * 0.18 - 3, 4));
          r = mix(r, DIRT[0], dirt * 0.7); gg = mix(gg, DIRT[1], dirt * 0.7); b = mix(b, DIRT[2], dirt * 0.7);
          // ランドマーク別
          for (let k = 0; k < lms.length; k++) {
            const l = lms[k];
            const dd = Math.hypot(wx - l.x, wy - l.y) / (l.r * 1.25);
            if (dd > 1) continue;
            const f = sstep(1, 0.5, dd);
            if (l.key === 'forest') { r = mix(r, r * 0.72, f); gg = mix(gg, gg * 0.8, f); b = mix(b, b * 0.7, f); const nd = sstep(0.5, 0.7, n2) * f; r = mix(r, 92, nd * 0.5); gg = mix(gg, 70, nd * 0.5); b = mix(b, 44, nd * 0.5); }
            else if (l.key === 'mountain') { const rk = f * (0.45 + n2 * 0.5); r = mix(r, ROCKY[0], rk); gg = mix(gg, ROCKY[1], rk); b = mix(b, ROCKY[2], rk); }
            else if (l.key === 'military' || l.key === 'industrial' || l.key === 'harbor') { const rk = f * 0.55; r = mix(r, 128, rk); gg = mix(gg, 118, rk); b = mix(b, 96, rk); }
            else if (l.key === 'city') { const rk = f * 0.35; r = mix(r, DIRT[0], rk); gg = mix(gg, DIRT[1], rk); b = mix(b, DIRT[2], rk); }
          }
          // 砂浜
          const beach = sstep(2.6, 0.6, wdist) * (0.75 + n3 * 0.25);
          const wet = sstep(1.1, 0.5, wdist);
          r = mix(r, SAND[0], beach); gg = mix(gg, SAND[1], beach); b = mix(b, SAND[2], beach);
          r = mix(r, WET[0], wet); gg = mix(gg, WET[1], wet); b = mix(b, WET[2], wet);
          const k2 = 0.88 + n3 * 0.24;
          r *= k2; gg *= k2; b *= k2;
        }
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    x.putImageData(id, 0, 0);

    // 以降はベクター描画。世界座標 → 画素
    const S = P / size;
    x.save();
    x.scale(S, S);
    x.translate(-org, -org);

    /* --- 畑（集落の周り。畝の縞模様） --- */
    const rnd = mulberry(map.seed ^ 0xfa11);
    const farms = [];
    map.landmarks.filter(l => l.key === 'village' || l.key === 'lake').forEach(l => {
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2, dist = l.r * (1.1 + rnd() * 0.7);
        const fx = l.x + Math.cos(a) * dist, fy = l.y + Math.sin(a) * dist;
        farms.push({ x: fx, y: fy, w: 7 + rnd() * 6, h: 5 + rnd() * 5, a: rnd() * Math.PI, c: rnd() < 0.5 ? '#a8944f' : '#6f7a3a' });
      }
    });
    farms.forEach(f => {
      x.save();
      x.translate(f.x, f.y); x.rotate(f.a);
      x.globalAlpha = 0.75;
      x.fillStyle = f.c;
      x.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      x.globalAlpha = 0.35;
      x.fillStyle = '#4a3a24';
      for (let yy = -f.h / 2; yy < f.h / 2; yy += 0.45) x.fillRect(-f.w / 2, yy, f.w, 0.16);
      x.restore();
    });
    x.globalAlpha = 1;

    /* --- 舗装（市街・基地・工業地帯・港の広場） --- */
    const pads = [];
    map.landmarks.forEach(l => {
      if (l.key === 'military' || l.key === 'industrial' || l.key === 'harbor') pads.push({ x: l.x, y: l.y, r: l.r * 0.95, c: l.key === 'military' ? '#8d8c80' : '#7c7a74' });
      if (l.key === 'city') pads.push({ x: l.x, y: l.y, r: l.r * 0.7, c: '#8b8479' });
    });
    pads.forEach(p => {
      const gr = x.createRadialGradient(p.x, p.y, p.r * 0.3, p.x, p.y, p.r);
      gr.addColorStop(0, p.c); gr.addColorStop(0.75, p.c); gr.addColorStop(1, 'rgba(120,115,100,0)');
      x.globalAlpha = 0.72;
      x.fillStyle = gr;
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill();
    });
    x.globalAlpha = 1;

    /* --- 道路（アスファルト＋路肩の土＋中央線） --- */
    const roads = planRoads(map);
    const strokeRoad = (r, width, style, dash) => {
      x.beginPath();
      r.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
      x.lineWidth = width; x.strokeStyle = style; x.setLineDash(dash || []);
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.stroke();
    };
    roads.forEach(r => strokeRoad(r, r.main ? 3.4 : 2.6, 'rgba(120,100,70,0.55)'));
    roads.forEach(r => strokeRoad(r, r.main ? 2.4 : 1.7, r.main ? '#4b4b4b' : '#6d5f48'));
    roads.forEach(r => { if (r.main) strokeRoad(r, 0.12, 'rgba(230,220,160,0.8)', [1.0, 1.2]); });
    x.setLineDash([]);

    /* --- 建物の床 --- */
    (map.buildings || []).forEach(bd => {
      const st = bd.style || (bd.style = buildingStyle(bd, map.seed));
      x.fillStyle = st.floor === 'concrete' ? '#8f8d86' : (st.floor === 'tile' ? '#b7aa92' : '#8a6a44');
      x.fillRect(bd.x, bd.y, bd.bw, bd.bh);
      if (st.floor === 'wood') {
        x.fillStyle = 'rgba(40,24,10,0.35)';
        for (let yy = bd.y; yy < bd.y + bd.bh; yy += 0.28) x.fillRect(bd.x, yy, bd.bw, 0.03);
      } else if (st.floor === 'tile') {
        x.fillStyle = 'rgba(60,50,40,0.25)';
        for (let yy = bd.y; yy < bd.y + bd.bh; yy += 0.5) x.fillRect(bd.x, yy, bd.bw, 0.03);
        for (let xx = bd.x; xx < bd.x + bd.bw; xx += 0.5) x.fillRect(xx, bd.y, 0.03, bd.bh);
      }
      // 外周の土台の影
      x.strokeStyle = 'rgba(30,26,20,0.35)'; x.lineWidth = 0.35;
      x.strokeRect(bd.x - 0.15, bd.y - 0.15, bd.bw + 0.3, bd.bh + 0.3);
    });
    x.restore();

    // 仕上げの細かい粒（ベクター描画の「のっぺり」を消す）
    const id2 = x.getImageData(0, 0, P, P), d2 = id2.data;
    for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) {
      const i = (py * P + px) * 4;
      const n = (PERM[((px * 7919) ^ (py * 104729)) & 65535] - 0.5) * 14;
      d2[i] += n; d2[i + 1] += n; d2[i + 2] += n;
    }
    x.putImageData(id2, 0, 0);

    /* --- 草を生やしてよい場所のマスク（道路・舗装・建物・水・砂浜を除く） --- */
    const MS = 256;
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mx = mc.getContext('2d');
    const mid = mx.createImageData(MS, MS);
    for (let py = 0; py < MS; py++) for (let px = 0; px < MS; px++) {
      const wx = org + (px + 0.5) * size / MS, wy = org + (py + 0.5) * size / MS;
      const wdist = sampleField(wd, map, wx, wy, 0);
      const k = sstep(1.8, 3.2, wdist) * (0.35 + 0.65 * sstep(0.3, 0.6, vfbm(wx * 0.15, wy * 0.15, 3)));
      const i = (py * MS + px) * 4;
      mid.data[i] = mid.data[i + 1] = mid.data[i + 2] = k * 255; mid.data[i + 3] = 255;
    }
    mx.putImageData(mid, 0, 0);
    mx.save();
    mx.scale(MS / size, MS / size); mx.translate(-org, -org);
    mx.fillStyle = '#000'; mx.strokeStyle = '#000';
    pads.forEach(p => { mx.beginPath(); mx.arc(p.x, p.y, p.r * 0.8, 0, 7); mx.fill(); });
    roads.forEach(r => { mx.beginPath(); r.pts.forEach((p, i) => i ? mx.lineTo(p.x, p.y) : mx.moveTo(p.x, p.y)); mx.lineWidth = r.main ? 3.2 : 2.4; mx.lineCap = 'round'; mx.stroke(); });
    (map.buildings || []).forEach(bd => mx.fillRect(bd.x - 0.5, bd.y - 0.5, bd.bw + 1, bd.bh + 1));
    mx.restore();

    return { canvas: c, mask: mc, roads, farms, pads, waterDist: wd, landDist: ld };
  }

  /**
   * UI用の地図（上から見た図）。屋根・木・岩・グリッドを描き込む。
   * @returns {HTMLCanvasElement} 1セル = px/96 画素
   */
  function paintMap(map, ground, px) {
    px = px || 768;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const x = c.getContext('2d');
    const s = px / map.w;
    // 地表（GL と同じ絵）を、マップ範囲だけ切り出して貼る
    const G = GROUND;
    const src = (0 - G.origin) / G.size * G.px, len = map.w / G.size * G.px;
    x.drawImage(ground.canvas, src, src, len, len, 0, 0, px, px);
    // 水面の色を乗せる
    const id = x.getImageData(0, 0, px, px), d = id.data;
    for (let py = 0; py < px; py++) for (let qx = 0; qx < px; qx++) {
      const gx = (qx / s) | 0, gy = (py / s) | 0;
      if (map.grid[gy * map.w + gx] !== 4) continue;
      const depth = sampleField(ground.landDist, map, qx / s, py / s, 20);
      const k = sstep(0, 5, depth);
      const i = (py * px + qx) * 4;
      d[i] = mix(80, 30, k); d[i + 1] = mix(140, 70, k); d[i + 2] = mix(150, 100, k);
    }
    x.putImageData(id, 0, 0);
    x.save();
    x.scale(s, s);
    // 木・岩・木箱
    for (let gy = 0; gy < map.h; gy++) for (let gx = 0; gx < map.w; gx++) {
      const i = gy * map.w + gx, t = map.grid[i];
      if (t === 2) {
        const tree = map.deco && map.deco[i] === 1;
        x.fillStyle = tree ? 'rgba(30,58,28,0.9)' : 'rgba(120,118,108,0.95)';
        x.beginPath(); x.arc(gx + 0.5, gy + 0.5, tree ? 0.75 : 0.55, 0, 7); x.fill();
      } else if (t === 3) {
        x.fillStyle = 'rgba(140,110,70,0.95)'; x.fillRect(gx + 0.1, gy + 0.1, 0.8, 0.8);
      }
    }
    // 屋根
    (map.buildings || []).forEach(bd => {
      const st = bd.style;
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(bd.x + 0.35, bd.y + 0.35, bd.bw, bd.bh);
      x.fillStyle = st && st.roof === 'gable' ? st.roofTint : '#9a9a98';
      x.fillRect(bd.x, bd.y, bd.bw, bd.bh);
      x.strokeStyle = 'rgba(20,20,20,0.6)'; x.lineWidth = 0.12;
      x.strokeRect(bd.x, bd.y, bd.bw, bd.bh);
      if (st && st.roof === 'gable') {
        x.beginPath();
        if (bd.bw >= bd.bh) { x.moveTo(bd.x, bd.y + bd.bh / 2); x.lineTo(bd.x + bd.bw, bd.y + bd.bh / 2); }
        else { x.moveTo(bd.x + bd.bw / 2, bd.y); x.lineTo(bd.x + bd.bw / 2, bd.y + bd.bh); }
        x.stroke();
      }
    });
    x.restore();
    return c;
  }

  g.WorldTex = { L, LAYERS, TS, GROUND, layers, paintGround, paintMap, buildingStyle, planRoads, fbm, vfbm, mulberry, sampleField };
})(window);
