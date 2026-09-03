/* =========================================================================
 * raster3d.js — 3Dパーツを画面へ塗るための小さなソフトウェアラスタライザ。
 *
 * WebGL へ載せ替えると、壁のZバッファ・視線判定・当たり判定まで作り直しに
 * なるため、既存のレイキャスティング描画の中で完結する方式にしている。
 * ・角柱（N角形の断面を持つ筒）を三角形へ分解して塗る
 * ・パーツ同士の前後は 1/z のZバッファで解決する（自己遮蔽が正しく出る）
 * ・壁との前後は既存の列Zバッファ（Render.zbuf）側で切り取る
 * ======================================================================= */
(function (g) {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  const R3 = {
    W: 0, H: 0,                 // いま使っているバッファの大きさ
    maxW: 0, maxH: 0,
    img: null, px: null, dep: null, cvs: null, cctx: null,
    tris: 0, parts: 0,          // 統計（性能計測用）

    /** バッファを用意して塗り潰しをクリアする */
    begin(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w > this.maxW || h > this.maxH) {
        this.maxW = Math.max(w, this.maxW, 64);
        this.maxH = Math.max(h, this.maxH, 64);
        this.img = new ImageData(this.maxW, this.maxH);
        this.px = new Uint32Array(this.img.data.buffer);
        this.dep = new Float32Array(this.maxW * this.maxH);
        this.cvs = document.createElement('canvas');
        this.cvs.width = this.maxW; this.cvs.height = this.maxH;
        this.cctx = this.cvs.getContext('2d');
        this.cctx.imageSmoothingEnabled = false;
      }
      this.W = w; this.H = h;
      const px = this.px, dep = this.dep, stride = this.maxW;
      for (let y = 0; y < h; y++) {
        const o = y * stride;
        px.fill(0, o, o + w);
        dep.fill(0, o, o + w);
      }
      return this;
    },

    /**
     * 三角形を塗る。頂点は [sx, sy, invZ]（invZ が大きいほど手前）。
     * 走査線ごとに x と invZ を線形補間する（画面空間で 1/z は線形なので正しい）。
     */
    tri(a, b, c, col) {
      let v0 = a, v1 = b, v2 = c, t;
      if (v0[1] > v1[1]) { t = v0; v0 = v1; v1 = t; }
      if (v1[1] > v2[1]) { t = v1; v1 = v2; v2 = t; }
      if (v0[1] > v1[1]) { t = v0; v0 = v1; v1 = t; }
      const y0 = Math.ceil(v0[1] - 0.5), y2 = Math.ceil(v2[1] - 0.5);
      if (y2 <= 0 || y0 >= this.H) return;
      const yStart = Math.max(0, y0), yEnd = Math.min(this.H - 1, y2 - 1);
      if (yEnd < yStart) return;
      this.tris++;

      const px = this.px, dep = this.dep, stride = this.maxW, W = this.W;
      const dy02 = (v2[1] - v0[1]) || 1e-6;
      const dy01 = (v1[1] - v0[1]) || 1e-6;
      const dy12 = (v2[1] - v1[1]) || 1e-6;

      for (let y = yStart; y <= yEnd; y++) {
        const yc = y + 0.5;
        const t02 = clamp((yc - v0[1]) / dy02, 0, 1);
        let xa = v0[0] + (v2[0] - v0[0]) * t02;
        let wa = v0[2] + (v2[2] - v0[2]) * t02;
        let xb, wb;
        if (yc < v1[1]) {
          const t01 = clamp((yc - v0[1]) / dy01, 0, 1);
          xb = v0[0] + (v1[0] - v0[0]) * t01;
          wb = v0[2] + (v1[2] - v0[2]) * t01;
        } else {
          const t12 = clamp((yc - v1[1]) / dy12, 0, 1);
          xb = v1[0] + (v2[0] - v1[0]) * t12;
          wb = v1[2] + (v2[2] - v1[2]) * t12;
        }
        if (xa > xb) { let s = xa; xa = xb; xb = s; s = wa; wa = wb; wb = s; }
        let x0 = Math.ceil(xa - 0.5), x1 = Math.ceil(xb - 0.5) - 1;
        if (x1 < 0 || x0 >= W) continue;
        const span = (xb - xa) || 1e-6;
        const dw = (wb - wa) / span;
        if (x0 < 0) x0 = 0;
        if (x1 > W - 1) x1 = W - 1;
        let w = wa + (x0 + 0.5 - xa) * dw;
        let o = y * stride + x0;
        for (let x = x0; x <= x1; x++, o++, w += dw) {
          if (w > dep[o]) { dep[o] = w; px[o] = col; }
        }
      }
    },

    /** 四角形（凸）を2枚の三角形で塗る */
    quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); },

    /** 使った範囲だけを canvas へ移す */
    flush() {
      this.cctx.putImageData(this.img, 0, 0, 0, 0, this.W, this.H);
      return this.cvs;
    }
  };

  /* =======================================================================
   * 色のユーティリティ（ライティング結果を 32bit ABGR へ）
   * ===================================================================== */
  const _hexCache = {};
  function hexRGB(hex) {
    let v = _hexCache[hex];
    if (v) return v;
    let h = hex;
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16) || 0;
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    _hexCache[hex] = v;
    return v;
  }
  /** 明るさ lum と、距離フォグ fogK（0=素の色, 1=完全にフォグ色）で色を作る */
  function shade32(rgb, lum, fog, fogRGB) {
    let r = rgb[0] * lum, gg = rgb[1] * lum, b = rgb[2] * lum;
    if (fog > 0) {
      r += (fogRGB[0] - r) * fog; gg += (fogRGB[1] - gg) * fog; b += (fogRGB[2] - b) * fog;
    }
    return 0xff000000 | ((b < 0 ? 0 : b > 255 ? 255 : b | 0) << 16) |
      ((gg < 0 ? 0 : gg > 255 ? 255 : gg | 0) << 8) | (r < 0 ? 0 : r > 255 ? 255 : r | 0);
  }

  /* =======================================================================
   * 角柱の生成
   *  a→b を軸に、断面 (r0 → r1) の N角形を並べる。
   *  断面の向きは「軸に使っていない2軸」を使うので、足や頭も意図通りになる。
   * ===================================================================== */
  const RING = {};              // sides -> [cos, sin, ...]
  function ring(n) {
    let r = RING[n];
    if (r) return r;
    r = new Float32Array(n * 2);
    // 4角形が軸に揃うように 45° ずらす
    const ph = (n === 4) ? Math.PI / 4 : (n === 8 ? Math.PI / 8 : 0);
    for (let i = 0; i < n; i++) {
      const a = ph + i / n * Math.PI * 2;
      r[i * 2] = Math.cos(a); r[i * 2 + 1] = Math.sin(a);
    }
    RING[n] = r;
    return r;
  }

  /** 軸方向から、断面に使う2軸（0=X,1=Y,2=Z）を選ぶ */
  function crossAxes(dx, dy, dz) {
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (az >= ax && az >= ay) return [0, 1];   // 縦に伸びる → X(前後), Y(左右)
    if (ax >= ay) return [2, 1];               // 前に伸びる → Z(上下), Y(左右)
    return [0, 2];                             // 横に伸びる → X, Z
  }

  g.Raster3D = { R3, hexRGB, shade32, ring, crossAxes, clamp };
})(window);
