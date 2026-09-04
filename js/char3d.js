/* =========================================================================
 * char3d.js — 3Dキャラクターを既存のレイキャスティング画面へ描く。
 *
 *   Model3D（骨格・ポーズ）+ Raster3D（塗り）+ Render.cam（カメラ）を束ねる。
 *   板ポリの代わりに角柱の集合を毎フレーム姿勢計算して投影するので、
 *   横から見れば厚みがあり、光の当たる面と陰になる面ができる。
 * ======================================================================= */
(function (g) {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  /* ---- 使い回すバッファ（毎フレームの確保を避ける） ---- */
  const MAXV = 4096;
  const _cx = new Float32Array(MAXV), _cy = new Float32Array(MAXV), _cz = new Float32Array(MAXV);
  const _sx = new Float32Array(MAXV), _sy = new Float32Array(MAXV), _sw = new Float32Array(MAXV);
  const _nx = new Float32Array(MAXV), _ny = new Float32Array(MAXV), _nz = new Float32Array(MAXV);
  const _ok = new Uint8Array(MAXV);
  const _lm = new Float32Array(MAXV);          // 頂点ごとの明るさ（0..1）
  const _v0 = [0, 0, 0], _v1 = [0, 0, 0], _v2 = [0, 0, 0];
  const _pa = [0, 0, 0, 0], _pb = [0, 0, 0, 0], _pc = [0, 0, 0, 0], _pd = [0, 0, 0, 0];
  // パーツごとの頂点開始位置（毎フレームの配列確保を避けるため型付き配列で持つ）
  const MAXP = 96;
  const _pBase = new Int32Array(MAXP), _pIdx = new Int32Array(MAXP);
  const _pRings = new Int32Array(MAXP);
  const _pCapA = new Float32Array(MAXP), _pCapB = new Float32Array(MAXP);
  const _lutTable = [];

  const partCache = {};        // "defKey:lod" -> parts
  const skelVM = {};           // 一人称ビューモデル用の骨（視点空間）
  const poseBox = Model3D.newPose();
  const skel = {};

  const Char3D = {
    enabled: true,
    /** 太陽の向き（世界座標。上からやや前方） */
    light: [0.38, 0.30, 0.87],
    ambient: 0.52,
    diffuse: 0.62,
    rim: 0.10,
    /** 描画統計（性能テスト用） */
    stats: { drawn: 0, tris: 0, faces: 0, lod: [0, 0, 0, 0] },

    /** キャラの3D状態（定義とポーズ）を用意する。既存オブジェクトには触れない */
    stateFor(c) {
      let m = c._m3;
      if (!m) {
        const pal = (c.def && c.def.palette) || {};
        const def = Model3D.defineCharacter(c.id || c.name || 'x', pal, c.isPlayer ? { helmet: 2, vest: 1, backpack: 1 } : null);
        m = c._m3 = {
          def,
          colors: this.paletteFor(def, pal),
          key: (c.type || 'c') + ':' + (def.helmet) + (def.vest) + (def.backpack) + (def.hair),
          t: Math.random() * 10
        };
      }
      return m;
    },

    paletteFor(def, pal) {
      const S = window.Sprites;
      const main = pal.main || '#8ea0b0';
      const sec = pal.sec || S.shade(main, -30);
      const gc = def.gearColor || '#3a424b';
      return {
        main: main,
        pants: def.pants || S.shade(sec, -18),
        skin: def.skin,
        hair: def.hairColor,
        boot: '#2b3138',
        gear: gc,
        gear2: S.shade(gc, -18),
        visor: pal.visor || '#dff6ff',
        weapon: '#4a525c',
        weapon2: '#2b3138',
        glove: '#333b44',
        sleeve: S.shade(gc, 8),
        eye: '#20262e',
        mouth: '#8f5a52',
        sole: '#20242a'
      };
    },

    /**
     * 頂点1つぶんの明るさ（0..1）。
     *   ・拡散光（平行光源）
     *   ・空からの環境光。上を向いた面ほど明るく、下向きは暗い＝簡易AO
     *   ・材質ごとのハイライト
     * を合わせて 0..1 に収める。実際の色は材質ごとの色見本(LUT)が持つ。
     */
    lightVertex(nx, ny, nz, lx, ly, lz, hx, hy, hz, mt, ao) {
      const ndl = nx * lx + ny * ly + nz * lz;
      const sky = 0.55 + 0.45 * (nz * 0.5 + 0.5);          // 下向きの面を締める
      let l = 0.30 * sky * ao + (ndl > 0 ? ndl * 0.62 * ao : ndl * 0.06);
      if (mt.spec > 0.02) {
        const nh = nx * hx + ny * hy + nz * hz;
        if (nh > 0) {
          const n2 = nh * nh, n4 = n2 * n2, n8 = n4 * n4;
          const sp = mt.shin === 0 ? n8 : (mt.shin === 1 ? n8 * n8 : (n8 * n8) * (n8 * n8));
          l += sp * mt.spec * 0.55;
        }
      }
      return l < 0 ? 0 : (l > 1 ? 1 : l);
    },

    /** 被弾フラッシュ用に色見本を作り替える（1フレームぶんだけ持つ） */
    tintLut(lut, tint) {
      const key = tint.k.toFixed(2) + ':' + tint.rgb.join(',');
      let map = this._tintCache;
      if (!map || map.key !== key) map = this._tintCache = { key, m: new Map() };
      let out = map.m.get(lut);
      if (!out) { out = Raster3D.lutTint(lut, tint.rgb, tint.k); map.m.set(lut, out); }
      return out;
    },

    /** 距離と描画品質から詳細度を決める（§25 Bot LOD） */
    lodFor(depth, quality) {
      const k = quality === 'LOW' ? 0.55 : (quality === 'MID' ? 0.8 : 1);
      if (depth < 7.5 * k) return 0;
      if (depth < 17 * k) return 1;
      if (depth < 30 * k) return 2;
      return 3;                        // 3 = 3Dをやめて従来のビルボード
    },

    /** 体 + 装備 + 手に持った武器 をまとめた描画パーツ一覧（組み合わせごとにキャッシュ） */
    parts(m, lod, wcls) {
      const key = m.key + ':' + lod + ':' + (wcls || '-');
      let p = partCache[key];
      if (!p) {
        p = Model3D.buildParts(m.def, lod);
        if (wcls) p = p.concat(Model3D.weaponParts(wcls, 'weapon').parts);
        partCache[key] = p;
      }
      return p;
    },

    /** いま構えている武器のクラス（無ければ null） */
    weaponClass(c) {
      // 倒れた相手は武器を地面に落としている（dropLoot）ので手には持たせない
      if (!c.alive || c.state === 'dead') return null;
      const w = c.weapons ? c.weapons[c.wIdx] : c.weapon;
      if (!w) return null;
      const d = w.def || w;
      return d.cls || 'AR';
    },

    /**
     * キャラクター1体を描く。
     * @returns {null | {x0,x1,yTop,yBot}} 画面上の占有範囲（描けなかったら null）
     */
    draw(R, c, proj, opt) {
      const cam = R.cam, W = R.W, H = R.H;
      const o = opt || {};
      const m = this.stateFor(c);
      const lod = o.lod != null ? o.lod : this.lodFor(proj.depth, R.quality);
      if (lod >= 3) return null;

      const wcls = o.weaponClass !== undefined ? o.weaponClass : this.weaponClass(c);
      const parts = this.parts(m, lod, lod <= 1 ? wcls : (wcls ? 'AR' : null));
      const hW = (c.def ? c.def.height : 0.95) * 1.06 * m.def.height;
      const build = m.def.build;

      /* --- 1. ポーズ --- */
      const aiming = o.aiming != null ? o.aiming : this.isAiming(c);
      // 空中→接地 の瞬間を覚えておき、しばらく膝を曲げさせる
      if (m.lastState !== c.state) {
        if (c.state === 'ground' && m.lastState === 'drop') m.landAt = c.animT || 0;
        m.lastState = c.state;
      }
      const landK = m.landAt != null
        ? clamp(1 - ((c.animT || 0) - m.landAt) / 0.5, 0, 1) : 0;
      const P = Model3D.animate(poseBox, c, (c.animT || 0) + m.t, { aiming, armed: !!wcls, landK });
      const sk = Model3D.solve(P, build, 1, skel);
      if (wcls) Model3D.poseWeapon(sk, this.holdOpts(c, aiming, false));
      skel._owner = c;            // 銃口の位置を後から引けるように、誰の姿勢かを覚える

      /* --- 2. 光をキャラ空間へ回す（面ごとに回さないで済むように） --- */
      const ang = c.ang || 0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const L = this.light;
      const lx = L[0] * ca + L[1] * sa, ly = L[0] * sa - L[1] * ca, lz = L[2];

      /* --- 3. 頂点を作って投影する --- */
      const fogRGB = this._fogRGB(R);
      const fogQ = clamp((proj.depth - 7) / 30, 0, R.floorGrid ? 0.42 : 0.55);
      const det = cam.planeX * cam.dirY - cam.dirX * cam.planeY;
      if (!det) return null;
      const inv = 1 / det;
      const halfW = W / 2, horizon = cam.horizon, D = cam.D, eyeZ = cam.eyeZ;
      const RG = Raster3D;

      let n = 0, np = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      _lutTable.length = 0;

      // 視線方向（キャラ空間）とハーフベクトル。ハイライトに使う
      const vdx0 = cam.x - c.x, vdy0 = cam.y - c.y;
      const vl = Math.hypot(vdx0, vdy0) || 1;
      const vx = (vdx0 * ca + vdy0 * sa) / vl, vy = (vdx0 * sa - vdy0 * ca) / vl, vz = 0.30;
      let hx = lx + vx, hy = ly + vy, hz = lz + vz;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl; hy /= hl; hz /= hl;

      for (let pi = 0; pi < parts.length && np < MAXP; pi++) {
        const pt = parts[pi];
        const b = sk[pt.bone];
        if (!b) continue;
        const sides = pt.sides;
        const rg = RG.ring(sides);
        const a = pt.a, bb = pt.b;
        const dx = bb[0] - a[0], dy = bb[1] - a[1], dz = bb[2] - a[2];
        const alen = Math.hypot(dx, dy, dz) || 1e-5;
        const adx = dx / alen, ady = dy / alen, adz = dz / alen;
        const ax = RG.crossAxes(dx, dy, dz);
        const prof = pt.prof;
        const K = prof ? prof.length : 2;
        const base = n;
        if (n + sides * K > MAXV) break;

        const e1 = [0, 0, 0], e2 = [0, 0, 0];
        e1[ax[0]] = 1; e2[ax[1]] = 1;

        const mt = RG.MAT[pt.mat] || RG.MAT.cloth;
        const aoK = pt.ao != null ? pt.ao : 1;
        const nrm = b.m;

        for (let k = 0; k < K; k++) {
          const t = prof ? prof[k][0] : k;
          const ps = prof ? prof[k][1] : 1, pd = prof ? prof[k][2] : 1;
          const cxl = a[0] + dx * t, cyl = a[1] + dy * t, czl = a[2] + dz * t;
          const ra = (pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t) * ps;
          const rb = (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t) * pd;
          // 輪郭の傾き。これを法線に混ぜると、丸みが陰影として出る
          let slope = 0;
          if (K > 2) {
            const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
            const t0 = prof[k0][0], t1 = prof[k1][0];
            const r0m = ((pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t0) * prof[k0][1]
              + (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t0) * prof[k0][2]) * 0.5;
            const r1m = ((pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t1) * prof[k1][1]
              + (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t1) * prof[k1][2]) * 0.5;
            slope = (r1m - r0m) / (Math.max(1e-4, (t1 - t0)) * alen);
          }
          for (let i = 0; i < sides; i++) {
            const co = rg[i * 2], si = rg[i * 2 + 1];
            _v0[0] = cxl + e1[0] * ra * co + e2[0] * rb * si;
            _v0[1] = cyl + e1[1] * ra * co + e2[1] * rb * si;
            _v0[2] = czl + e1[2] * ra * co + e2[2] * rb * si;
            Model3D.boneToChar(sk, pt.bone, _v0, build, 1, _v1);
            const idx = base + k * sides + i;
            _cx[idx] = _v1[0]; _cy[idx] = _v1[1]; _cz[idx] = _v1[2];
            // 断面の外向き（楕円なので半径で割る）に、輪郭の傾きを足す
            const un0 = co / (ra || 1e-4), un1 = si / (rb || 1e-4);
            let lnx = e1[0] * un0 + e2[0] * un1 - adx * slope * 0;
            let lny = e1[1] * un0 + e2[1] * un1;
            let lnz = e1[2] * un0 + e2[2] * un1;
            let ll = Math.hypot(lnx, lny, lnz) || 1;
            lnx = lnx / ll - adx * slope; lny = lny / ll - ady * slope; lnz = lnz / ll - adz * slope;
            ll = Math.hypot(lnx, lny, lnz) || 1;
            lnx /= ll; lny /= ll; lnz /= ll;
            const wnx = nrm[0] * lnx + nrm[1] * lny + nrm[2] * lnz;
            const wny = nrm[3] * lnx + nrm[4] * lny + nrm[5] * lnz;
            const wnz = nrm[6] * lnx + nrm[7] * lny + nrm[8] * lnz;
            _nx[idx] = wnx; _ny[idx] = wny; _nz[idx] = wnz;
            _lm[idx] = this.lightVertex(wnx, wny, wnz, lx, ly, lz, hx, hy, hz, mt, aoK);
          }
        }
        n = base + sides * K;
        // 蓋（平面）の明るさは軸方向の法線で1回だけ求める
        const cnx = nrm[0] * adx + nrm[1] * ady + nrm[2] * adz;
        const cny = nrm[3] * adx + nrm[4] * ady + nrm[5] * adz;
        const cnz = nrm[6] * adx + nrm[7] * ady + nrm[8] * adz;
        _pCapA[np] = this.lightVertex(-cnx, -cny, -cnz, lx, ly, lz, hx, hy, hz, mt, aoK);
        _pCapB[np] = this.lightVertex(cnx, cny, cnz, lx, ly, lz, hx, hy, hz, mt, aoK);
        _pBase[np] = base; _pIdx[np] = pi; _pRings[np] = K;
        _lutTable.push(RG.lutFor(m.colors[pt.col] || m.colors.main, pt.mat, fogQ, fogRGB));
        np++;
      }

      /* --- 投影 --- */
      for (let i = 0; i < n; i++) {
        const px = _cx[i] * hW, py = _cy[i] * hW, pz = _cz[i] * hW;
        // キャラ空間 +Y は「本人から見て左」。この描画系では世界 +Y がカメラの
        // 右手側になるので、左右が鏡にならないよう Y を反転して世界へ移す。
        const wx = c.x + px * ca + py * sa;
        const wy = c.y + px * sa - py * ca;
        const rx = wx - cam.x, ry = wy - cam.y;
        const ty = inv * (-cam.planeY * rx + cam.planeX * ry);
        if (ty <= 0.06) { _ok[i] = 0; continue; }
        const tx = inv * (cam.dirY * rx - cam.dirX * ry);
        const X = halfW * (1 + tx / ty);
        const Y = horizon + (eyeZ - pz) * (D / ty);
        _sx[i] = X; _sy[i] = Y; _sw[i] = 1 / ty; _ok[i] = 1;
        if (X < minX) minX = X; if (X > maxX) maxX = X;
        if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      }
      if (minX > maxX) return null;
      if (maxX < -4 || minX > W + 4 || maxY < -4 || minY > H + 4) return null;

      /* --- 4. ラスタライズ --- */
      const pad = 1;
      let bx = Math.floor(minX) - pad, by = Math.floor(minY) - pad;
      let bw = Math.ceil(maxX) - bx + pad * 2, bh = Math.ceil(maxY) - by + pad * 2;
      // 近すぎる相手でコストが跳ねないよう、内部解像度に上限を設ける。
      // 近距離は上限を上げてジャギを減らす（遠いほど粗くてよい）
      const CAP = lod === 0 ? 216 : (lod === 1 ? 150 : 100);
      let ds = 1;
      if (bw > CAP || bh > CAP) ds = Math.min(CAP / bw, CAP / bh);
      const rw = Math.max(1, Math.round(bw * ds)), rh = Math.max(1, Math.round(bh * ds));
      const RB = Raster3D.R3;
      RB.begin(rw, rh);
      const t0 = RB.tris;

      const tint = o.tint || null;

      let faceN = 0;
      // スムースシェーディング。頂点ごとの明るさを補間して材質の色見本を引く
      const emit = (i0, i1, i2, i3, lut, la, lb2, lc, ld) => {
        if (!_ok[i0] || !_ok[i1] || !_ok[i2] || (i3 >= 0 && !_ok[i3])) return;
        const x0 = (_sx[i0] - bx) * ds, y0 = (_sy[i0] - by) * ds;
        const x1 = (_sx[i1] - bx) * ds, y1 = (_sy[i1] - by) * ds;
        const x2 = (_sx[i2] - bx) * ds, y2 = (_sy[i2] - by) * ds;
        if ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) <= 0) return;   // 裏面
        faceN++;
        _pa[0] = x0; _pa[1] = y0; _pa[2] = _sw[i0]; _pa[3] = la;
        _pb[0] = x1; _pb[1] = y1; _pb[2] = _sw[i1]; _pb[3] = lb2;
        _pc[0] = x2; _pc[1] = y2; _pc[2] = _sw[i2]; _pc[3] = lc;
        if (i3 >= 0) {
          _pd[0] = (_sx[i3] - bx) * ds; _pd[1] = (_sy[i3] - by) * ds; _pd[2] = _sw[i3]; _pd[3] = ld;
          RB.quadS(_pa, _pb, _pc, _pd, lut);
        } else RB.triS(_pa, _pb, _pc, lut);
      };

      for (let k = 0; k < np; k++) {
        const pt = parts[_pIdx[k]];
        const sides = pt.sides, base = _pBase[k], K = _pRings[k];
        let lut = _lutTable[k];
        if (tint) lut = this.tintLut(lut, tint);
        for (let r = 0; r < K - 1; r++) {
          const o0 = base + r * sides, o1 = base + (r + 1) * sides;
          for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            emit(o0 + i, o0 + j, o1 + j, o1 + i, lut, _lm[o0 + i], _lm[o0 + j], _lm[o1 + j], _lm[o1 + i]);
          }
        }
        // 蓋（両端）。平面なので明るさは一定
        const la = _pCapA[k], lb2 = _pCapB[k];
        const top = base + (K - 1) * sides;
        for (let i = 1; i < sides - 1; i++) {
          emit(base, base + i, base + i + 1, -1, lut, la, la, la, la);
          emit(top, top + i + 1, top + i, -1, lut, lb2, lb2, lb2, lb2);
        }
      }

      this.stats.drawn++;
      this.stats.faces += faceN;
      this.stats.tris += RB.tris - t0;
      this.stats.lod[lod]++;

      /* --- 5. 壁の手前だけを画面へ --- */
      const cvs = RB.flush();
      const ctx = R.ctx;
      const segs = R._occlVisible(bx, bx + bw, proj.depth);
      if (!segs.length) return null;
      let alpha = 1;
      if (c.state === 'dead') alpha = clamp(1 - ((c.deadT || 0) - 2.2) / 1.0, 0, 1);
      if (alpha <= 0.01) return null;
      ctx.globalAlpha = alpha;
      // 壁で細かく分断されるとdrawImageの回数が跳ね上がるので、
      // 分割数が多いときはクリップ領域を1つ作って1回で描く。
      if (segs.length > 4) {
        ctx.save();
        ctx.beginPath();
        for (let s = 0; s < segs.length; s++) ctx.rect(segs[s][0], by, segs[s][1], bh);
        ctx.clip();
        ctx.drawImage(cvs, 0, 0, rw, rh, bx, by, bw, bh);
        ctx.restore();
      } else {
        for (let s = 0; s < segs.length; s++) {
          let sx0 = Math.max(segs[s][0], bx), sx1 = Math.min(segs[s][0] + segs[s][1], bx + bw);
          if (sx1 - sx0 <= 0) continue;
          const u0 = (sx0 - bx) * ds, u1 = (sx1 - bx) * ds;
          ctx.drawImage(cvs, u0, 0, Math.max(0.01, u1 - u0), rh, sx0, by, sx1 - sx0, bh);
        }
      }
      ctx.globalAlpha = 1;
      return { x0: minX, x1: maxX, yTop: minY, yBot: maxY };
    },

    /** 武器の構え方（位置・向き）を状態から決める */
    holdOpts(c, aiming, fp) {
      const rl = (c.reloading && c.reloadTotal)
        ? Math.sin(clamp(1 - c.reloadLeft / c.reloadTotal, 0, 1) * Math.PI) : 0;
      const sw = (c.switchT > 0 && c.switchTotal)
        ? Math.sin(clamp(c.switchT / c.switchTotal, 0, 1) * Math.PI) : 0;
      return {
        aim: fp ? 1 : (aiming ? 1 : 0.25),
        recoil: clamp((c.atkFlash || 0) / 0.18, 0, 1),
        reloadK: rl,
        lower: fp ? 0 : clamp((c.sprinting && !aiming ? 0.85 : 0) + sw, 0, 1),
        cantYaw: fp ? this.vmCantY : 0,
        cantPitch: fp ? this.vmCantP : 0,
        fp: !!fp
      };
    },

    /** 構えているか（見た目だけの判定。ゲーム側の状態は変えない） */
    isAiming(c) {
      if (c.isPlayer) return !!(window.Input && Input.ads);
      const b = c.bot;
      if (!b) return false;
      return b.state === 'COMBAT' || b.state === 'TAKING_COVER' || b.state === 'ENDGAME';
    },

    /** 銃口の世界座標（マズルフラッシュ用）。直前の draw のポーズを使う */
    muzzleWorld(c, out) {
      const wcls = this.weaponClass(c);
      if (!wcls) return null;
      const m = c._m3;
      if (!m) return null;
      // 直前に解いた姿勢が別のキャラのものなら、この場で解き直す
      if (skel._owner !== c) {
        const aiming = this.isAiming(c);
        const P = Model3D.animate(poseBox, c, (c.animT || 0) + m.t, { aiming, armed: true });
        Model3D.solve(P, m.def.build, 1, skel);
        Model3D.poseWeapon(skel, this.holdOpts(c, aiming, false));
        skel._owner = c;
      }
      if (!skel.weapon) return null;
      const mz = Model3D.weaponParts(wcls, 'weapon').muzzle;
      Model3D.boneToChar(skel, 'weapon', mz, 1, 1, _v2);
      const hW = (c.def ? c.def.height : 0.95) * 1.06 * m.def.height;
      const ang = c.ang || 0, ca = Math.cos(ang), sa = Math.sin(ang);
      const px = _v2[0] * hW, py = _v2[1] * hW;
      out = out || [0, 0, 0];
      out[0] = c.x + px * ca - py * sa;
      out[1] = c.y + px * sa + py * ca;
      out[2] = _v2[2] * hW;
      return out;
    },

    /* =====================================================================
     * 一人称の腕と武器（View Model）
     *   三人称と同じ骨格・同じアニメーションを使い、カメラを本人の目の位置に
     *   置いて「肘から先と武器」だけを描く。だから画面下の腕と、他人から見た
     *   自分の腕は必ず同じ動きになる。
     * =================================================================== */
    // 一人称で見えるのは「手首から先＋武器」。肘まで描くとカメラに近すぎて
    // 前腕が画面を覆ってしまうため、専用の短いパーツを使う。
    VM_BONES: { armLL: 1, handL: 1, armRL: 1, handR: 1, weapon: 1 },

    /** 一人称用の組物（武器＋両手＋袖）。武器クラスごとに1度だけ作る */
    vmSet(wcls) {
      const key = 'vm:' + wcls;
      let v = partCache[key];
      if (!v) v = partCache[key] = Model3D.vmParts(wcls);
      return v;
    },
    // 一人称の腕は目の真横から生えているので、そのまま映すと画面いっぱいになる。
    // FPSの慣習どおり、少し前へ押し出して専用の画角で描く。
    // 一人称の武器は目のすぐ横にあるため、そのまま広角で映すと極端に歪む。
    // FPSの慣習どおり「専用の狭い画角 + 前方へ押し出し」で描く。
    // 視点空間での武器の置き場所（前 / 右 / 下）と画角、傾き
    vmPush: 1.05, vmDrop: -0.135, vmSide: 0.230, vmFov: 1.05, vmAdsX: -0.45, vmAdsZ: 0.091,
    vmCantY: -0.52, vmCantP: 0.20,
    _vmCal: null,

    /**
     * 一人称の向き合わせ。構えのポーズで銃口が向いている方向を実際に測り、
     * それが画面の正面（+X）に来る回転を1度だけ求めて使い回す。
     * こうしておくと、ポーズを調整しても銃口は必ず照準の先を向く。
     */
    vmCalibration() {
      if (this._vmCal) return this._vmCal;
      const dummy = {
        alive: true, state: 'ground', stance: 'stand', animT: 0,
        weapons: [{}], wIdx: 0, moving: false, hurtT: 0, atkFlash: 0, switchT: 0
      };
      const P = Model3D.animate(Model3D.newPose(), dummy, 0, { aiming: true, armed: true });
      P._root.yaw = 0; P._root.lean *= 0.35; P._root.roll = 0;
      P.chest.rz = 0; P.chest.ry *= 0.4; P.head.rz = 0;
      const tR = P.armRU.ry + P.armRL.ry, tL = P.armLU.ry + P.armLL.ry;
      P.armRU.ry = -0.26; P.armRL.ry = tR + 0.26;
      P.armLU.ry = -0.26; P.armLL.ry = tL + 0.26;
      // 肘を画面の下へ落とす。上腕と前腕の合計は変えないので、
      // 手（＝銃）の向きはそのままに、腕だけが画面下から伸びる形になる。
      const totR = P.armRU.ry + P.armRL.ry, totL = P.armLU.ry + P.armLL.ry;
      P.armRU.ry = -0.26; P.armRL.ry = totR + 0.26;
      P.armLU.ry = -0.26; P.armLL.ry = totL + 0.26;
      const sk2 = Model3D.solve(P, 1, 1, {});
      const m = sk2.handR.m;
      const dx = -m[2], dy = -m[5], dz = -m[8];      // 手のローカル -Z = 銃口方向
      this._vmCal = {
        yaw: -Math.atan2(dy, dx),
        pitch: Math.atan2(dz, Math.hypot(dx, dy))
      };
      return this._vmCal;
    },

    drawViewModel(R, game) {
      const p = game.player;
      if (!p) return false;
      const wcls = this.weaponClass(p);
      if (!wcls) return false;
      const m = this.stateFor(p);
      const cam = R.cam, W = R.W, H = R.H;
      const set = this.vmSet(wcls);
      const parts = set.parts;

      /* --- 武器の置き場所（視点空間: +X 前 / +Y 左 / +Z 上） --- */
      const ads = game.zoomT || 0;
      const bob = p.bobPhase || 0, amp = p.bobAmp || 0;
      const rec = p.recoilVis || 0;
      let dip = 0, roll = 0, rl = 0;
      if (p.reloading && p.reloadTotal) {
        rl = Math.sin(clamp(1 - p.reloadLeft / p.reloadTotal, 0, 1) * Math.PI);
        dip += rl * 0.075; roll += rl * 0.55;
      }
      if (p.switchT > 0 && p.switchTotal) {
        const k = Math.sin(clamp(p.switchT / p.switchTotal, 0, 1) * Math.PI);
        dip = Math.max(dip, k * 0.10); roll = Math.max(roll, k * 0.45);
      }
      // ADSでは銃を奥へ引いて小さく見せる（照準の邪魔をしないため）
      const ox = this.vmPush + ads * this.vmAdsX - rec * 0.012 - dip * 0.15;
      const oy = -this.vmSide * (1 - ads) + Math.sin(bob) * 0.020 * amp * (1 - ads * 0.7);
      const oz = this.vmDrop + ads * this.vmAdsZ
        - Math.abs(Math.cos(bob)) * 0.016 * amp - dip - rec * 0.011;

      // 向き: 少し傾けて銃の側面を見せる（ADSでは正面へ戻す）
      // ADSでも少しだけ傾けたままにする。完全に正面を向けると銃を真後ろから
      // 見ることになり、袖がカメラへ向かって伸びて画面を覆ってしまう。
      const cy2 = this.vmCantY * (1 - ads * 0.55), cp2 = this.vmCantP * (1 - ads * 0.55) - rec * 0.10;
      const hideArms = ads > 0.5;
      _v0[0] = Math.cos(cy2) * Math.cos(cp2);
      _v0[1] = Math.sin(cy2) * Math.cos(cp2);
      _v0[2] = Math.sin(cp2);
      const vm = skelVM.vm || (skelVM.vm = { m: new Float32Array(9), o: new Float32Array(3) });
      _v1[0] = -Math.sin(roll * 0.6); _v1[1] = 0; _v1[2] = Math.cos(roll * 0.6);   // ロールの基準上向き
      Model3D.aimMatrix(_v0, _v1, vm.m);
      vm.o[0] = ox; vm.o[1] = oy; vm.o[2] = oz;

      const D = cam.D * this.vmFov, halfW = W / 2, midY = H / 2;
      const NEAR = 0.05;
      const RG = Raster3D;
      // 一人称は自分の武器がよく見えるよう、少し正面寄りから照らす
      const lx = 0.34, ly = 0.50, lz = 0.79;
      let hx = lx + 1, hy = ly, hz = lz + 0.2;
      const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;

      let n = 0, np = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      _lutTable.length = 0;

      for (let pi = 0; pi < parts.length && np < MAXP; pi++) {
        const pt = parts[pi];
        if (hideArms && pt.col === 'sleeve') continue;   // 覗いている間は袖を出さない
        const sides = pt.sides;
        const rg = RG.ring(sides);
        const a = pt.a, bb = pt.b;
        const dx = bb[0] - a[0], dy = bb[1] - a[1], dz = bb[2] - a[2];
        const alen = Math.hypot(dx, dy, dz) || 1e-5;
        const adx = dx / alen, ady = dy / alen, adz = dz / alen;
        const ax = RG.crossAxes(dx, dy, dz);
        const prof = pt.prof;
        const K = prof ? prof.length : 2;
        const base = n;
        if (n + sides * K > MAXV) break;
        const e1 = [0, 0, 0], e2 = [0, 0, 0];
        e1[ax[0]] = 1; e2[ax[1]] = 1;
        const mt = RG.MAT[pt.mat] || RG.MAT.cloth;
        const aoK = pt.ao != null ? pt.ao : 1;
        const nm = vm.m;
        let bad = false;

        for (let k = 0; k < K && !bad; k++) {
          const t = prof ? prof[k][0] : k;
          const ps = prof ? prof[k][1] : 1, pd = prof ? prof[k][2] : 1;
          const cxl = a[0] + dx * t, cyl = a[1] + dy * t, czl = a[2] + dz * t;
          const ra = (pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t) * ps;
          const rb = (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t) * pd;
          let slope = 0;
          if (K > 2) {
            const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
            const t0 = prof[k0][0], t1 = prof[k1][0];
            const r0m = ((pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t0) * prof[k0][1]
              + (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t0) * prof[k0][2]) * 0.5;
            const r1m = ((pt.r0[0] + (pt.r1[0] - pt.r0[0]) * t1) * prof[k1][1]
              + (pt.r0[1] + (pt.r1[1] - pt.r0[1]) * t1) * prof[k1][2]) * 0.5;
            slope = (r1m - r0m) / (Math.max(1e-4, (t1 - t0)) * alen);
          }
          for (let i = 0; i < sides; i++) {
            const co = rg[i * 2], si = rg[i * 2 + 1];
            _v0[0] = cxl + e1[0] * ra * co + e2[0] * rb * si;
            _v0[1] = cyl + e1[1] * ra * co + e2[1] * rb * si;
            _v0[2] = czl + e1[2] * ra * co + e2[2] * rb * si;
            Model3D.boneToChar(skelVM, 'vm', _v0, 1, 1, _v1);
            const vx = _v1[0], vy = _v1[1], vz = _v1[2];
            if (vx <= NEAR) { bad = true; break; }
            const idx = base + k * sides + i;
            _sx[idx] = halfW - vy * D / vx;
            _sy[idx] = midY - vz * D / vx;
            _sw[idx] = 1 / vx;
            _ok[idx] = 1;
            const un0 = co / (ra || 1e-4), un1 = si / (rb || 1e-4);
            let lnx = e1[0] * un0 + e2[0] * un1;
            let lny = e1[1] * un0 + e2[1] * un1;
            let lnz = e1[2] * un0 + e2[2] * un1;
            let ll = Math.hypot(lnx, lny, lnz) || 1;
            lnx = lnx / ll - adx * slope; lny = lny / ll - ady * slope; lnz = lnz / ll - adz * slope;
            ll = Math.hypot(lnx, lny, lnz) || 1;
            lnx /= ll; lny /= ll; lnz /= ll;
            const wnx = nm[0] * lnx + nm[1] * lny + nm[2] * lnz;
            const wny = nm[3] * lnx + nm[4] * lny + nm[5] * lnz;
            const wnz = nm[6] * lnx + nm[7] * lny + nm[8] * lnz;
            _lm[idx] = this.lightVertex(wnx, wny, wnz, lx, ly, lz, hx, hy, hz, mt, aoK);
          }
        }
        if (bad) continue;
        for (let i = base; i < base + sides * K; i++) {
          if (_sx[i] < minX) minX = _sx[i]; if (_sx[i] > maxX) maxX = _sx[i];
          if (_sy[i] < minY) minY = _sy[i]; if (_sy[i] > maxY) maxY = _sy[i];
        }
        n = base + sides * K;
        const cnx = nm[0] * adx + nm[1] * ady + nm[2] * adz;
        const cny = nm[3] * adx + nm[4] * ady + nm[5] * adz;
        const cnz = nm[6] * adx + nm[7] * ady + nm[8] * adz;
        _pCapA[np] = this.lightVertex(-cnx, -cny, -cnz, lx, ly, lz, hx, hy, hz, mt, aoK);
        _pCapB[np] = this.lightVertex(cnx, cny, cnz, lx, ly, lz, hx, hy, hz, mt, aoK);
        _pBase[np] = base; _pIdx[np] = pi; _pRings[np] = K;
        _lutTable.push(RG.lutFor(m.colors[pt.col] || m.colors.main, pt.mat, 0, null));
        np++;
      }
      if (!np || minX > maxX) return false;

      const bx = Math.max(-2, Math.floor(minX) - 1), by = Math.max(-2, Math.floor(minY) - 1);
      const bw = Math.min(W + 4, Math.ceil(maxX) + 1) - bx, bh = Math.min(H + 4, Math.ceil(maxY) + 1) - by;
      if (bw <= 0 || bh <= 0) return false;
      const CAP = 360;
      let ds = 1;
      if (bw > CAP || bh > CAP) ds = Math.min(CAP / bw, CAP / bh);
      const rw = Math.max(1, Math.round(bw * ds)), rh = Math.max(1, Math.round(bh * ds));
      const RB = Raster3D.R3;
      RB.begin(rw, rh);

      const emit = (i0, i1, i2, i3, lut, la, lb2, lc, ld) => {
        if (!_ok[i0] || !_ok[i1] || !_ok[i2] || (i3 >= 0 && !_ok[i3])) return;
        const x0 = (_sx[i0] - bx) * ds, y0 = (_sy[i0] - by) * ds;
        const x1 = (_sx[i1] - bx) * ds, y1 = (_sy[i1] - by) * ds;
        const x2 = (_sx[i2] - bx) * ds, y2 = (_sy[i2] - by) * ds;
        if ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) <= 0) return;
        _pa[0] = x0; _pa[1] = y0; _pa[2] = _sw[i0]; _pa[3] = la;
        _pb[0] = x1; _pb[1] = y1; _pb[2] = _sw[i1]; _pb[3] = lb2;
        _pc[0] = x2; _pc[1] = y2; _pc[2] = _sw[i2]; _pc[3] = lc;
        if (i3 >= 0) {
          _pd[0] = (_sx[i3] - bx) * ds; _pd[1] = (_sy[i3] - by) * ds; _pd[2] = _sw[i3]; _pd[3] = ld;
          RB.quadS(_pa, _pb, _pc, _pd, lut);
        } else RB.triS(_pa, _pb, _pc, lut);
      };
      for (let k = 0; k < np; k++) {
        const pt = parts[_pIdx[k]];
        const sides = pt.sides, base = _pBase[k], K = _pRings[k];
        const lut = _lutTable[k];
        for (let r = 0; r < K - 1; r++) {
          const o0 = base + r * sides, o1 = base + (r + 1) * sides;
          for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            emit(o0 + i, o0 + j, o1 + j, o1 + i, lut, _lm[o0 + i], _lm[o0 + j], _lm[o1 + j], _lm[o1 + i]);
          }
        }
        const la = _pCapA[k], lb2 = _pCapB[k], top = base + (K - 1) * sides;
        for (let i = 1; i < sides - 1; i++) {
          emit(base, base + i, base + i + 1, -1, lut, la, la, la, la);
          emit(top, top + i + 1, top + i, -1, lut, lb2, lb2, lb2, lb2);
        }
      }
      R.ctx.drawImage(RB.flush(), 0, 0, rw, rh, bx, by, bw, bh);
      this._vmBox = { bx, by, bw, bh };
      this._vmD = D;
      this.stats.vm = 1;
      return true;
    },

    /** 一人称の銃口位置（画面座標）。発砲光をそこから出す */
    vmMuzzle(R, game) {
      if (!skelVM.vm || !this._vmD) return null;
      const wcls = this.weaponClass(game.player);
      if (!wcls) return null;
      const mz = this.vmSet(wcls).muzzle;
      Model3D.boneToChar(skelVM, 'vm', mz, 1, 1, _v1);
      if (_v1[0] <= 0.05) return null;
      const D = this._vmD;
      return { x: R.W / 2 - _v1[1] * D / _v1[0], y: R.H / 2 - _v1[2] * D / _v1[0], s: D / _v1[0] };
    },

    _fogRGB(R) {
      const th = R.theme;
      const key = th && th.fog;
      if (this._fogKey !== key) { this._fogKey = key; this._fog = Raster3D.hexRGB(key || '#0b1622'); }
      return this._fog;
    },

    /**
     * 足元の接地影。ぼかした楕円で「地面に立っている」感じを出す。
     * 姿勢（立ち/しゃがみ/伏せ）と落下高度で大きさと濃さを変える。
     */
    shadow(R, c, proj) {
      const ctx = R.ctx, cam = R.cam;
      if (proj.depth > 24) return;
      if (R.zAt(proj.sx) < proj.depth) return;
      const lineH = proj.lineH;
      const y = cam.horizon + cam.eyeZ * lineH;
      const st = c.stance || 'stand';
      const spread = st === 'prone' ? 0.46 : (st === 'crouch' ? 0.30 : 0.25);
      const air = c.state === 'drop' ? clamp(1 - (c.z || 0) / 12, 0, 1) : 1;
      const w = lineH * spread * (0.8 + air * 0.2);
      const h = w * (st === 'prone' ? 0.34 : 0.30);
      if (w < 1.5) return;
      const a = clamp(0.34 - proj.depth * 0.007, 0.06, 0.34) * (0.35 + air * 0.65);
      // グラデーションは1度だけ作り、濃さは globalAlpha で変える
      if (!this._shGrad) {
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, 'rgba(12,18,14,1)');
        gr.addColorStop(0.55, 'rgba(12,18,14,0.72)');
        gr.addColorStop(1, 'rgba(12,18,14,0)');
        this._shGrad = gr;
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(proj.sx, y);
      ctx.scale(w, h);
      ctx.fillStyle = this._shGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    resetStats() {
      const s = this.stats;
      s.drawn = 0; s.tris = 0; s.faces = 0; s.lod[0] = s.lod[1] = s.lod[2] = s.lod[3] = 0;
      Raster3D.R3.tris = 0;
    }
  };

  g.Char3D = Char3D;
})(window);
