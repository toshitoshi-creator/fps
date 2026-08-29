/* =========================================================================
 * scan2map.js — LiDAR スキャン / 点群 → STEEL PROTOCOL のマップ文字列
 *
 * iPhone/iPad Pro の LiDAR スキャン (Polycam / Scaniverse / 3d Scanner App)
 * から書き出した OBJ / PLY / STL / XYZ を読み込み、
 *   1. 上方向軸と床面を推定
 *   2. 腰〜頭の高さで水平にスライス
 *   3. 1セル = 1m の占有グリッドへ投影
 *   4. ノイズ除去・穴埋め・外周封鎖・到達不能領域の除去
 * を行って、エンジンがそのまま読める '#' / '.' のマップ配列を作る。
 *
 * ブラウザ (tools/scan2map.html) と Node (test/scan2map.test.js) の両方から使う。
 * ======================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scan2Map = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------
   * 1. パーサ — 返り値は Float32Array 形式の点群 {xyz, count, faces?}
   * ----------------------------------------------------------------*/

  function parseOBJ(text) {
    const xs = [], ys = [], zs = [], faces = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.charCodeAt(0) === 118 && l[1] === ' ') {            // "v "
        const p = l.split(/\s+/);
        xs.push(+p[1]); ys.push(+p[2]); zs.push(+p[3]);
      } else if (l.charCodeAt(0) === 102 && l[1] === ' ') {     // "f "
        const p = l.trim().split(/\s+/);
        const idx = [];
        for (let k = 1; k < p.length; k++) {
          let v = parseInt(p[k], 10);
          if (isNaN(v)) continue;
          idx.push(v < 0 ? xs.length + v : v - 1);
        }
        for (let k = 2; k < idx.length; k++) faces.push(idx[0], idx[k - 1], idx[k]);
      }
    }
    return toCloud(xs, ys, zs, faces);
  }

  function parsePLY(buf) {
    const bytes = new Uint8Array(buf);
    // ヘッダは必ず ASCII
    let headEnd = -1;
    const HDR = 'end_header';
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
      head += String.fromCharCode(bytes[i]);
      if (head.length > HDR.length && head.slice(-HDR.length - 1, -1) === HDR && bytes[i] === 10) { headEnd = i + 1; break; }
      if (bytes[i] === 10 && head.trim().endsWith(HDR)) { headEnd = i + 1; break; }
    }
    if (headEnd < 0) throw new Error('PLY: end_header が見つかりません');
    const lines = head.split(/\r?\n/);
    let format = 'ascii', vCount = 0, fCount = 0;
    const props = [];            // 頂点プロパティ
    let inVertex = false;
    for (const raw of lines) {
      const l = raw.trim();
      if (l.startsWith('format')) format = l.split(/\s+/)[1];
      else if (l.startsWith('element vertex')) { vCount = +l.split(/\s+/)[2]; inVertex = true; }
      else if (l.startsWith('element face')) { fCount = +l.split(/\s+/)[2]; inVertex = false; }
      else if (l.startsWith('element')) inVertex = false;
      else if (l.startsWith('property') && inVertex) {
        const p = l.split(/\s+/);
        if (p[1] !== 'list') props.push({ type: p[1], name: p[2] });
      }
    }
    const xi = props.findIndex(p => p.name === 'x');
    const yi = props.findIndex(p => p.name === 'y');
    const zi = props.findIndex(p => p.name === 'z');
    if (xi < 0 || yi < 0 || zi < 0) throw new Error('PLY: x/y/z プロパティがありません');

    const xs = new Float64Array(vCount), ys = new Float64Array(vCount), zs = new Float64Array(vCount);
    if (format === 'ascii') {
      const body = new TextDecoder().decode(bytes.subarray(headEnd));
      const rows = body.split(/\r?\n/);
      let n = 0;
      for (let i = 0; i < rows.length && n < vCount; i++) {
        const r = rows[i].trim();
        if (!r) continue;
        const p = r.split(/\s+/);
        xs[n] = +p[xi]; ys[n] = +p[yi]; zs[n] = +p[zi];
        n++;
      }
      return toCloud(xs, ys, zs, null, n);
    }
    if (format !== 'binary_little_endian') throw new Error('PLY: ' + format + ' 形式は未対応です (ascii / binary_little_endian のみ)');
    const SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const off = [];
    let stride = 0;
    for (const p of props) { off.push(stride); stride += SIZE[p.type] || 4; }
    const dv = new DataView(buf, headEnd);
    const read = (base, i) => {
      const t = props[i].type, o = base + off[i];
      switch (t) {
        case 'double': case 'float64': return dv.getFloat64(o, true);
        case 'int': case 'int32': return dv.getInt32(o, true);
        case 'uint': case 'uint32': return dv.getUint32(o, true);
        case 'short': case 'int16': return dv.getInt16(o, true);
        case 'ushort': case 'uint16': return dv.getUint16(o, true);
        case 'char': case 'int8': return dv.getInt8(o);
        case 'uchar': case 'uint8': return dv.getUint8(o);
        default: return dv.getFloat32(o, true);
      }
    };
    const maxN = Math.min(vCount, Math.floor(dv.byteLength / stride));
    for (let i = 0; i < maxN; i++) {
      const base = i * stride;
      xs[i] = read(base, xi); ys[i] = read(base, yi); zs[i] = read(base, zi);
    }
    return toCloud(xs, ys, zs, null, maxN);
  }

  function parseSTL(buf) {
    const bytes = new Uint8Array(buf);
    const head = new TextDecoder().decode(bytes.subarray(0, 80));
    const xs = [], ys = [], zs = [];
    if (head.trim().toLowerCase().startsWith('solid') && bytes.length > 84 &&
      new TextDecoder().decode(bytes.subarray(0, 256)).indexOf('facet') >= 0) {
      const text = new TextDecoder().decode(bytes);
      const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
      let m;
      while ((m = re.exec(text))) { xs.push(+m[1]); ys.push(+m[2]); zs.push(+m[3]); }
    } else {
      const dv = new DataView(buf);
      const n = dv.getUint32(80, true);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let v = 0; v < 3; v++) {
          xs.push(dv.getFloat32(o + v * 12, true));
          ys.push(dv.getFloat32(o + v * 12 + 4, true));
          zs.push(dv.getFloat32(o + v * 12 + 8, true));
        }
      }
    }
    const faces = [];
    for (let i = 0; i + 2 < xs.length; i += 3) faces.push(i, i + 1, i + 2);
    return toCloud(xs, ys, zs, faces);
  }

  function parseXYZ(text) {
    const xs = [], ys = [], zs = [];
    const rows = text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].trim();
      if (!r || r[0] === '#' || r[0] === '/') continue;
      const p = r.split(/[\s,;]+/);
      const a = +p[0], b = +p[1], c = +p[2];
      if (isNaN(a) || isNaN(b) || isNaN(c)) continue;
      xs.push(a); ys.push(b); zs.push(c);
    }
    return toCloud(xs, ys, zs);
  }

  function toCloud(xs, ys, zs, faces, count) {
    const n = count == null ? xs.length : count;
    const xyz = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { xyz[i * 3] = xs[i]; xyz[i * 3 + 1] = ys[i]; xyz[i * 3 + 2] = zs[i]; }
    return { xyz, count: n, faces: faces && faces.length ? Int32Array.from(faces) : null };
  }

  /** 拡張子や中身から適切なパーサを選ぶ。data は string | ArrayBuffer */
  function parse(name, data) {
    const ext = (name || '').toLowerCase().split('.').pop();
    const asText = () => typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data));
    const asBuf = () => typeof data === 'string' ? new TextEncoder().encode(data).buffer : data;
    switch (ext) {
      case 'obj': return parseOBJ(asText());
      case 'ply': return parsePLY(asBuf());
      case 'stl': return parseSTL(asBuf());
      case 'xyz': case 'pts': case 'txt': case 'csv': case 'asc': return parseXYZ(asText());
      default: {
        const t = asText().slice(0, 512);
        if (/^ply/m.test(t)) return parsePLY(asBuf());
        if (/^\s*v\s+-?[\d.]/m.test(t)) return parseOBJ(asText());
        if (/^solid/.test(t)) return parseSTL(asBuf());
        return parseXYZ(asText());
      }
    }
  }

  /* ------------------------------------------------------------------
   * 2. 三角形のサンプリング — メッシュが粗いときに面上へ点を増やす
   * ----------------------------------------------------------------*/
  function densify(cloud, spacing) {
    if (!cloud.faces || !cloud.faces.length) return cloud;
    const f = cloud.faces, p = cloud.xyz;
    const out = [];
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      if (a < 0 || b < 0 || c < 0 || a >= p.length || b >= p.length || c >= p.length) continue;
      const ab = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      const ac = Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
      const n = Math.min(24, Math.ceil(Math.max(ab, ac) / spacing));
      for (let u = 0; u <= n; u++) {
        for (let v = 0; v + u <= n; v++) {
          const s = u / n, t = v / n, w = 1 - s - t;
          out.push(
            p[a] * w + p[b] * s + p[c] * t,
            p[a + 1] * w + p[b + 1] * s + p[c + 1] * t,
            p[a + 2] * w + p[b + 2] * s + p[c + 2] * t);
        }
      }
    }
    const xyz = new Float32Array(cloud.xyz.length + out.length);
    xyz.set(cloud.xyz, 0);
    xyz.set(out, cloud.xyz.length);
    return { xyz, count: xyz.length / 3, faces: cloud.faces };
  }

  /* ------------------------------------------------------------------
   * 3. 上方向軸・床面の推定
   * ----------------------------------------------------------------*/
  function bounds(cloud) {
    const p = cloud.xyz, n = cloud.count;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = p[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  /** 部屋は「横に広く縦に低い」ので、最も広がりの小さい軸を上方向とみなす */
  function detectUpAxis(cloud) {
    const b = bounds(cloud);
    let up = 1;
    for (let k = 0; k < 3; k++) if (b.size[k] < b.size[up]) up = k;
    return up;                                   // 0=x, 1=y, 2=z
  }

  /** 上方向の値のヒストグラムから、最も点が集中する低い層＝床の高さを求める */
  function detectFloor(cloud, up, binSize) {
    const bs = binSize || 0.05;
    const b = bounds(cloud);
    const lo = b.lo[up], span = Math.max(1e-6, b.hi[up] - lo);
    const nb = Math.max(1, Math.min(4000, Math.ceil(span / bs)));
    const hist = new Int32Array(nb);
    const p = cloud.xyz;
    for (let i = 0; i < cloud.count; i++) {
      const v = p[i * 3 + up];
      let bi = Math.floor((v - lo) / bs);
      if (bi < 0) bi = 0; else if (bi >= nb) bi = nb - 1;
      hist[bi]++;
    }
    // 下から 60% の範囲で最大のピークを床とする（天井のピークを拾わないため）
    const limit = Math.max(1, Math.floor(nb * 0.6));
    let best = 0, bestI = 0;
    for (let i = 0; i < limit; i++) if (hist[i] > best) { best = hist[i]; bestI = i; }
    return lo + (bestI + 0.5) * bs;
  }

  /**
   * 床は必ずしも水平ではない（端末の姿勢誤差で 1〜2度傾く）。
   * 一定の高さでスライスすると遠くの床を取りこぼすので、床点に平面を当てて基準面にする。
   *   height(u,v) = a*u + b*v + c
   *
   * 壁や家具に引きずられないよう、まず水平1m格子ごとの「最低点」だけを集めて
   * 地面候補とし、そこへ平面を当ててから残差の小さい点で精製する。
   */
  function solve3(m, r) {
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (!isFinite(det) || Math.abs(det) < 1e-9) return null;
    const sub = col => {
      const mm = m.map(row => row.slice());
      for (let k = 0; k < 3; k++) mm[k][col] = r[k];
      return mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1])
        - mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0])
        + mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0]);
    };
    const out = [sub(0) / det, sub(1) / det, sub(2) / det];
    return out.every(isFinite) ? out : null;
  }

  function fitPlaneTo(pts, init) {
    let [a, b, c] = init;
    let band = 0.6;
    for (let it = 0; it < 4; it++) {
      let Suu = 0, Suv = 0, Su = 0, Svv = 0, Sv = 0, S1 = 0, Suz = 0, Svz = 0, Sz = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const u = pts[i], v = pts[i + 1], z = pts[i + 2];
        if (Math.abs(z - (a * u + b * v + c)) > band) continue;
        Suu += u * u; Suv += u * v; Su += u;
        Svv += v * v; Sv += v; S1 += 1;
        Suz += u * z; Svz += v * z; Sz += z;
      }
      if (S1 < 12) break;
      const sol = solve3([[Suu, Suv, Su], [Suv, Svv, Sv], [Su, Sv, S1]], [Suz, Svz, Sz]);
      if (!sol) break;
      a = sol[0]; b = sol[1]; c = sol[2];
      band = Math.max(0.08, band * 0.55);
    }
    return { a, b, c };
  }

  function fitFloorPlane(cloud, up, floorZ, opt) {
    const ax = [0, 1, 2].filter(k => k !== up);
    const p = cloud.xyz, n = cloud.count;
    const bin = (opt && opt.bin) || 1.0;
    const b = bounds(cloud);
    const w = Math.max(1, Math.ceil((b.hi[ax[0]] - b.lo[ax[0]]) / bin) + 1);
    const h = Math.max(1, Math.ceil((b.hi[ax[1]] - b.lo[ax[1]]) / bin) + 1);
    // 各水平ビンの最低点＝地面候補
    const lowZ = new Float64Array(w * h).fill(Infinity);
    const lowU = new Float64Array(w * h), lowV = new Float64Array(w * h);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const u = p[j + ax[0]], v = p[j + ax[1]], z = p[j + up];
      const cx = Math.floor((u - b.lo[ax[0]]) / bin), cy = Math.floor((v - b.lo[ax[1]]) / bin);
      const c = cy * w + cx;
      if (c < 0 || c >= lowZ.length) continue;
      if (z < lowZ[c]) { lowZ[c] = z; lowU[c] = u; lowV[c] = v; }
    }
    const cand = [];
    for (let i = 0; i < lowZ.length; i++) if (isFinite(lowZ[i])) cand.push(lowU[i], lowV[i], lowZ[i]);
    let plane;
    if (cand.length >= 36) plane = fitPlaneTo(cand, [0, 0, floorZ]);
    else plane = { a: 0, b: 0, c: floorZ };
    // 得られた面の近傍にある全点で最終精製（壁の根元も床高さなので害はない）
    const near = [];
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const u = p[j + ax[0]], v = p[j + ax[1]], z = p[j + up];
      if (Math.abs(z - (plane.a * u + plane.b * v + plane.c)) < 0.12) near.push(u, v, z);
    }
    if (near.length >= 300) plane = fitPlaneTo(near, [plane.a, plane.b, plane.c]);
    if (Math.hypot(plane.a, plane.b) > 0.35) plane = { a: 0, b: 0, c: floorZ };
    plane.tiltDeg = Math.atan(Math.hypot(plane.a, plane.b)) * 180 / Math.PI;
    return plane;
  }

  /* ------------------------------------------------------------------
   * 4. 占有グリッド化
   * ----------------------------------------------------------------*/
  const DEFAULTS = {
    cell: 1.0,          // 1セルの一辺 (m) — エンジンの 1 ユニット = 1m
    hMin: 0.45,         // 壁バンドの下限 (床からの高さ, m)
    hMax: 1.90,         // 壁バンドの上限 (m) — 天井と床を除外し、壁と家具だけ残す
    floorLo: -0.20,     // 床バンド（この範囲の点があるセルは「歩ける」）
    floorHi: 0.35,
    floorFrac: 0.34,    // セル内側の床被覆率がこれを超えたら歩行可能とみなす (0..1)
    threshold: null,    // 壁バンドのしきい値 (null = 自動) — slice モード時のみ
    mode: 'auto',       // 'floor' | 'slice' | 'auto'
    maxDim: 48,         // グリッドの最大辺（レイキャスタの実用範囲）
    up: null,           // null = 自動判定
    rotate: 0,          // 0/90/180/270
    flipX: false, flipY: false
  };

  function percentile(arr, q) {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)))];
  }

  /**
   * 点群を占有グリッドへ落とす。
   *
   * 素朴に「腰の高さに点があるセル＝壁」とすると、壁面の点はセル境界上に乗るため
   * 隣の空きセルまで壁に塗られ、1m幅の通路が塞がってしまう。
   * そこで既定では逆に「床が見えているセル＝歩ける」で判定する（floor モード）。
   * 床のないメッシュを渡された場合だけ従来のスライス方式へ自動で落ちる。
   */
  function gridify(cloud, opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const up = o.up == null ? detectUpAxis(cloud) : o.up;
    const ax = [0, 1, 2].filter(k => k !== up);      // 水平2軸
    const floor = o.floorLevel == null ? detectFloor(cloud, up) : o.floorLevel;
    const plane = o.levelFloor === false ? { a: 0, b: 0, c: floor, tiltDeg: 0 } : fitFloorPlane(cloud, up, floor);
    const p = cloud.xyz, n = cloud.count;

    // マップの範囲は「床が見えている領域」から取る。
    // 全点から取ると、傾いた天井や外壁の張り出しでグリッド原点が壁線からずれ、
    // 横方向の壁が2セルに分かれて消えてしまう。
    const b = bounds(cloud);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, fpts = 0;
    for (let i = 0; i < cloud.count; i++) {
      const j = i * 3;
      const u = p[j + ax[0]], v = p[j + ax[1]];
      const hh = p[j + up] - (plane.a * u + plane.b * v + plane.c);
      if (hh < o.floorLo || hh > o.floorHi) continue;
      fpts++;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    if (fpts < 200) {                       // 床が取れていないメッシュは全点にフォールバック
      minU = b.lo[ax[0]]; maxU = b.hi[ax[0]];
      minV = b.lo[ax[1]]; maxV = b.hi[ax[1]];
    }
    let cell = o.cell === 'auto' ? suggestCell(cloud, up, plane).cell : o.cell;
    let w = Math.ceil((maxU - minU) / cell) + 2;    // +2 は外周の壁ぶん
    let h = Math.ceil((maxV - minV) / cell) + 2;
    while ((w > o.maxDim || h > o.maxDim) && cell < 8) {
      cell *= 1.25;
      w = Math.ceil((maxU - minU) / cell) + 2;
      h = Math.ceil((maxV - minV) / cell) + 2;
    }
    w = Math.max(6, w); h = Math.max(6, h);

    // 壁の根元も床と同じ高さに点を持つが、それはセル境界に沿った“線”にしかならない。
    // そこで「セル内側60%の領域に落ちた床点」だけを数えると、面（床）と線（壁際）を分離できる。
    // しきい値はスキャン密度に合わせて自動正規化するので、粗いスキャンでも成立する。
    const MARGIN = 0.2;                    // セルの外周20%は壁際とみなして無視
    const inner = new Int32Array(w * h);
    const floorCnt = new Int32Array(w * h);
    const wallCnt = new Int32Array(w * h);
    let floorPts = 0, wallPts = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const u = p[j + ax[0]], v = p[j + ax[1]];
      const hh = p[j + up] - (plane.a * u + plane.b * v + plane.c);
      const isFloor = hh >= o.floorLo && hh <= o.floorHi;
      const isWall = hh >= o.hMin && hh <= o.hMax;
      if (!isFloor && !isWall) continue;
      const fx = (u - minU) / cell + 1, fy = (v - minV) / cell + 1;
      let cx = Math.floor(fx), cy = Math.floor(fy);
      if (cx < 0) cx = 0; else if (cx >= w) cx = w - 1;
      if (cy < 0) cy = 0; else if (cy >= h) cy = h - 1;
      const c = cy * w + cx;
      if (isWall) { wallCnt[c]++; wallPts++; }
      if (isFloor) {
        floorCnt[c]++; floorPts++;
        const ox = fx - Math.floor(fx), oy = fy - Math.floor(fy);
        if (ox > MARGIN && ox < 1 - MARGIN && oy > MARGIN && oy < 1 - MARGIN) inner[c]++;
      }
    }

    let mode = o.mode;
    if (mode === 'auto') mode = floorPts > Math.max(60, n * 0.02) ? 'floor' : 'slice';

    const grid = new Uint8Array(w * h);
    const cover = new Float32Array(w * h);
    let thr;
    if (mode === 'floor') {
      // 「よく見えている床セル」の点数を基準に、その floorFrac 倍を歩行可能の下限とする
      const nz = [];
      for (let i = 0; i < inner.length; i++) if (inner[i]) nz.push(inner[i]);
      const ref = percentile(nz, 0.9) || 1;
      thr = Math.max(1, ref * o.floorFrac);
      for (let i = 0; i < grid.length; i++) {
        cover[i] = inner[i] / ref;
        grid[i] = inner[i] >= thr ? 0 : 1;
      }
    } else {
      thr = o.threshold;
      if (thr == null) {
        const nz = [];
        for (let i = 0; i < wallCnt.length; i++) if (wallCnt[i]) nz.push(wallCnt[i]);
        thr = Math.max(3, Math.round(percentile(nz, 0.5) * 0.25));
      }
      for (let i = 0; i < grid.length; i++) grid[i] = wallCnt[i] >= thr ? 1 : 0;
    }

    let g = {
      w, h, grid, floorCnt, wallCnt, inner, cover, counts: mode === 'floor' ? floorCnt : wallCnt,
      cell, floor, plane, up, ax, minU, minV, mode, threshold: thr
    };
    if (o.rotate) g = rotate(g, o.rotate);
    if (o.flipX) g = flip(g, 'x');
    if (o.flipY) g = flip(g, 'y');
    return g;
  }

  /**
   * 床点のおおよその間隔からセルサイズを提案する。
   * 点がまばらなスキャンを 1m セルで刻むと、1セルあたりの床サンプルが足りず
   * 通路が途切れてしまうため、密度に応じて粗くする。
   */
  function estimateSpacing(cloud, up, plane) {
    const ax = [0, 1, 2].filter(k => k !== up);
    const p = cloud.xyz, n = cloud.count;
    const BIN = 0.25;
    const b = bounds(cloud);
    const w = Math.max(1, Math.ceil((b.hi[ax[0]] - b.lo[ax[0]]) / BIN) + 1);
    const h = Math.max(1, Math.ceil((b.hi[ax[1]] - b.lo[ax[1]]) / BIN) + 1);
    const occ = new Uint8Array(w * h);
    let count = 0, cells = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const u = p[j + ax[0]], v = p[j + ax[1]];
      const hh = p[j + up] - (plane.a * u + plane.b * v + plane.c);
      if (hh < -0.20 || hh > 0.35) continue;
      count++;
      const c = Math.floor((v - b.lo[ax[1]]) / BIN) * w + Math.floor((u - b.lo[ax[0]]) / BIN);
      if (c >= 0 && c < occ.length && !occ[c]) { occ[c] = 1; cells++; }
    }
    if (!count || !cells) return { spacing: 0.1, floorPoints: count, area: 0 };
    const area = cells * BIN * BIN;
    return { spacing: Math.sqrt(area / count), floorPoints: count, area };
  }

  function suggestCell(cloud, up, plane) {
    const u = up == null ? detectUpAxis(cloud) : up;
    const pl = plane || fitFloorPlane(cloud, u, detectFloor(cloud, u));
    const e = estimateSpacing(cloud, u, pl);
    // セル内側60%に最低でも数点欲しいので、間隔のおよそ6倍を目安にする
    const raw = Math.max(1.0, e.spacing * 6);
    return { cell: Math.min(2.5, Math.round(raw * 4) / 4), spacing: e.spacing, floorPoints: e.floorPoints };
  }

  /* ------------------------------------------------------------------
   * 5. 整形 — スキャン特有のノイズを潰し、エンジンの前提を満たす形にする
   * ----------------------------------------------------------------*/
  const at = (g, x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h) ? 1 : g.grid[y * g.w + x];

  function neighbours4(g, x, y) { return at(g, x + 1, y) + at(g, x - 1, y) + at(g, x, y + 1) + at(g, x, y - 1); }
  function neighbours8(g, x, y) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      n += at(g, x + dx, y + dy);
    }
    return n;
  }

  /** 孤立した壁ドット（スキャンノイズ）を消す */
  function despeckle(g, passes) {
    for (let p = 0; p < (passes || 1); p++) {
      const next = g.grid.slice();
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) continue;
        if (g.grid[y * g.w + x] && neighbours8(g, x, y) <= 1) next[y * g.w + x] = 0;
      }
      g.grid = next;
    }
    return g;
  }

  /** 壁に囲まれた 1 セルの穴を埋める（ドアを塞がないよう 4 近傍すべてが壁の場合のみ） */
  function fillHoles(g, passes) {
    for (let p = 0; p < (passes || 1); p++) {
      const next = g.grid.slice();
      for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
        if (!g.grid[y * g.w + x] && neighbours4(g, x, y) === 4) next[y * g.w + x] = 1;
      }
      g.grid = next;
    }
    return g;
  }

  /** 外周を必ず壁にする（エンジンはマップ外へ出られない前提） */
  function sealBorder(g) {
    for (let x = 0; x < g.w; x++) { g.grid[x] = 1; g.grid[(g.h - 1) * g.w + x] = 1; }
    for (let y = 0; y < g.h; y++) { g.grid[y * g.w] = 1; g.grid[y * g.w + g.w - 1] = 1; }
    return g;
  }

  /** 最大の空間を求める（複数の部屋に割れていたら一番広いものを採用） */
  function largestRegion(g) {
    const seen = new Int32Array(g.w * g.h).fill(-1);
    let best = null, id = 0;
    for (let i = 0; i < g.grid.length; i++) {
      if (g.grid[i] || seen[i] >= 0) continue;
      const q = [i]; seen[i] = id;
      const cells = [i];
      for (let k = 0; k < q.length; k++) {
        const c = q[k], cx = c % g.w, cy = (c / g.w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          const ni = ny * g.w + nx;
          if (g.grid[ni] || seen[ni] >= 0) continue;
          seen[ni] = id; q.push(ni); cells.push(ni);
        }
      }
      if (!best || cells.length > best.length) best = cells;
      id++;
    }
    return { cells: best || [], regions: id, seen };
  }

  /** 最大領域以外を壁で埋める（到達できない部屋があるとクリアできなくなる） */
  function keepLargestRegion(g) {
    const r = largestRegion(g);
    const keep = new Uint8Array(g.w * g.h);
    r.cells.forEach(i => keep[i] = 1);
    for (let i = 0; i < g.grid.length; i++) if (!g.grid[i] && !keep[i]) g.grid[i] = 1;
    g.regions = r.regions;
    g.freeCells = r.cells.length;
    return g;
  }

  /** 外側の全部壁の行・列を削る（1セルの縁は残す） */
  function crop(g) {
    let x0 = 0, y0 = 0, x1 = g.w - 1, y1 = g.h - 1;
    const rowFree = y => { for (let x = 0; x < g.w; x++) if (!g.grid[y * g.w + x]) return true; return false; };
    const colFree = x => { for (let y = 0; y < g.h; y++) if (!g.grid[y * g.w + x]) return true; return false; };
    while (y0 < y1 && !rowFree(y0 + 1)) y0++;
    while (y1 > y0 && !rowFree(y1 - 1)) y1--;
    while (x0 < x1 && !colFree(x0 + 1)) x0++;
    while (x1 > x0 && !colFree(x1 - 1)) x1--;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w === g.w && h === g.h) return g;
    const grid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = g.grid[(y + y0) * g.w + (x + x0)];
    return Object.assign({}, g, { w, h, grid });
  }

  function rotate(g, deg) {
    const times = ((deg / 90) | 0) & 3;
    let cur = g;
    for (let t = 0; t < times; t++) {
      const w = cur.h, h = cur.w;
      const grid = new Uint8Array(w * h);
      for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++)
        grid[x * w + (cur.h - 1 - y)] = cur.grid[y * cur.w + x];
      cur = Object.assign({}, cur, { w, h, grid });
    }
    return cur;
  }

  function flip(g, axis) {
    const grid = new Uint8Array(g.w * g.h);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const sx = axis === 'x' ? g.w - 1 - x : x;
      const sy = axis === 'y' ? g.h - 1 - y : y;
      grid[y * g.w + x] = g.grid[sy * g.w + sx];
    }
    return Object.assign({}, g, { grid });
  }

  /** ほぼ壁に囲まれた空きセル（床の取りこぼし）を壁に寄せる */
  function closeNooks(g, passes) {
    for (let p = 0; p < (passes || 1); p++) {
      const next = g.grid.slice();
      for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
        if (!g.grid[y * g.w + x] && neighbours8(g, x, y) >= 7) next[y * g.w + x] = 1;
      }
      g.grid = next;
    }
    return g;
  }

  /** スキャン結果をそのまま遊べる状態に整える一括処理 */
  function cleanup(g, opt) {
    const o = Object.assign({ despeckle: 1, fill: 1, nooks: 1, crop: true }, opt || {});
    if (o.despeckle) despeckle(g, o.despeckle);
    if (o.fill) fillHoles(g, o.fill);
    if (o.nooks) closeNooks(g, o.nooks);
    sealBorder(g);
    keepLargestRegion(g);          // 先に孤立領域を壁で埋めてから
    if (o.crop) g = crop(g);       // 余白を切り落とす（順序が逆だと死に領域が残る）
    sealBorder(g);
    keepLargestRegion(g);
    return g;
  }

  /* ------------------------------------------------------------------
   * 6. スポーン地点・敵配置
   * ----------------------------------------------------------------*/
  /** 壁からの距離が最大＝一番開けた場所をプレイヤー開始地点にする */
  function clearanceMap(g) {
    const INF = 1e9;
    const d = new Float64Array(g.w * g.h).fill(INF);
    for (let i = 0; i < g.grid.length; i++) if (g.grid[i]) d[i] = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y > 0) d[i] = Math.min(d[i], d[i - g.w] + 1);
    }
    for (let y = g.h - 1; y >= 0; y--) for (let x = g.w - 1; x >= 0; x--) {
      const i = y * g.w + x;
      if (x < g.w - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y < g.h - 1) d[i] = Math.min(d[i], d[i + g.w] + 1);
    }
    return d;
  }

  function pickSpawn(g) {
    const d = clearanceMap(g);
    let best = -1, bi = -1;
    for (let i = 0; i < d.length; i++) if (!g.grid[i] && d[i] > best) { best = d[i]; bi = i; }
    return bi < 0 ? null : { x: bi % g.w, y: (bi / g.w) | 0 };
  }

  /** スポーンから十分離れ、互いにも離れた開けた場所へ敵を撒く */
  function placeEnemies(g, spawn, spec, seed) {
    const d = clearanceMap(g);
    let rnd = (seed || 12345) >>> 0;
    const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cands = [];
    for (let i = 0; i < g.grid.length; i++) {
      if (g.grid[i] || d[i] < 1.4) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      const ds = Math.hypot(x - spawn.x, y - spawn.y);
      if (ds < 4) continue;
      cands.push({ x, y, score: ds + d[i] * 1.5 + rand() * 3 });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = [], used = [];
    const want = [];
    Object.keys(spec || {}).forEach(k => { for (let i = 0; i < spec[k]; i++) want.push(k); });
    for (const t of want) {
      const c = cands.find(c2 => !used.some(u => Math.hypot(u.x - c2.x, u.y - c2.y) < 2.5));
      if (!c) break;
      used.push(c);
      cands.splice(cands.indexOf(c), 1);
      out.push({ t, x: c.x, y: c.y });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 7. マップ文字列への書き出し
   * ----------------------------------------------------------------*/
  const ENEMY_CHAR = { grunt: 'g', rusher: 'r', shooter: 's', heavy: 'h', boss: 'B' };

  /**
   * grid + spawn + enemies を '#'/'.'/'P'/'g'… の行配列にする。
   * wallChars: セルごとの壁テクスチャ（省略時はすべて '#'）
   */
  function toMapRows(g, spawn, enemies, wallChars) {
    const rows = [];
    for (let y = 0; y < g.h; y++) {
      let line = '';
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        if (g.grid[i]) line += (wallChars && wallChars[i]) || '#';
        else line += '.';
      }
      rows.push(line);
    }
    const put = (x, y, ch) => {
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
      rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
    };
    if (spawn) put(spawn.x, spawn.y, 'P');
    (enemies || []).forEach(e => put(e.x, e.y, ENEMY_CHAR[e.t] || 'g'));
    return rows;
  }

  /** data.js にそのまま貼れるステージ定義を作る */
  function toStageSource(rows, meta) {
    const m = Object.assign({
      id: 6, name: 'SCANNED SITE', jp: 'スキャン地形',
      objective: 'eliminate', par: 120, reward: 260,
      hpMul: 1.1, dmgMul: 1.0, aiMul: 1.1,
      brief: 'LiDARスキャンから生成された実在の地形。敵を全滅させろ。'
    }, meta || {});
    const theme = m.theme || "{ ceil: '#1e2630', ceil2: '#131a22', floor: '#38424e', floor2: '#20272f', fog: '#2a333e', walls: ['#6f8091', '#59697a', '#7d8f6a', '#8a6a52'] }";
    return [
      '    {',
      `      id: ${m.id}, name: '${m.name}', jp: '${m.jp}',`,
      `      objective: '${m.objective}',${m.target ? ` target: ${m.target},` : ''} par: ${m.par}, reward: ${m.reward},`,
      `      hpMul: ${m.hpMul}, dmgMul: ${m.dmgMul}, aiMul: ${m.aiMul},`,
      `      theme: ${theme},`,
      `      brief: '${m.brief}',`,
      '      map: [',
      rows.map(r => `        '${r}'`).join(',\n'),
      '      ],',
      '      dir: 0',
      '    }'
    ].join('\n');
  }

  /** エンジンが読める形かを検証（test/mapcheck と同じ観点） */
  function validate(rows) {
    const problems = [];
    const w = rows[0].length, h = rows.length;
    rows.forEach((r, i) => { if (r.length !== w) problems.push(`行 ${i} の長さが ${r.length} (期待 ${w})`); });
    for (let x = 0; x < w; x++) {
      if (rows[0][x] !== '#' && rows[0][x] !== '=' && rows[0][x] !== '%' && rows[0][x] !== '*') problems.push(`上端 ${x} 列が開いています`);
      if ('#=%*'.indexOf(rows[h - 1][x]) < 0) problems.push(`下端 ${x} 列が開いています`);
    }
    rows.forEach((r, y) => {
      if ('#=%*'.indexOf(r[0]) < 0) problems.push(`左端 ${y} 行が開いています`);
      if ('#=%*'.indexOf(r[w - 1]) < 0) problems.push(`右端 ${y} 行が開いています`);
    });
    // スポーンと敵、到達性
    let spawn = null;
    const enemies = [];
    const walk = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if ('#=%*'.indexOf(c) >= 0) { walk[y * w + x] = 1; continue; }
      if (c === 'P') spawn = { x, y };
      else if ('grshB'.indexOf(c) >= 0) enemies.push({ x, y, t: c });
    }
    if (!spawn) problems.push('プレイヤー開始地点 P がありません');
    if (!enemies.length) problems.push('敵が1体も配置されていません');
    let reachable = 0;
    if (spawn) {
      const seen = new Uint8Array(w * h);
      const q = [spawn.y * w + spawn.x]; seen[q[0]] = 1;
      for (let k = 0; k < q.length; k++) {
        const c = q[k], cx = c % w, cy = (c / w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (walk[ni] || seen[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      reachable = q.length;
      enemies.forEach(e => { if (!seen[e.y * w + e.x]) problems.push(`敵 (${e.x},${e.y}) に到達できません`); });
      let free = 0;
      for (let i = 0; i < walk.length; i++) if (!walk[i]) free++;
      if (reachable < free) problems.push(`到達できない空間が ${free - reachable} セルあります`);
    }
    return { ok: problems.length === 0, problems, w, h, enemies: enemies.length, reachable };
  }

  /* ------------------------------------------------------------------
   * 8. 画像（間取り図）からのグリッド化 — LiDAR が無い場合の代替
   * ----------------------------------------------------------------*/
  function fromImageData(img, opt) {
    const o = Object.assign({ cols: 28, dark: 110, invert: false }, opt || {});
    const cols = Math.max(6, Math.min(DEFAULTS.maxDim, o.cols));
    const cell = img.width / cols;
    const rows = Math.max(6, Math.min(DEFAULTS.maxDim, Math.round(img.height / cell)));
    const grid = new Uint8Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      let dark = 0, tot = 0;
      const x0 = Math.floor(gx * cell), x1 = Math.min(img.width, Math.ceil((gx + 1) * cell));
      const y0 = Math.floor(gy * cell), y1 = Math.min(img.height, Math.ceil((gy + 1) * cell));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        const a = img.data[i + 3];
        const lum = a < 64 ? 255 : (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114);
        if (o.invert ? lum > o.dark : lum < o.dark) dark++;
        tot++;
      }
      grid[gy * cols + gx] = tot && dark / tot > 0.35 ? 1 : 0;
    }
    return { w: cols, h: rows, grid, cell: 1, source: 'image' };
  }

  return {
    DEFAULTS, ENEMY_CHAR,
    parse, parseOBJ, parsePLY, parseSTL, parseXYZ, densify,
    bounds, detectUpAxis, detectFloor, fitFloorPlane, estimateSpacing, suggestCell,
    gridify, cleanup, despeckle, fillHoles, sealBorder, crop, rotate, flip,
    keepLargestRegion, largestRegion, closeNooks, percentile, clearanceMap, pickSpawn, placeEnemies,
    toMapRows, toStageSource, validate, fromImageData
  };
});
