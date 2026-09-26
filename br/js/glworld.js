/* ===== glworld.js — 島の静的な3Dジオメトリ ===================================
 * マップのグリッド（当たり判定はそのまま）から、写実寄りの見た目を組み立てる。
 *   ・地形（陸は平ら / 水の中は岸から深くなる）
 *   ・建物（外壁・内壁・窓・扉の上枠・天井・切妻/陸屋根/片流れ屋根・屋上の小物）
 *   ・針葉樹と白樺、岩、木箱の山、コンテナ、茂み、電柱と電線
 *   ・水平線の向こうの山並み
 * 当たり判定用に、セルごとの「高さ」も返す（弾が上を越えるか判定するため）。
 * ========================================================================= */
(function (g) {
  'use strict';

  const L = () => WorldTex.L;
  const CZ = 1.6;                 // 室内の天井の高さ
  const DOOR_H = 1.16;            // 出入口の高さ
  const LIT = 12;                 // 頂点1つの要素数: pos3 nrm3 uv2 layer1 col3

  function rng(seed) { return WorldTex.mulberry(seed >>> 0); }
  const lin = h => GLC.lin(h);
  function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  /* ---------------- 形の部品 ---------------- */
  function V(B, p, n, u, v, layer, c) {
    B.push([p[0], p[1], p[2], n[0], n[1], n[2], u, v, layer, c[0], c[1], c[2]]);
  }
  /** 四角形（p0→p1→p2→p3 の順） */
  function quad(B, p0, p1, p2, p3, n, uv, layer, col) {
    V(B, p0, n, uv[0], uv[1], layer, col); V(B, p1, n, uv[2], uv[3], layer, col); V(B, p2, n, uv[4], uv[5], layer, col);
    V(B, p0, n, uv[0], uv[1], layer, col); V(B, p2, n, uv[4], uv[5], layer, col); V(B, p3, n, uv[6], uv[7], layer, col);
  }
  function tri(B, p0, p1, p2, n, uv, layer, col) {
    V(B, p0, n, uv[0], uv[1], layer, col); V(B, p1, n, uv[2], uv[3], layer, col); V(B, p2, n, uv[4], uv[5], layer, col);
  }
  /**
   * 軸に沿った箱。faces: 'nsewtb' のうち描く面。uvs = 1単位あたりの繰り返し数。
   * 側面のUVは世界座標から取るので、隣り合う箱でも模様がつながる。
   */
  function box(B, x0, y0, z0, x1, y1, z1, layer, col, uvs, faces, topLayer, topCol) {
    const s = uvs || 1;
    const F = faces || 'nsewtb';
    const tl = topLayer == null ? layer : topLayer, tc = topCol || col;
    if (F.indexOf('n') >= 0) quad(B, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 * s, z0 * s, x1 * s, z0 * s, x1 * s, z1 * s, x0 * s, z1 * s], layer, col);
    if (F.indexOf('s') >= 0) quad(B, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], [x1 * s, z0 * s, x0 * s, z0 * s, x0 * s, z1 * s, x1 * s, z1 * s], layer, col);
    if (F.indexOf('w') >= 0) quad(B, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], [y1 * s, z0 * s, y0 * s, z0 * s, y0 * s, z1 * s, y1 * s, z1 * s], layer, col);
    if (F.indexOf('e') >= 0) quad(B, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], [y0 * s, z0 * s, y1 * s, z0 * s, y1 * s, z1 * s, y0 * s, z1 * s], layer, col);
    if (F.indexOf('t') >= 0) quad(B, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0 * s, y0 * s, x1 * s, y0 * s, x1 * s, y1 * s, x0 * s, y1 * s], tl, tc);
    if (F.indexOf('b') >= 0) quad(B, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1], [x0 * s, y1 * s, x1 * s, y1 * s, x1 * s, y0 * s, x0 * s, y0 * s], layer, col);
  }
  /** 中心と向きを持つ箱（回転した木箱など） */
  function obox(B, cx, cy, z0, hx, hy, h, ang, layer, col, uvs) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (lx, ly, z) => [cx + lx * c - ly * s, cy + lx * s + ly * c, z];
    const N = (nx, ny) => [nx * c - ny * s, nx * s + ny * c, 0];
    const k = uvs || 1;
    const u0 = 0, u1 = 1 * k, v0 = 0, v1 = 1 * k;
    const uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    quad(B, P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, -hy, z0 + h), P(-hx, -hy, z0 + h), N(0, -1), uv, layer, col);
    quad(B, P(hx, hy, z0), P(-hx, hy, z0), P(-hx, hy, z0 + h), P(hx, hy, z0 + h), N(0, 1), uv, layer, col);
    quad(B, P(-hx, hy, z0), P(-hx, -hy, z0), P(-hx, -hy, z0 + h), P(-hx, hy, z0 + h), N(-1, 0), uv, layer, col);
    quad(B, P(hx, -hy, z0), P(hx, hy, z0), P(hx, hy, z0 + h), P(hx, -hy, z0 + h), N(1, 0), uv, layer, col);
    quad(B, P(-hx, -hy, z0 + h), P(hx, -hy, z0 + h), P(hx, hy, z0 + h), P(-hx, hy, z0 + h), [0, 0, 1], uv, layer, shade(col, 1.05));
  }
  /** 円柱（側面のみ + 天面） */
  function cylinder(B, cx, cy, z0, z1, r0, r1, sides, layer, col, cap, uvScale) {
    const us = uvScale || 1;
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [cx + c0 * r0, cy + s0 * r0, z0], p1 = [cx + c1 * r0, cy + s1 * r0, z0];
      const p2 = [cx + c1 * r1, cy + s1 * r1, z1], p3 = [cx + c0 * r1, cy + s0 * r1, z1];
      const u0 = i / sides * us, u1 = (i + 1) / sides * us, vv = (z1 - z0) * us * 0.5;
      V(B, p0, [c0, s0, 0], u0, 0, layer, col); V(B, p1, [c1, s1, 0], u1, 0, layer, col); V(B, p2, [c1, s1, 0], u1, vv, layer, col);
      V(B, p0, [c0, s0, 0], u0, 0, layer, col); V(B, p2, [c1, s1, 0], u1, vv, layer, col); V(B, p3, [c0, s0, 0], u0, vv, layer, col);
      if (cap) tri(B, [cx, cy, z1], p3, p2, [0, 0, 1], [0.5, 0.5, 0.5 + c0 * 0.5, 0.5 + s0 * 0.5, 0.5 + c1 * 0.5, 0.5 + s1 * 0.5], layer, shade(col, 1.08));
    }
  }
  /** 凸凹のある円錐（針葉樹の枝の段） */
  function jaggedCone(B, cx, cy, z0, h, r, sides, layer, col, R) {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2 + R() * 0.3;
      const rr = r * (0.78 + R() * 0.4);
      ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z0 - R() * h * 0.12, Math.cos(a), Math.sin(a)]);
    }
    const apex = [cx + (R() - 0.5) * 0.05, cy + (R() - 0.5) * 0.05, z0 + h];
    const slope = r / h;
    for (let i = 0; i < sides; i++) {
      const a = ring[i], b = ring[(i + 1) % sides];
      const na = [a[3], a[4], slope * 0.9], nb = [b[3], b[4], slope * 0.9];
      const la = Math.hypot(na[0], na[1], na[2]), lb = Math.hypot(nb[0], nb[1], nb[2]);
      const ctop = shade(col, 1.12), cbot = shade(col, 0.72);
      V(B, [a[0], a[1], a[2]], [na[0] / la, na[1] / la, na[2] / la], i / sides * 3, 0, layer, cbot);
      V(B, [b[0], b[1], b[2]], [nb[0] / lb, nb[1] / lb, nb[2] / lb], (i + 1) / sides * 3, 0, layer, cbot);
      V(B, apex, [0, 0, 1], (i + 0.5) / sides * 3, h * 1.5, layer, ctop);
      // 下面（下から覗いても中が空洞に見えないように）
      const mid = [cx, cy, z0 + h * 0.18];
      V(B, [b[0], b[1], b[2]], [0, 0, -1], 0, 0, layer, shade(col, 0.45));
      V(B, [a[0], a[1], a[2]], [0, 0, -1], 1, 0, layer, shade(col, 0.45));
      V(B, mid, [0, 0, -1], 0.5, 1, layer, shade(col, 0.35));
    }
  }
  /** でこぼこの球（岩・広葉樹の葉の塊） */
  const ICO = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    v = v.map(p => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
    // 1回分割
    const cache = {};
    const midp = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache[k] != null) return cache[k];
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
      const l = Math.hypot(p[0], p[1], p[2]);
      v.push([p[0] / l, p[1] / l, p[2] / l]);
      return (cache[k] = v.length - 1);
    };
    const f2 = [];
    f.forEach(([a, b, c]) => {
      const ab = midp(a, b), bc = midp(b, c), ca = midp(c, a);
      f2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    });
    return { v, f: f2 };
  })();
  function blob(B, cx, cy, cz, sx, sy, sz, rough, layer, col, R, flatBottom) {
    const disp = ICO.v.map(p => 1 + (R() - 0.5) * rough);
    const P = ICO.v.map((p, i) => {
      let z = p[2] * sz * disp[i];
      if (flatBottom && z < -sz * 0.35) z = -sz * 0.35;
      return [cx + p[0] * sx * disp[i], cy + p[1] * sy * disp[i], cz + z];
    });
    // 面ごとの法線と頂点法線の中間（岩は少し角を立てる）
    ICO.f.forEach(([a, b, c]) => {
      const pa = P[a], pb = P[b], pc = P[c];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
      const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const ox = (pa[0] + pb[0] + pc[0]) / 3 - cx, oy = (pa[1] + pb[1] + pc[1]) / 3 - cy, oz = (pa[2] + pb[2] + pc[2]) / 3 - cz;
      if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      [a, b, c].forEach(i => {
        const vn = ICO.v[i];
        const mx = vn[0] * 0.5 + nx * 0.5, my = vn[1] * 0.5 + ny * 0.5, mz = vn[2] * 0.5 + nz * 0.5;
        const ml = Math.hypot(mx, my, mz) || 1;
        const ck = 0.8 + 0.3 * (vn[2] * 0.5 + 0.5);
        V(B, P[i], [mx / ml, my / ml, mz / ml], P[i][0] * 0.6 + P[i][2] * 0.3, P[i][1] * 0.6 + P[i][2] * 0.4, layer, shade(col, ck));
      });
    });
  }
  /** 十字に組んだ切り抜き板（茂み・草むら） */
  function cards(B, cx, cy, w, h, n, layer, col, ang) {
    for (let i = 0; i < n; i++) {
      const a = ang + i / n * Math.PI;
      const dx = Math.cos(a) * w / 2, dy = Math.sin(a) * w / 2;
      const nx = -Math.sin(a) * 0.5, ny = Math.cos(a) * 0.5, nz = 0.85;
      quad(B, [cx - dx, cy - dy, -0.02], [cx + dx, cy + dy, -0.02], [cx + dx, cy + dy, h], [cx - dx, cy - dy, h],
        [nx, ny, nz], [0, 1, 1, 1, 1, 0, 0, 0], layer, col);
    }
  }

  /* ================================================================
   * 地形と水
   * ============================================================== */
  function terrain(map, ground) {
    const X0 = -30, X1 = map.w + 30, step = 1;
    const N = Math.round((X1 - X0) / step) + 1;
    const H = new Float32Array(N * N);
    const land = (cx, cy) => cx >= 0 && cy >= 0 && cx < map.w && cy < map.h && map.grid[cy * map.w + cx] !== 4;
    const ld = ground.landDist;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = X0 + i * step, y = X0 + j * step;
      // 格子点に接する4セルのどれかが陸なら高さ0（歩ける所は完全に平ら）
      const cx = Math.round(x), cy = Math.round(y);
      let anyLand = false, minD = 99;
      for (let k = 0; k < 4; k++) {
        const qx = cx - 1 + (k & 1), qy = cy - 1 + (k >> 1);
        if (land(qx, qy)) anyLand = true;
        const d = (qx >= 0 && qy >= 0 && qx < map.w && qy < map.h) ? ld[qy * map.w + qx] : 12;
        minD = Math.min(minD, d);
      }
      if (anyLand) { H[j * N + i] = 0; continue; }
      const out = Math.max(0, Math.max(-x, x - map.w, -y, y - map.h));
      const dd = Math.min(minD + out * 0.5, 14);
      H[j * N + i] = -0.22 - Math.pow(dd / 14, 0.8) * 2.2 + (WorldTex.vfbm(x * 0.3, y * 0.3, 2) - 0.5) * 0.25;
    }
    const at = (i, j) => H[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
    const B = new GLC.Builder(6);
    const vert = (i, j) => {
      const x = X0 + i * step, y = X0 + j * step, z = at(i, j);
      const nx = at(i - 1, j) - at(i + 1, j), ny = at(i, j - 1) - at(i, j + 1), nz = 2 * step;
      const l = Math.hypot(nx, ny, nz);
      B.push([x, y, z, nx / l, ny / l, nz / l]);
    };
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      vert(i, j); vert(i + 1, j); vert(i + 1, j + 1);
      vert(i, j); vert(i + 1, j + 1); vert(i, j + 1);
    }
    // 外周の海底（遠くまで。水面の下にあるので粗くてよい）
    const R = 600, z = -3.2, c = map.w / 2;
    const ring = [[X0, X0], [X1, X0], [X1, X1], [X0, X1]];
    const far = [[c - R, c - R], [c + R, c - R], [c + R, c + R], [c - R, c + R]];
    for (let k = 0; k < 4; k++) {
      const a = ring[k], b = ring[(k + 1) % 4], fa = far[k], fb = far[(k + 1) % 4];
      [[a, b, fb], [a, fb, fa]].forEach(t => t.forEach(p => {
        const inner = p === a || p === b;
        B.push([p[0], p[1], inner ? -2.4 : z, 0, 0, 1]);
      }));
    }
    return { data: B.data(), H, N, X0 };
  }

  function water(map) {
    const c = map.w / 2, R = 700, z = -0.1;
    const B = new GLC.Builder(3);
    // 中心付近は細かく（霧と反射の補間を滑らかに）、遠くは大きな板
    const S = 16, span = 256, x0 = c - span / 2;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = x0 + i * span / S, b = x0 + (i + 1) * span / S, e = x0 + j * span / S, f = x0 + (j + 1) * span / S;
      B.push([a, e, z, b, e, z, b, f, z, a, e, z, b, f, z, a, f, z]);
    }
    const ring = [[x0, x0], [x0 + span, x0], [x0 + span, x0 + span], [x0, x0 + span]];
    const far = [[c - R, c - R], [c + R, c - R], [c + R, c + R], [c - R, c + R]];
    for (let k = 0; k < 4; k++) {
      const a = ring[k], b = ring[(k + 1) % 4], fa = far[k], fb = far[(k + 1) % 4];
      B.push([a[0], a[1], z, b[0], b[1], z, fb[0], fb[1], z, a[0], a[1], z, fb[0], fb[1], z, fa[0], fa[1], z]);
    }
    return B.data();
  }

  /** 水平線の山並み（別の島・対岸）。霧で青く霞む */
  function hills(map, B) {
    const c = map.w / 2, R = rng(map.seed ^ 0x4111);
    const radii = [150, 185, 225, 270, 330, 420];
    const A = 120;
    const hAt = (a, ri) => {
      if (ri === 0) return -1.5;
      const n = WorldTex.vfbm(Math.cos(a) * 3 + 50, Math.sin(a) * 3 + 50, 4);
      const mask = WorldTex.vfbm(Math.cos(a) * 1.3 + 9, Math.sin(a) * 1.3, 2);
      const k = Math.max(0, (mask - 0.38) / 0.62);
      const prof = [0, 0.4, 1, 0.85, 0.6, 0.2][ri];
      return (-1 + k * (n * 48 + 6) * prof) * (ri === 5 ? 0.6 : 1);
    };
    const G1 = lin('#4f6a3c'), G2 = lin('#6d7a52'), RK = lin('#7d7b70');
    for (let ri = 0; ri < radii.length - 1; ri++) for (let ai = 0; ai < A; ai++) {
      const a0 = ai / A * Math.PI * 2, a1 = (ai + 1) / A * Math.PI * 2;
      const P = (a, r, rr) => [c + Math.cos(a) * r, c + Math.sin(a) * r, hAt(a, rr)];
      const p00 = P(a0, radii[ri], ri), p10 = P(a1, radii[ri], ri), p11 = P(a1, radii[ri + 1], ri + 1), p01 = P(a0, radii[ri + 1], ri + 1);
      const col = p => { const h = p[2]; return h > 28 ? RK : (h > 10 ? G2 : G1); };
      const nrm = (p, q, r) => {
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        return [nx / l, ny / l, nz / l];
      };
      const n1 = nrm(p00, p10, p11), n2 = nrm(p00, p11, p01);
      [[p00, n1], [p10, n1], [p11, n1], [p00, n2], [p11, n2], [p01, n2]].forEach(([p, n]) =>
        V(B, p, n, p[0] * 0.05, p[1] * 0.05, L().WHITE, col(p)));
    }
    void R;
  }

  /* ================================================================
   * 建物
   * ============================================================== */
  function buildings(map, B, H) {
    const Lr = L();
    const w = map.w, grid = map.grid;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= map.h) ? 4 : grid[y * w + x];
    const UVS = {}; UVS[Lr.BRICK] = 1.6; UVS[Lr.PLASTER] = 0.7; UVS[Lr.CONCRETE] = 0.5; UVS[Lr.METAL] = 0.9; UVS[Lr.WOOD] = 0.9;
    const INT = lin('#e6ddd0'), CEIL = lin('#cfc8bc'), TRIM = lin('#e8e4dc'), DARK = lin('#3a342c');

    (map.buildings || []).forEach(bd => {
      const st = bd.style || (bd.style = WorldTex.buildingStyle(bd, map.seed));
      const R = rng(map.seed ^ (bd.x * 7919 + bd.y * 104729));
      const hgt = st.h, wl = st.wall, wc = lin(st.tint), us = UVS[wl] || 1;
      const inRect = (x, y) => x >= bd.x && y >= bd.y && x < bd.x + bd.bw && y < bd.y + bd.bh;
      const perim = (x, y) => inRect(x, y) && (x === bd.x || y === bd.y || x === bd.x + bd.bw - 1 || y === bd.y + bd.bh - 1);
      const isPart = (x) => bd.partX >= 0 && x === bd.partX;

      for (let y = bd.y; y < bd.y + bd.bh; y++) for (let x = bd.x; x < bd.x + bd.bw; x++) {
        const t = at(x, y);
        const onP = perim(x, y), onPart = isPart(x) && !onP;
        if (!onP && !onPart) continue;
        if (t === 1) {
          const top = onP ? hgt : CZ;
          H[y * w + x] = Math.max(H[y * w + x], top);
          // 4方向の面。隣が壁でなければ描く。外側なら外壁、内側なら内壁
          const dirs = [[0, -1, 'n'], [0, 1, 's'], [-1, 0, 'w'], [1, 0, 'e']];
          dirs.forEach(([dx, dy, f]) => {
            const nt = at(x + dx, y + dy);
            if (nt === 1) return;
            const outside = !inRect(x + dx, y + dy);
            if (outside) box(B, x, y, 0, x + 1, y + 1, hgt, wl, wc, us, f);
            else box(B, x, y, 0, x + 1, y + 1, CZ, Lr.INTERIOR, INT, 0.8, f);
          });
          if (onPart) box(B, x, y, 0, x + 1, y + 1, CZ, Lr.INTERIOR, INT, 0.8, 't');
        } else if (t === 0 && (onP || onPart)) {
          // 出入口: 上に梁（鴨居）を渡す
          const top = onP ? hgt : CZ;
          const faces = [];
          [[0, -1, 'n'], [0, 1, 's'], [-1, 0, 'w'], [1, 0, 'e']].forEach(([dx, dy, f]) => { if (at(x + dx, y + dy) !== 1) faces.push(f); });
          const outsideDir = onP ? (x === bd.x ? 'w' : x === bd.x + bd.bw - 1 ? 'e' : y === bd.y ? 'n' : 's') : '';
          faces.forEach(f => {
            const ext = f === outsideDir;
            box(B, x, y, DOOR_H, x + 1, y + 1, ext ? top : CZ, ext ? wl : Lr.INTERIOR, ext ? wc : INT, ext ? us : 0.8, f);
          });
          box(B, x, y, DOOR_H, x + 1, y + 1, top, Lr.INTERIOR, shade(INT, 0.8), 1, 'b');
          // 外側の扉枠
          if (onP) {
            const o = 0.035, th = 0.07;
            if (outsideDir === 'n' || outsideDir === 's') {
              const yy = outsideDir === 'n' ? y - o : y + 1 + o - th;
              box(B, x, yy, DOOR_H - 0.02, x + 1, yy + th, DOOR_H + 0.07, Lr.WHITE, TRIM, 1);
            } else {
              const xx = outsideDir === 'w' ? x - o : x + 1 + o - th;
              box(B, xx, y, DOOR_H - 0.02, xx + th, y + 1, DOOR_H + 0.07, Lr.WHITE, TRIM, 1);
            }
          }
        }
      }

      /* --- 窓（外壁のみ。角と出入口の隣は避ける） --- */
      const floors = Math.max(1, Math.floor((hgt - 0.1) / CZ + 0.35));
      const addWindow = (x, y, dir) => {
        for (let f = 0; f < floors; f++) {
          const z0 = f * CZ + 0.52, z1 = z0 + 0.58;
          if (z1 > hgt - 0.12) break;
          const off = 0.012, a = 0.18, b = 0.82;
          let p0, p1, p2, p3, n;
          if (dir === 'n') { p0 = [x + a, y - off, z0]; p1 = [x + b, y - off, z0]; p2 = [x + b, y - off, z1]; p3 = [x + a, y - off, z1]; n = [0, -1, 0]; }
          else if (dir === 's') { p0 = [x + b, y + 1 + off, z0]; p1 = [x + a, y + 1 + off, z0]; p2 = [x + a, y + 1 + off, z1]; p3 = [x + b, y + 1 + off, z1]; n = [0, 1, 0]; }
          else if (dir === 'w') { p0 = [x - off, y + b, z0]; p1 = [x - off, y + a, z0]; p2 = [x - off, y + a, z1]; p3 = [x - off, y + b, z1]; n = [-1, 0, 0]; }
          else { p0 = [x + 1 + off, y + a, z0]; p1 = [x + 1 + off, y + b, z0]; p2 = [x + 1 + off, y + b, z1]; p3 = [x + 1 + off, y + a, z1]; n = [1, 0, 0]; }
          quad(B, p0, p1, p2, p3, n, [0, 1, 1, 1, 1, 0, 0, 0], Lr.WINDOW, lin('#ffffff'));
          // 窓台
          const sill = 0.045;
          if (dir === 'n') box(B, x + a - 0.03, y - sill, z0 - 0.05, x + b + 0.03, y, z0, Lr.WHITE, TRIM, 1);
          else if (dir === 's') box(B, x + a - 0.03, y + 1, z0 - 0.05, x + b + 0.03, y + 1 + sill, z0, Lr.WHITE, TRIM, 1);
          else if (dir === 'w') box(B, x - sill, y + a - 0.03, z0 - 0.05, x, y + b + 0.03, z0, Lr.WHITE, TRIM, 1);
          else box(B, x + 1, y + a - 0.03, z0 - 0.05, x + 1 + sill, y + b + 0.03, z0, Lr.WHITE, TRIM, 1);
        }
      };
      const winEvery = wl === Lr.METAL ? 3 : 2;
      for (let x = bd.x + 1; x < bd.x + bd.bw - 1; x++) {
        if ((x - bd.x) % winEvery === 1) {
          if (at(x, bd.y) === 1 && at(x - 1, bd.y) === 1 && at(x + 1, bd.y) === 1) addWindow(x, bd.y, 'n');
          const yb = bd.y + bd.bh - 1;
          if (at(x, yb) === 1 && at(x - 1, yb) === 1 && at(x + 1, yb) === 1) addWindow(x, yb, 's');
        }
      }
      for (let y = bd.y + 1; y < bd.y + bd.bh - 1; y++) {
        if ((y - bd.y) % winEvery === 1) {
          if (at(bd.x, y) === 1 && at(bd.x, y - 1) === 1 && at(bd.x, y + 1) === 1) addWindow(bd.x, y, 'w');
          const xb = bd.x + bd.bw - 1;
          if (at(xb, y) === 1 && at(xb, y - 1) === 1 && at(xb, y + 1) === 1) addWindow(xb, y, 'e');
        }
      }

      /* --- 天井 --- */
      const ix0 = bd.x + 1, iy0 = bd.y + 1, ix1 = bd.x + bd.bw - 1, iy1 = bd.y + bd.bh - 1;
      quad(B, [ix0, iy1, CZ], [ix1, iy1, CZ], [ix1, iy0, CZ], [ix0, iy0, CZ], [0, 0, -1],
        [0, 0, (ix1 - ix0) * 0.5, 0, (ix1 - ix0) * 0.5, (iy1 - iy0) * 0.5, 0, (iy1 - iy0) * 0.5], Lr.INTERIOR, CEIL);
      // 基礎（地面との境目を締める）
      box(B, bd.x - 0.04, bd.y - 0.04, 0, bd.x + bd.bw + 0.04, bd.y + bd.bh + 0.04, 0.09, Lr.CONCRETE, lin('#8a8780'), 1, 'nsew');

      /* --- 屋根 --- */
      const x0 = bd.x, y0 = bd.y, x1 = bd.x + bd.bw, y1 = bd.y + bd.bh;
      const rc = lin(st.roofTint);
      if (st.roof === 'flat') {
        box(B, x0 - 0.06, y0 - 0.06, hgt, x1 + 0.06, y1 + 0.06, hgt + 0.1, Lr.CONCRETE, shade(rc, 0.9), 0.6, 'nsewtb', Lr.CONCRETE, rc);
        const pt = 0.12, ph = 0.26, z = hgt + 0.1;
        box(B, x0 - 0.06, y0 - 0.06, z, x1 + 0.06, y0 - 0.06 + pt, z + ph, wl, wc, us);
        box(B, x0 - 0.06, y1 + 0.06 - pt, z, x1 + 0.06, y1 + 0.06, z + ph, wl, wc, us);
        box(B, x0 - 0.06, y0 - 0.06, z, x0 - 0.06 + pt, y1 + 0.06, z + ph, wl, wc, us);
        box(B, x1 + 0.06 - pt, y0 - 0.06, z, x1 + 0.06, y1 + 0.06, z + ph, wl, wc, us);
        // 屋上の室外機・給水タンク・換気口
        const nAc = 1 + ((R() * 3) | 0);
        for (let i = 0; i < nAc; i++) {
          const ax = x0 + 1 + R() * (bd.bw - 2.5), ay = y0 + 1 + R() * (bd.bh - 2.5);
          obox(B, ax, ay, z, 0.32, 0.24, 0.3, (R() < 0.5 ? 0 : Math.PI / 2), Lr.METAL, lin('#b8bcbc'), 1);
        }
        if (bd.area === 'city' && R() < 0.5) {
          const tx = x0 + 1.5 + R() * (bd.bw - 3), ty = y0 + 1.5 + R() * (bd.bh - 3);
          for (let k = 0; k < 4; k++) {
            const lx = tx + (k & 1 ? 0.3 : -0.3), ly = ty + (k & 2 ? 0.3 : -0.3);
            box(B, lx - 0.03, ly - 0.03, z, lx + 0.03, ly + 0.03, z + 0.5, Lr.METAL, lin('#6a6e70'), 1);
          }
          cylinder(B, tx, ty, z + 0.5, z + 1.05, 0.42, 0.42, 12, Lr.BARREL, lin('#8f9aa0'), true, 2);
        }
      } else if (st.roof === 'gable') {
        const o = 0.28;
        const alongX = bd.bw >= bd.bh;
        const span = alongX ? bd.bh : bd.bw;
        const rise = span * 0.5 * 0.62;
        const zr = hgt + rise;
        const X0 = x0 - o, X1 = x1 + o, Y0 = y0 - o, Y1 = y1 + o;
        const zE = hgt - o * 0.62;                      // 軒先は壁より少し下
        if (alongX) {
          const ym = (y0 + y1) / 2;
          const sl = Math.hypot(ym - Y0, zr - zE);
          const n1 = [0, -(zr - zE) / sl, (ym - Y0) / sl], n2 = [0, (zr - zE) / sl, (ym - Y0) / sl];
          quad(B, [X0, Y0, zE], [X1, Y0, zE], [X1, ym, zr], [X0, ym, zr], n1, [X0, 0, X1, 0, X1, sl * 1.2, X0, sl * 1.2], Lr.ROOF, rc);
          quad(B, [X1, Y1, zE], [X0, Y1, zE], [X0, ym, zr], [X1, ym, zr], n2, [X1, 0, X0, 0, X0, sl * 1.2, X1, sl * 1.2], Lr.ROOF, rc);
          // 妻壁（三角）
          tri(B, [x0, y0, hgt], [x0, y1, hgt], [x0, ym, zr - 0.02], [-1, 0, 0], [y0 * us, hgt * us, y1 * us, hgt * us, ym * us, zr * us], wl, wc);
          tri(B, [x1, y1, hgt], [x1, y0, hgt], [x1, ym, zr - 0.02], [1, 0, 0], [y1 * us, hgt * us, y0 * us, hgt * us, ym * us, zr * us], wl, wc);
          // 軒裏
          quad(B, [X0, Y0, zE - 0.01], [X0, ym, zr - 0.06], [X1, ym, zr - 0.06], [X1, Y0, zE - 0.01], [0, 0, -1], [0, 0, 0, 1, 1, 1, 1, 0], Lr.WOOD, shade(DARK, 1.6));
          quad(B, [X1, Y1, zE - 0.01], [X1, ym, zr - 0.06], [X0, ym, zr - 0.06], [X0, Y1, zE - 0.01], [0, 0, -1], [0, 0, 0, 1, 1, 1, 1, 0], Lr.WOOD, shade(DARK, 1.6));
          // 棟
          box(B, X0, ym - 0.06, zr - 0.04, X1, ym + 0.06, zr + 0.05, Lr.ROOF, shade(rc, 0.8), 1);
        } else {
          const xm = (x0 + x1) / 2;
          const sl = Math.hypot(xm - X0, zr - zE);
          const n1 = [-(zr - zE) / sl, 0, (xm - X0) / sl], n2 = [(zr - zE) / sl, 0, (xm - X0) / sl];
          quad(B, [X0, Y1, zE], [X0, Y0, zE], [xm, Y0, zr], [xm, Y1, zr], n1, [Y1, 0, Y0, 0, Y0, sl * 1.2, Y1, sl * 1.2], Lr.ROOF, rc);
          quad(B, [X1, Y0, zE], [X1, Y1, zE], [xm, Y1, zr], [xm, Y0, zr], n2, [Y0, 0, Y1, 0, Y1, sl * 1.2, Y0, sl * 1.2], Lr.ROOF, rc);
          tri(B, [x1, y0, hgt], [x0, y0, hgt], [xm, y0, zr - 0.02], [0, -1, 0], [x1 * us, hgt * us, x0 * us, hgt * us, xm * us, zr * us], wl, wc);
          tri(B, [x0, y1, hgt], [x1, y1, hgt], [xm, y1, zr - 0.02], [0, 1, 0], [x0 * us, hgt * us, x1 * us, hgt * us, xm * us, zr * us], wl, wc);
          quad(B, [X0, Y0, zE - 0.01], [xm, Y0, zr - 0.06], [xm, Y1, zr - 0.06], [X0, Y1, zE - 0.01], [0, 0, -1], [0, 0, 0, 1, 1, 1, 1, 0], Lr.WOOD, shade(DARK, 1.6));
          quad(B, [X1, Y1, zE - 0.01], [xm, Y1, zr - 0.06], [xm, Y0, zr - 0.06], [X1, Y0, zE - 0.01], [0, 0, -1], [0, 0, 0, 1, 1, 1, 1, 0], Lr.WOOD, shade(DARK, 1.6));
          box(B, xm - 0.06, Y0, zr - 0.04, xm + 0.06, Y1, zr + 0.05, Lr.ROOF, shade(rc, 0.8), 1);
        }
        // 煙突
        if (bd.area === 'village' || R() < 0.4) {
          const cx = x0 + 1 + R() * (bd.bw - 2), cy = y0 + 1 + R() * (bd.bh - 2);
          box(B, cx - 0.16, cy - 0.16, hgt, cx + 0.16, cy + 0.16, zr + 0.35, Lr.BRICK, lin('#ffffff'), 1.6);
          box(B, cx - 0.19, cy - 0.19, zr + 0.35, cx + 0.19, cy + 0.19, zr + 0.42, Lr.CONCRETE, lin('#7a7872'), 1);
        }
      } else {
        // 片流れ（工場・倉庫）。短辺方向に傾ける
        const o = 0.18;
        const alongX = bd.bw >= bd.bh;
        const zHi = hgt + 0.55, zLo = hgt;
        const X0 = x0 - o, X1 = x1 + o, Y0 = y0 - o, Y1 = y1 + o;
        const mc = lin(st.roofTint);
        if (alongX) {
          const sl = Math.hypot(Y1 - Y0, zHi - zLo);
          const n = [0, (zHi - zLo) / sl, (Y1 - Y0) / sl];
          quad(B, [X1, Y1, zLo], [X0, Y1, zLo], [X0, Y0, zHi], [X1, Y0, zHi], n, [X1 * 0.9, 0, X0 * 0.9, 0, X0 * 0.9, sl, X1 * 0.9, sl], Lr.METAL, mc);
          quad(B, [X0, Y0, zHi - 0.05], [X1, Y0, zHi - 0.05], [X1, Y1, zLo - 0.05], [X0, Y1, zLo - 0.05], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], Lr.METAL, shade(mc, 0.4));
          box(B, x0, y0, hgt, x1, y0 + 1, zHi, wl, wc, us, 'n');
          tri(B, [x0, y0, hgt], [x0, y1, hgt], [x0, y0, zHi], [-1, 0, 0], [y0 * us, hgt * us, y1 * us, hgt * us, y0 * us, zHi * us], wl, wc);
          tri(B, [x1, y1, hgt], [x1, y0, hgt], [x1, y0, zHi], [1, 0, 0], [y1 * us, hgt * us, y0 * us, hgt * us, y0 * us, zHi * us], wl, wc);
        } else {
          const sl = Math.hypot(X1 - X0, zHi - zLo);
          const n = [(zHi - zLo) / sl, 0, (X1 - X0) / sl];
          quad(B, [X1, Y0, zLo], [X1, Y1, zLo], [X0, Y1, zHi], [X0, Y0, zHi], n, [Y0 * 0.9, 0, Y1 * 0.9, 0, Y1 * 0.9, sl, Y0 * 0.9, sl], Lr.METAL, mc);
          quad(B, [X0, Y1, zHi - 0.05], [X0, Y0, zHi - 0.05], [X1, Y0, zLo - 0.05], [X1, Y1, zLo - 0.05], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], Lr.METAL, shade(mc, 0.4));
          box(B, x0, y0, hgt, x0 + 1, y1, zHi, wl, wc, us, 'w');
          tri(B, [x1, y0, hgt], [x0, y0, hgt], [x0, y0, zHi], [0, -1, 0], [x1 * us, hgt * us, x0 * us, hgt * us, x0 * us, zHi * us], wl, wc);
          tri(B, [x0, y1, hgt], [x1, y1, hgt], [x0, y1, zHi], [0, 1, 0], [x0 * us, hgt * us, x1 * us, hgt * us, x0 * us, zHi * us], wl, wc);
        }
        // 壁の上端を塞ぐ
        box(B, x0, y0, hgt - 0.01, x1, y1, hgt, Lr.METAL, shade(mc, 0.5), 1, 'b');
      }
    });
  }

  /* ================================================================
   * 木・岩・木箱・茂み・電柱
   * ============================================================== */
  /** 枝の板（幹から外へ垂れ下がる1枚）。切り抜きの BRANCH テクスチャを貼る */
  function branchCard(C, cx, cy, z, ang, len, wid, droop, col) {
    const Lr = L();
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const px = -sa, py = ca;                     // 横方向
    const x0 = cx + ca * 0.05, y0 = cy + sa * 0.05;
    const x1 = cx + ca * len, y1 = cy + sa * len, z1 = z - droop;
    const hw0 = wid * 0.5, hw1 = wid * 0.28;
    const n = [ca * 0.35, sa * 0.35, 0.94];
    quad(C, [x0 - px * hw0, y0 - py * hw0, z + 0.02], [x1 - px * hw1, y1 - py * hw1, z1], [x1 + px * hw1, y1 + py * hw1, z1], [x0 + px * hw0, y0 + py * hw0, z + 0.02],
      n, [0, 0, 1, 0, 1, 1, 0, 1], Lr.BRANCH, col);
  }

  function nature(map, B, C, H, ground) {
    const Lr = L();
    const w = map.w;
    const nearest = (x, y) => {
      let best = null, bd = 1e9;
      map.landmarks.forEach(l => { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } });
      return best;
    };
    for (let y = 0; y < map.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, t = map.grid[i];
      if (t !== 2 && t !== 3) continue;
      const R = rng(map.seed * 31 + i * 2654435761);
      const cx = x + 0.5 + (R() - 0.5) * 0.25, cy = y + 0.5 + (R() - 0.5) * 0.25;
      let kind = map.deco ? map.deco[i] : 0;
      if (!kind) kind = t === 3 ? 3 : (nearest(x, y).key === 'mountain' ? 2 : 1);
      if (kind === 1) {
        const h = 3.0 + R() * 1.8;
        H[i] = h;
        if (R() < 0.8) {
          // 針葉樹
          cylinder(B, cx, cy, -0.05, h * 0.92, 0.085, 0.03, 7, Lr.BARK, lin('#e0d0c0'), false, 1);
          const tiers = 5;
          const baseCol = lin(['#e6eedc', '#d4e0c8', '#f0f4e4', '#dce4cc'][(R() * 4) | 0]);
          const cardCol = baseCol;
          for (let k = 0; k < tiers; k++) {
            const f = k / tiers;
            const z0 = 0.45 + f * (h - 0.9);
            const th = (h - 0.5) / tiers * 1.65;
            const r = 0.98 * (1 - f * 0.78);
            // 芯は細めの円錐、その外側に垂れた枝の板を放射状に挿して輪郭をぼかす
            jaggedCone(B, cx, cy, z0, th, r * 0.8, 12, Lr.NEEDLE, shade(baseCol, 0.8 + f * 0.25), R);
            const nb = 7 - (k >> 1);
            for (let j = 0; j < nb; j++) {
              const a = j / nb * Math.PI * 2 + R() * 0.6 + k * 0.7;
              branchCard(C, cx, cy, z0 + th * (0.30 + R() * 0.14), a, r * (1.08 + R() * 0.3), r * 1.1, r * 0.34, shade(cardCol, 0.85 + f * 0.25));
            }
          }
        } else {
          // 白樺（白い幹 + 丸い葉の塊）
          cylinder(B, cx, cy, -0.05, h * 0.8, 0.07, 0.04, 7, Lr.WHITE, lin('#d6d0c2'), false, 1);
          const lc = lin(['#f4ffd8', '#ffffe0', '#e8f8d0'][(R() * 3) | 0]);
          for (let k = 0; k < 4; k++) {
            blob(B, cx + (R() - 0.5) * 0.7, cy + (R() - 0.5) * 0.7, h * (0.62 + R() * 0.3), 0.6 + R() * 0.3, 0.6 + R() * 0.3, 0.55 + R() * 0.25, 0.35, Lr.NEEDLE, lc, R);
          }
        }
        // 根元の茂み
        if (R() < 0.6) cards(C, cx + (R() - 0.5) * 0.6, cy + (R() - 0.5) * 0.6, 0.9, 0.55, 3, Lr.LEAF, lin('#b8c89a'), R() * 3);
      } else if (kind === 2) {
        const s = 0.55 + R() * 0.35, hz = 0.55 + R() * 0.55;
        blob(B, cx, cy, hz * 0.55, s, s * (0.8 + R() * 0.4), hz, 0.42, Lr.ROCK, lin(['#f2eee6', '#e2ded6', '#fffaf0'][(R() * 3) | 0]), R, true);
        if (R() < 0.5) blob(B, cx + (R() - 0.5) * 0.6, cy + (R() - 0.5) * 0.6, 0.18, 0.35, 0.3, 0.3, 0.5, Lr.ROCK, lin('#e8e4dc'), R, true);
        H[i] = hz * 1.1;
      } else {
        const lm = nearest(x, y);
        const ang = (R() - 0.5) * 0.5;
        if ((lm.key === 'harbor' || lm.key === 'industrial') && R() < 0.45) {
          // 小型コンテナ
          const col = lin(['#8a3a2e', '#2e5a8a', '#3a6a3a', '#a07a2a', '#6a6e72'][(R() * 5) | 0]);
          obox(B, cx, cy, 0, 0.5, 0.46, 1.25, ang * 0.3, Lr.METAL, col, 1);
          H[i] = 1.25;
        } else if (lm.key === 'industrial' && R() < 0.5) {
          // ドラム缶の山
          const col = lin(['#2e5a8a', '#8a2e2e', '#c8a032', '#3a6a3a'][(R() * 4) | 0]);
          for (let k = 0; k < 4; k++) {
            const bx = cx + (k & 1 ? 0.22 : -0.22), by = cy + (k & 2 ? 0.22 : -0.22);
            cylinder(B, bx, by, 0, 0.58, 0.2, 0.2, 10, Lr.BARREL, col, true, 1);
          }
          cylinder(B, cx, cy, 0.58, 1.16, 0.2, 0.2, 10, Lr.BARREL, col, true, 1);
          H[i] = 1.16;
        } else {
          // 木箱の積み上げ（軍用は緑）
          const col = lm.key === 'military' ? lin('#8a9a6a') : lin('#ffffff');
          obox(B, cx, cy, 0, 0.44, 0.44, 0.62, ang, Lr.CRATE, col, 1);
          if (R() < 0.8) obox(B, cx + (R() - 0.5) * 0.12, cy + (R() - 0.5) * 0.12, 0.62, 0.36, 0.36, 0.56, ang + (R() - 0.5) * 0.6, Lr.CRATE, col, 1);
          H[i] = 1.2;
        }
      }
    }

    /* --- 茂みと小石（当たり判定なし） --- */
    const R = rng(map.seed ^ 0xb005);
    const mask = ground.mask.getContext('2d').getImageData(0, 0, ground.mask.width, ground.mask.height).data;
    const G = WorldTex.GROUND, MS = ground.mask.width;
    const maskAt = (x, y) => {
      const px = Math.floor((x - G.origin) / G.size * MS), py = Math.floor((y - G.origin) / G.size * MS);
      if (px < 0 || py < 0 || px >= MS || py >= MS) return 0;
      return mask[(py * MS + px) * 4] / 255;
    };
    let bushes = 0;
    const maxBush = map.lobby ? 0 : 520;
    for (let n = 0; n < 5000 && bushes < maxBush; n++) {
      const x = 2 + R() * (w - 4), y = 2 + R() * (map.h - 4);
      const cx = x | 0, cy = y | 0;
      if (map.grid[cy * w + cx] !== 0) continue;
      const m = maskAt(x, y);
      const lm = nearest(x, y);
      const dens = lm.key === 'forest' && Math.hypot(lm.x - x, lm.y - y) < lm.r * 1.2 ? 0.5 : 0.08;
      if (R() > m * dens * 2.2) continue;
      const s = 0.6 + R() * 0.6;
      cards(C, x, y, 1.0 * s, 0.62 * s, 3, Lr.LEAF, lin(['#c8d8a0', '#b0c488', '#d8d8a0'][(R() * 3) | 0]), R() * 3);
      bushes++;
    }
    map.landmarks.filter(l => l.key === 'mountain').forEach(l => {
      for (let n = 0; n < 90; n++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * l.r * 1.1;
        const x = l.x + Math.cos(a) * d, y = l.y + Math.sin(a) * d;
        if (map.grid[(y | 0) * w + (x | 0)] !== 0) continue;
        const s = 0.08 + R() * 0.12;
        blob(B, x, y, s * 0.3, s, s, s * 0.7, 0.4, Lr.ROCK, lin('#dcd8d0'), R, true);
      }
    });

    /* --- 電柱と電線（幹線道路沿い。当たり判定なし） --- */
    (ground.roads || []).filter(r => r.main).forEach(r => {
      let acc = 0, prev = null;
      const poles = [];
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        acc += seg;
        if (acc >= 7.5) {
          acc = 0;
          const nx = -(b.y - a.y) / seg, ny = (b.x - a.x) / seg;
          const px = b.x + nx * 2.1, py = b.y + ny * 2.1;
          const cx = px | 0, cy = py | 0;
          if (cx < 1 || cy < 1 || cx >= w - 1 || cy >= map.h - 1 || map.grid[cy * w + cx] !== 0) { prev = null; continue; }
          poles.push({ x: px, y: py, dx: nx, dy: ny, prev });
          prev = poles[poles.length - 1];
        }
      }
      poles.forEach(p => {
        cylinder(B, p.x, p.y, -0.05, 3.3, 0.05, 0.04, 6, Lr.WOOD, lin('#8a7a66'), true, 1);
        box(B, p.x - p.dx * 0.45 - 0.03, p.y - p.dy * 0.45 - 0.03, 3.05, p.x + p.dx * 0.45 + 0.03, p.y + p.dy * 0.45 + 0.03, 3.1, Lr.WOOD, lin('#7a6a56'), 1);
        if (p.prev) {
          // 電線（たるみ付き）。細い帯として描く
          for (const side of [-0.4, 0.4]) {
            const ax = p.prev.x + p.prev.dx * side, ay = p.prev.y + p.prev.dy * side;
            const bx = p.x + p.dx * side, by = p.y + p.dy * side;
            const segs = 6;
            for (let k = 0; k < segs; k++) {
              const t0 = k / segs, t1 = (k + 1) / segs;
              const z0 = 3.08 - Math.sin(t0 * Math.PI) * 0.35, z1 = 3.08 - Math.sin(t1 * Math.PI) * 0.35;
              const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
              quad(B, [x0, y0, z0], [x1, y1, z1], [x1, y1, z1 + 0.015], [x0, y0, z0 + 0.015], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], Lr.GUN, lin('#202020'));
            }
          }
        }
      });
    });
  }

  /**
   * 静的な世界をまとめて組み立てる。
   * @returns {{terrain, water, solid, cutout, tileH}}
   */
  function build(map) {
    const ground = WorldTex.paintGround(map);
    const tileH = new Float32Array(map.w * map.h);
    const solid = new GLC.Builder(LIT), cutout = new GLC.Builder(LIT);
    buildings(map, solid, tileH);
    nature(map, solid, cutout, tileH, ground);
    hills(map, solid);
    // 念のため: 高さ未設定の固いセルは 1.2 として扱う
    for (let i = 0; i < tileH.length; i++) if (map.grid[i] && map.grid[i] !== 4 && !tileH[i]) tileH[i] = 1.2;
    const ter = terrain(map, ground);
    return { ground, terrain: ter, water: water(map), solid: solid.data(), cutout: cutout.data(), tileH };
  }

  g.GLWorld = { build, box, obox, cylinder, blob, quad, tri, cards, LIT, CZ, DOOR_H };
})(window);
