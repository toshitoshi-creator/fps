/* ===== gl3d.js — LAST ISLAND の WebGL2 描画 ==================================
 * ゲームの状態（BR）を読んで描くだけ。ロジックは持たない。
 *   ・カメラ: 三人称(TPP) / 一人称(FPP) / 輸送機 / 降下（PUBG と同じ流れ）
 *   ・太陽光 + 空の環境光 + 影(シャドウマップ) + 大気の霞 + ACESトーンマップ
 *   ・地面 / 水面 / 草 / 建物 / 木 / 人物（GPUスキニング）/ 一人称の腕と銃
 *   ・弾道 / マズルフラッシュ / 血しぶき / 土煙 / 安全地帯の青い壁
 * 射撃の当たり判定は、描いたのと同じカメラと人物の骨から3Dで取る。
 * WebGL2 が無い環境では従来のレイキャスト描画（Render）に自動で戻る。
 * ========================================================================= */
(function (g) {
  'use strict';

  const M4 = () => GLC.M4;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const ALT_K = 0.5;            // 降下中の高度 → 描画上の高さ
  const EYE_K = 1.6;            // ゲーム側の目の高さ → 描画上の目の高さ
  const PITCH_K = 1.5;          // ゲーム側のピッチ → 実際の見上げ角(rad)

  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const scale3 = (hex, k) => GLC.lin(hex).map(v => v * k);
  /**
   * 試合ごとの天候・時間帯。シードで決まる（ロビーは夕方で固定）。
   * 影の向き・空・霞・光の色がまとめて変わる。
   */
  const ENVS = {
    clear: { name: 'CLEAR', sun: norm3([0.52, 0.34, 0.62]), sunCol: [2.6, 2.35, 2.0], sky: [0.36, 0.48, 0.66], gnd: [0.20, 0.19, 0.14],
      zenith: scale3('#3f7fc8', 1.5), horizon: scale3('#bcd3e2', 1.45), fog: scale3('#b4c8d6', 1.35), fogK: 1, exposure: 1.0, clouds: 1 },
    golden: { name: 'GOLDEN HOUR', sun: norm3([0.78, 0.46, 0.26]), sunCol: [2.9, 1.95, 1.15], sky: [0.34, 0.38, 0.50], gnd: [0.22, 0.17, 0.12],
      zenith: scale3('#4a78b8', 1.3), horizon: scale3('#f0c8a0', 1.35), fog: scale3('#d8b8a0', 1.2), fogK: 1.1, exposure: 1.05, clouds: 1 },
    overcast: { name: 'OVERCAST', sun: norm3([0.40, 0.30, 0.75]), sunCol: [1.05, 1.05, 1.08], sky: [0.62, 0.66, 0.72], gnd: [0.26, 0.26, 0.24],
      zenith: scale3('#8a96a4', 1.3), horizon: scale3('#b8bec4', 1.3), fog: scale3('#aab2ba', 1.25), fogK: 1.9, exposure: 1.1, clouds: 0 }
  };
  let SUN = ENVS.clear.sun;

  const GL3D = {
    ok: false, gl: null, canvas: null,
    W: 0, H: 0, scale: 1, quality: 'AUTO', dyn: 1,
    view: 'TPP',               // TPP / FPP
    cam: { pos: [0, 0, 1], f: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1], zoom: 1, mode: 'fpp', tpp: false, dist: 0 },
    stats: { draws: 0, tris: 0, chars: 0, ms: 0 },
    world: null, mapSeed: -1,
    _t: 0,

    /* =================================================================
     * 初期化
     * =============================================================== */
    init(canvas) {
      this.canvas = canvas;
      let gl = null;
      try {
        gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      } catch (e) { gl = null; }
      if (!gl) { this.ok = false; return false; }
      // GPUの無い環境（ソフトウェア描画）では重すぎるので、明示された時だけ使う
      const force = /[?&]gl=1/.test(location.search);
      const deny = /[?&]gl=0/.test(location.search);
      let soft = false;
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        soft = /swiftshader|llvmpipe|software|basic render/i.test(String(name));
        this.renderer = String(name);
      } catch (e) { soft = false; }
      this.software = soft;
      if (deny || (soft && !force)) { this.ok = false; return false; }
      this.gl = gl;
      try {
        const S = GLC.SRC;
        this.P = {
          lit: GLC.program(gl, S.litVS, S.litFS),
          ground: GLC.program(gl, S.groundVS, S.groundFS),
          water: GLC.program(gl, S.waterVS, S.waterFS),
          sky: GLC.program(gl, S.skyVS, S.skyFS),
          char: GLC.program(gl, S.charVS, S.charFS),
          grass: GLC.program(gl, S.grassVS, S.grassFS),
          fx: GLC.program(gl, S.fxVS, S.fxFS),
          zone: GLC.program(gl, S.zoneVS, S.zoneFS),
          depth: GLC.program(gl, S.depthVS, S.depthFS),
          depthChar: GLC.program(gl, S.depthCharVS, S.depthFS)
        };
        this._makeTextures();
        this._makeShadow(2048);
        this._makeCommonMeshes();
      } catch (e) {
        console.warn('[GL3D] 初期化に失敗したため従来描画に戻します', e);
        this.ok = false;
        return false;
      }
      this.vp = M4().create(); this.viewM = M4().create(); this.proj = M4().create();
      this.invVP = M4().create(); this.model = M4().create(); this.shadowVP = M4().create();
      this.bones = new Float32Array(21 * 16);
      this.fxBuf = new Float32Array(10 * 6 * 4096);
      this.ok = true;
      this.resize();
      return true;
    },

    _makeTextures() {
      const gl = this.gl, WT = WorldTex;
      const layers = WT.layers();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, WT.TS, WT.TS, WT.LAYERS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      layers.forEach((c, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, WT.TS, WT.TS, 1, gl.RGBA, gl.UNSIGNED_BYTE, c));
      // 細部テクスチャ（地面の凹凸・雲・波）だけは線形のまま使いたいので別レイヤーに複製しない。
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      this.texArr = tex;
    },

    _tex2D(src, srgb, mip, wrap) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
      return t;
    },

    _makeShadow(size) {
      const gl = this.gl;
      if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFB); }
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.shadowTex = t; this.shadowFB = fb; this.shadowSize = size;
    },

    _makeCommonMeshes() {
      const gl = this.gl;
      const LITL = [['a_pos', 3], ['a_nrm', 3], ['a_uv', 2], ['a_layer', 1], ['a_col', 3]];
      this.LITL = LITL;
      this.CHARL = [['a_pos', 3], ['a_nrm', 3], ['a_uv', 2], ['a_col', 3], ['a_bone', 1], ['a_layer', 1]];
      this.FXL = [['a_pos', 3], ['a_uv', 2], ['a_col', 4], ['a_shape', 1]];
      this.fxMesh = GLC.mesh(gl, new Float32Array(10 * 6), this.FXL, gl.DYNAMIC_DRAW);
      // 安全地帯の円筒（単位円 × 高さ1）
      const zb = new GLC.Builder(3), S = 96;
      for (let i = 0; i < S; i++) {
        const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        zb.push([c0, s0, 0, c1, s1, 0, c1, s1, 1, c0, s0, 0, c1, s1, 1, c0, s0, 1]);
      }
      this.zoneMesh = GLC.mesh(gl, zb.data(), [['a_pos', 3]]);
      this.planeMeshGL = GLC.mesh(gl, GLChar.planeMesh(), LITL);
      this.propMeshGL = GLC.mesh(gl, GLChar.propMesh(), LITL);
      this.chuteMeshGL = GLC.mesh(gl, GLChar.chuteMesh(), LITL);
      this.skyVAO = gl.createVertexArray();
      this.lootMeshes = {};
      this._buildGrass(6000);
    },

    _buildGrass(n) {
      const gl = this.gl;
      const B = new GLC.Builder(8);
      const R = WorldTex.mulberry(4242);
      const PATCH = 30;
      for (let i = 0; i < n; i++) {
        const bx = R() * PATCH, by = R() * PATCH, rn = R();
        const w = 0.34, h = 0.26;
        for (let k = 0; k < 2; k++) {
          const a = k * Math.PI / 2;
          const dx = Math.cos(a) * w / 2, dy = Math.sin(a) * w / 2;
          const v = (x, y, z, u, vv) => B.push([x, y, z, bx, by, rn, u, vv]);
          v(-dx, -dy, 0, 0, 0); v(dx, dy, 0, 1, 0); v(dx, dy, h, 1, 1);
          v(-dx, -dy, 0, 0, 0); v(dx, dy, h, 1, 1); v(-dx, -dy, h, 0, 1);
        }
      }
      this.grassMesh = GLC.mesh(gl, B.data(), [['a_pos', 3], ['a_base', 2], ['a_rnd', 1], ['a_uv', 2]]);
      this.grassPatch = PATCH;
      this.grassCount = n;
    },

    /* =================================================================
     * マップ
     * =============================================================== */
    _worlds: {},
    _WKEYS: ['world', 'map', 'terrainMesh', 'waterMesh', 'solidMesh', 'cutoutMesh', 'groundTex', 'maskTex', 'shoreTex', 'tileH', 'props', 'mapCanvas'],
    setMap(map) {
      if (!this.ok || !map) return;
      if (this.map === map && this.world) return;
      const gl = this.gl;
      // 作った世界はシードごとに取っておく（ロビーと試合を行き来しても作り直さない）
      this.setEnv(map);
      const cached = this._worlds[map.seed];
      if (cached && cached.map === map) {
        this._WKEYS.forEach(k => { this[k] = cached[k]; });
        this.mapSeed = map.seed;
        return;
      }
      // 古い試合の世界は捨てる（ロビーの舞台だけ残す）
      Object.keys(this._worlds).forEach(k => {
        const w = this._worlds[k];
        if (w.lobby) return;
        [w.terrainMesh, w.waterMesh, w.solidMesh, w.cutoutMesh].forEach(m => { if (m) { gl.deleteBuffer(m.vbo); gl.deleteVertexArray(m.vao); } });
        [w.groundTex, w.maskTex, w.shoreTex].forEach(t => t && gl.deleteTexture(t));
        delete this._worlds[k];
      });
      const t0 = performance.now();
      const W = GLWorld.build(map);
      this.world = W;
      this.map = map;
      this.mapSeed = map.seed;
      this.terrainMesh = GLC.mesh(gl, W.terrain.data, [['a_pos', 3], ['a_nrm', 3]]);
      this.waterMesh = GLC.mesh(gl, W.water, [['a_pos', 3]]);
      this.solidMesh = GLC.mesh(gl, W.solid, this.LITL);
      this.cutoutMesh = GLC.mesh(gl, W.cutout, this.LITL);
      this.groundTex = this._tex2D(W.ground.canvas, true, true);
      this.maskTex = this._tex2D(W.ground.mask, false, false);
      // 水深（陸からの距離）
      const sc = document.createElement('canvas');
      sc.width = map.w; sc.height = map.h;
      const sx = sc.getContext('2d'), id = sx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        const v = clamp(W.ground.landDist[i] / 10, 0, 1) * 255;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
      }
      sx.putImageData(id, 0, 0);
      this.shoreTex = this._tex2D(sc, false, false);
      this.tileH = W.tileH;
      this.props = W.props;
      this.stats.buildMs = performance.now() - t0;
      this.stats.solidTris = W.solid.length / 12 / 3;
      // 地図（UI用）も同じ地表から作る
      this.mapCanvas = map.lobby ? null : WorldTex.paintMap(map, W.ground, 768);
      const keep = { lobby: !!map.lobby };
      this._WKEYS.forEach(k => { keep[k] = this[k]; });
      this._worlds[map.seed] = keep;
    },

    ENVS,
    /** 天候・時間帯を決める（ロビーは夕方、試合はシードで 晴れ5 : 夕方3 : 曇り2） */
    setEnv(map) {
      let key = 'clear';
      if (map.lobby) key = 'golden';
      else {
        const r = ((map.seed * 2654435761) >>> 0) % 10;
        key = r < 5 ? 'clear' : (r < 8 ? 'golden' : 'overcast');
      }
      if (this.envOverride && ENVS[this.envOverride]) key = this.envOverride;
      this.env = ENVS[key];
      this.envKey = key;
      SUN = this.env.sun;
    },

    setQuality(q) {
      this.quality = q || 'AUTO';
      if (!this.ok) return;
      const sz = q === 'HIGH' ? 2048 : 1024;
      if (sz !== this.shadowSize) this._makeShadow(sz);
      this.resize();
    },
    _qual() {
      const q = this.quality;
      return {
        shadows: q !== 'LOW',
        grass: q === 'LOW' ? 0 : (q === 'HIGH' ? 6000 : (q === 'MID' ? 3000 : Math.round(4200 * this.dyn))),
        clouds: q !== 'LOW',
        maxScale: q === 'LOW' ? 0.6 : (q === 'MID' ? 0.85 : (q === 'HIGH' ? 2 : 1.25))
      };
    },

    resize() {
      if (!this.ok) return;
      const c = this.canvas;
      const cw = Math.max(320, c.clientWidth || window.innerWidth);
      const ch = Math.max(200, c.clientHeight || window.innerHeight);
      const dpr = window.devicePixelRatio || 1;
      const Q = this._qual();
      let s = Math.min(dpr, Q.maxScale);
      if (this.quality === 'AUTO') s *= this.dyn;
      // 画素数の上限（端末の発熱と電池を守る）
      const maxPx = this.quality === 'HIGH' ? 2.6e6 : 1.3e6;
      if (cw * ch * s * s > maxPx) s = Math.sqrt(maxPx / (cw * ch));
      s = Math.max(0.35, s);
      this.scale = s;
      this.W = Math.round(cw * s); this.H = Math.round(ch * s);
      if (c.width !== this.W || c.height !== this.H) { c.width = this.W; c.height = this.H; }
    },

    /** FPSに合わせて解像度を上下させる（AUTOのみ） */
    autoTune(fps) {
      if (!this.ok || this.quality !== 'AUTO') return;
      this._fpsAvg = (this._fpsAvg || 60) * 0.85 + fps * 0.15;
      this._tuneT = (this._tuneT || 0) + 1;
      if (this._tuneT < 6) return;
      this._tuneT = 0;
      const old = this.dyn;
      if (this._fpsAvg < 40) this.dyn = Math.max(0.5, this.dyn - 0.1);
      else if (this._fpsAvg > 56) this.dyn = Math.min(1, this.dyn + 0.05);
      if (Math.abs(old - this.dyn) > 0.01) this.resize();
    },

    /* =================================================================
     * カメラ
     * =============================================================== */
    /** 画面の射影をゲームの Render.cam と揃える（焦点 = 画面高さ × zoom） */
    _setCamera(pos, yaw, pitch, zoom, near, far) {
      const cam = this.cam;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      cam.pos[0] = pos[0]; cam.pos[1] = pos[1]; cam.pos[2] = pos[2];
      cam.f[0] = cy * cp; cam.f[1] = sy * cp; cam.f[2] = sp;
      cam.r[0] = -sy; cam.r[1] = cy; cam.r[2] = 0;
      cam.u[0] = -cy * sp; cam.u[1] = -sy * sp; cam.u[2] = cp;
      cam.zoom = zoom; cam.yaw = yaw; cam.pitch = pitch;
      const aspect = this.W / this.H;
      const fy = 2 * zoom, fx = fy / aspect;       // 焦点px = H*zoom
      M4().view(this.viewM, cam.pos, cam.r, cam.u, cam.f);
      M4().persp(this.proj, fx, fy, near || 0.05, far || 900);
      M4().mul(this.vp, this.proj, this.viewM);
      this._invert(this.invVP, this.vp);
    },

    _invert(out, m) {
      const a = m, inv = out;
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
      const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
      const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return out;
      det = 1 / det;
      inv[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; inv[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      inv[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; inv[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      inv[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; inv[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      inv[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; inv[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      inv[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; inv[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      inv[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; inv[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      inv[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; inv[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      inv[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; inv[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return out;
    },

    /** プレイヤーの状態からカメラを決める */
    updateCamera(br) {
      const p = br.player, cam = this.cam;
      const yaw = p.ang + (br.shakeYaw || 0);
      let pitch = (p.pitch + (br.shakePitch || 0)) * PITCH_K;
      const zoom = br.curZoom || 1;
      cam.tpp = false;
      if (p.state === 'plane' && br.plane) {
        // 輸送機の斜め後ろから見る（視点は自由に回せる）
        const pl = br.plane;
        const piv = [pl.x, pl.y, pl.alt * ALT_K];
        const pt = clamp(pitch - 0.32, -1.2, 0.5);
        const d = 26;
        const pos = [piv[0] - Math.cos(yaw) * Math.cos(pt) * d, piv[1] - Math.sin(yaw) * Math.cos(pt) * d, piv[2] - Math.sin(pt) * d + 3];
        cam.mode = 'plane';
        this._setCamera(pos, yaw, pt, 1, 0.5, 1400);
        return;
      }
      if (p.state === 'drop') {
        const piv = [p.x, p.y, (p.z || 0) * ALT_K + 0.6];
        const pt = clamp(pitch - (p.chute ? 0.25 : 0.55), -1.3, 0.6);
        const d = p.chute ? 4.2 : 3.4;
        const pos = [piv[0] - Math.cos(yaw) * Math.cos(pt) * d, piv[1] - Math.sin(yaw) * Math.cos(pt) * d, Math.max(0.3, piv[2] - Math.sin(pt) * d + 0.5)];
        cam.mode = 'drop';
        this._setCamera(pos, yaw, pt, 1, 0.1, 1200);
        return;
      }
      const eye = (p.eyeZ || 0.55) * EYE_K;
      const ads = (br.zoomT || 0) > 0.5;
      if (!p.alive) {
        // 倒されたら、自分の体をゆっくり回り込みながら見下ろす
        const st = this._death || (this._death = { t: 0 });
        st.t += 1 / 60;
        const yawD = p.ang + st.t * 0.45, pt = -0.42;
        let d = 3.4;
        const dx = Math.cos(yawD) * Math.cos(pt), dy = Math.sin(yawD) * Math.cos(pt);
        const c = Render.cast(br.map, p.x, p.y, -dx, -dy, d * Math.cos(pt) + 0.3);
        if (c.hit) d = Math.max(0.6, (c.dist - 0.25) / Math.cos(pt));
        cam.mode = 'death';
        this._setCamera([p.x - dx * d, p.y - dy * d, 0.5 - Math.sin(pt) * d], yawD, pt, 1, 0.05, 900);
        return;
      }
      this._death = null;
      if (this.view === 'TPP' && !ads && p.alive) {
        // 肩越しの三人称。壁にめり込まないよう手前へ寄せる
        const rx = -Math.sin(yaw), ry = Math.cos(yaw);
        const side = 0.36, back = p.stance === 'prone' ? 1.7 : 2.05;
        const fx = Math.cos(yaw) * Math.cos(pitch), fy = Math.sin(yaw) * Math.cos(pitch), fz = Math.sin(pitch);
        const piv = [p.x + rx * side, p.y + ry * side, eye + 0.2];
        // 肩の位置が壁の中なら肩をすぼめる
        let sideOk = side;
        const sc = Render.cast(br.map, p.x, p.y, rx, ry, side + 0.2);
        if (sc.hit && sc.dist < side + 0.2) sideOk = Math.max(0, sc.dist - 0.22);
        piv[0] = p.x + rx * sideOk; piv[1] = p.y + ry * sideOk;
        // 後ろへ引ける距離を探す: カメラの周り(半径0.22)に壁が無く、本人から見通せる所
        const clearAt = (x, y) => {
          if (br.solidAt(x, y)) return false;
          for (let k = 0; k < 8; k++) {
            const a = k / 8 * Math.PI * 2;
            if (br.solidAt(x + Math.cos(a) * 0.22, y + Math.sin(a) * 0.22)) return false;
          }
          return Render.los(br.map, p.x, p.y, x, y);
        };
        let d = back, pos = null;
        for (let t = back; t >= 0.3; t -= 0.1) {
          const x = piv[0] - fx * t, y = piv[1] - fy * t;
          if (clearAt(x, y)) { d = t; pos = [x, y, piv[2] - fz * t]; break; }
        }
        if (!pos) {
          // どこにも引けない（狭い通路の角など）: 肩の位置、それも駄目なら頭の位置から見る
          d = 0.3;
          pos = clearAt(piv[0], piv[1]) ? [piv[0], piv[1], piv[2]] : [p.x, p.y, eye + 0.1];
        }
        const inside = this._insideBuilding(p.x, p.y);
        if (inside) pos[2] = Math.min(pos[2], GLWorld.CZ - 0.12);
        pos[2] = Math.max(0.12, pos[2]);
        cam.mode = 'tpp'; cam.tpp = true; cam.dist = d;
        this._setCamera(pos, yaw, pitch, zoom, 0.05, 900);
        return;
      }
      cam.mode = 'fpp';
      this._setCamera([p.x, p.y, eye], yaw, pitch, zoom, 0.03, 900);
    },

    _insideBuilding(x, y) {
      const bs = this.map && this.map.buildings;
      if (!bs) return null;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        if (x >= b.x && y >= b.y && x < b.x + b.bw && y < b.y + b.bh) return b;
      }
      return null;
    },

    /** 世界座標 → 画面座標（CSS px）。後ろなら null */
    project(x, y, z) {
      const m = this.vp;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0.05) return null;
      const r = this._rect && this._rectF === this._frame ? this._rect : (this._rect = this.canvas.getBoundingClientRect(), this._rectF = this._frame, this._rect);
      return { x: (cx / cw * 0.5 + 0.5) * r.width, y: (1 - (cy / cw * 0.5 + 0.5)) * r.height, w: cw };
    },

    /* =================================================================
     * 人物の姿勢（骨 → 世界行列）
     * =============================================================== */
    _poseBox: null, _skel: {},
    /** キャラ1体ぶんの骨行列を this.bones に書き、当たり判定用の骨位置を c._gl に残す */
    poseChar(c, br) {
      const look = c._look || (c._look = GLChar.lookFor(c));
      const st = c._gl || (c._gl = { t: Math.random() * 10, caps: [], landAt: null, lastState: null });
      const armed = !!(c.alive && c.state !== 'dead' && c.weapons && c.weapons[c.wIdx]);
      const aiming = Char3D.isAiming(c);
      if (st.lastState !== c.state) {
        if (c.state === 'ground' && st.lastState === 'drop') st.landAt = c.animT || 0;
        st.lastState = c.state;
      }
      const landK = st.landAt != null ? clamp(1 - ((c.animT || 0) - st.landAt) / 0.5, 0, 1) : 0;
      const P = Model3D.animate(this._poseBox || (this._poseBox = Model3D.newPose()), c, (c.animT || 0) + st.t, { aiming, armed, landK });
      const build = look.build;
      const sk = Model3D.solve(P, build, 1, this._skel);
      if (armed) Model3D.poseWeapon(sk, Char3D.holdOpts(c, aiming, false));
      else if (sk.weapon) { sk.weapon.o.fill(0); }
      const hW = (c.def ? c.def.height : 0.95) * 1.02 * look.height;
      const ang = c.ang || 0, ca = Math.cos(ang), sa = Math.sin(ang);
      const z0 = c.state === 'drop' ? (c.z || 0) * ALT_K : 0;
      const bonesN = GLChar.BONES.length;
      const B = this.bones;
      st.hW = hW;
      for (let i = 0; i < bonesN; i++) {
        const name = GLChar.BONES[i];
        const b = sk[name];
        const o = i * 16;
        if (!b) { B.fill(0, o, o + 16); continue; }
        const m = b.m;
        for (let j = 0; j < 3; j++) {
          const s = j < 2 ? build : 1;
          const mx = m[j] * s, my = m[3 + j] * s, mz = m[6 + j] * s;
          B[o + j * 4] = hW * (ca * mx + sa * my);
          B[o + j * 4 + 1] = hW * (sa * mx - ca * my);
          B[o + j * 4 + 2] = hW * mz;
          B[o + j * 4 + 3] = 0;
        }
        B[o + 12] = c.x + hW * (ca * b.o[0] + sa * b.o[1]);
        B[o + 13] = c.y + hW * (sa * b.o[0] - ca * b.o[1]);
        B[o + 14] = z0 + hW * b.o[2];
        B[o + 15] = 1;
      }
      // 当たり判定用のカプセル（世界座標）
      const J = name => { const o = GLChar.BI[name] * 16; return [B[o + 12], B[o + 13], B[o + 14]]; };
      const at = (name, lx, ly, lz) => {
        const o = GLChar.BI[name] * 16;
        return [B[o + 12] + B[o] * lx + B[o + 4] * ly + B[o + 8] * lz, B[o + 13] + B[o + 1] * lx + B[o + 5] * ly + B[o + 9] * lz, B[o + 14] + B[o + 2] * lx + B[o + 6] * ly + B[o + 10] * lz];
      };
      const caps = st.caps;
      caps.length = 0;
      caps.push({ k: 'head', a: at('head', 0.004, 0, 0.055), b: at('head', 0.0, 0, 0.1), r: 0.082 * hW });
      caps.push({ k: 'body', a: at('pelvis', 0, 0, -0.02), b: J('neck'), r: 0.118 * hW * build });
      caps.push({ k: 'arm', a: J('armLU'), b: J('armLL'), r: 0.046 * hW });
      caps.push({ k: 'arm', a: J('armRU'), b: J('armRL'), r: 0.046 * hW });
      caps.push({ k: 'arm', a: J('armLL'), b: J('handL'), r: 0.04 * hW });
      caps.push({ k: 'arm', a: J('armRL'), b: J('handR'), r: 0.04 * hW });
      caps.push({ k: 'leg', a: J('legLU'), b: J('legLL'), r: 0.062 * hW });
      caps.push({ k: 'leg', a: J('legRU'), b: J('legRL'), r: 0.062 * hW });
      caps.push({ k: 'leg', a: J('legLL'), b: J('footL'), r: 0.05 * hW });
      caps.push({ k: 'leg', a: J('legRL'), b: J('footR'), r: 0.05 * hW });
      st.frame = this._frame;
      st.armed = armed;
      return look;
    },

    /** 銃口の世界座標（直前の poseChar の結果から） */
    muzzleOf(c) {
      const st = c._gl;
      if (!st || !st.armed || !st.wBone) return null;
      return st.muzzle;
    },

    /* =================================================================
     * 描画
     * =============================================================== */
    _frame: 0,
    _uniformsCommon(P) {
      const gl = this.gl, u = P.u, cam = this.cam;
      const lin = GLC.lin;
      if (u.u_vp) gl.uniformMatrix4fv(u.u_vp, false, this.vp);
      const E = this.env || ENVS.clear;
      void lin;
      if (u.u_sunDir) gl.uniform3fv(u.u_sunDir, E.sun);
      if (u.u_sunCol) gl.uniform3fv(u.u_sunCol, E.sunCol);
      if (u.u_skyCol) gl.uniform3fv(u.u_skyCol, E.sky);
      if (u.u_gndCol) gl.uniform3fv(u.u_gndCol, E.gnd);
      if (u.u_zenith) gl.uniform3fv(u.u_zenith, E.zenith);
      if (u.u_horizon) gl.uniform3fv(u.u_horizon, E.horizon);
      if (u.u_fogCol) gl.uniform3fv(u.u_fogCol, E.fog);
      if (u.u_fogDen) gl.uniform1f(u.u_fogDen, (this._fogDen || 0.0065) * E.fogK);
      if (u.u_camPos) gl.uniform3fv(u.u_camPos, cam.pos);
      if (u.u_exposure) gl.uniform1f(u.u_exposure, E.exposure);
      if (u.u_shadowOn) gl.uniform1f(u.u_shadowOn, this._shadowOn ? 1 : 0);
      if (u.u_shadowMat) gl.uniformMatrix4fv(u.u_shadowMat, false, this.shadowVP);
      if (u.u_shadowTexel) gl.uniform1f(u.u_shadowTexel, 1 / this.shadowSize);
      if (u.u_shadow) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.u_shadow, 1); }
      if (u.u_tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArr); gl.uniform1i(u.u_tex, 0); }
      if (u.u_time) gl.uniform1f(u.u_time, this._t);
      if (u.u_flash) gl.uniform4fv(u.u_flash, this._flash);
      if (u.u_gOrg) gl.uniform3f(u.u_gOrg, WorldTex.GROUND.origin, WorldTex.GROUND.size, 0);
    },

    _flash: new Float32Array(4),

    render(br, dt) {
      if (!this.ok || !br.map) return false;
      const t0 = performance.now();
      const gl = this.gl;
      this.setMap(br.map);
      this._t += dt || 0.016;
      this._frame++;
      this.stats.draws = 0; this.stats.chars = 0;
      const p = br.player;
      this.updateCamera(br);
      const cam = this.cam;
      this._fogDen = cam.mode === 'plane' || cam.mode === 'drop' ? 0.0017 : 0.0046;

      // 発砲光（自分の銃口）と爆発の光
      const fl = this._flash;
      this._blasts.forEach(b => { b.t += dt || 0.016; });
      this._blasts = this._blasts.filter(b => b.t < 0.6);
      const bl = this._blasts[this._blasts.length - 1];
      if (bl && bl.t < 0.35) {
        fl[0] = bl.x; fl[1] = bl.y; fl[2] = bl.z + 0.5; fl[3] = (1 - bl.t / 0.35) * 5;
      } else if (p && p.flashT > 0.01 && p.state === 'ground') {
        fl[0] = cam.pos[0] + cam.f[0] * 0.6; fl[1] = cam.pos[1] + cam.f[1] * 0.6; fl[2] = cam.pos[2] - 0.1;
        fl[3] = clamp(p.flashT * 9, 0, 1) * 0.9;
      } else fl[3] = 0;

      /* --- 人物の姿勢（見える範囲 + 当たり判定用） --- */
      const chars = [];
      br.combatants.forEach(c => {
        if (c.state === 'plane') return;
        if (!c.alive && (c.deadT || 0) > 3.4) return;
        const self = c === p;
        const dx = c.x - cam.pos[0], dy = c.y - cam.pos[1];
        const dist = Math.hypot(dx, dy);
        if (dist > 160) return;
        chars.push({ c, dist, self });
      });

      /* --- 影 --- */
      const Q = this._qual();
      this._shadowOn = Q.shadows;
      if (Q.shadows) this._renderShadow(br, chars);

      /* --- 本描画 --- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.clearColor(0.7, 0.8, 0.9, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);

      this._drawSky(Q);
      this._drawGround();
      this._drawStatic();
      this._drawLoot(br);
      this._drawChars(br, chars);
      this._drawPlane(br);
      this._drawProjectiles(br);
      if (Q.grass) this._drawGrass(Q.grass);
      this._drawCutout();
      this._drawWater();
      this._drawZone(br);
      this._drawFx(br);
      if (cam.mode === 'fpp' && p.alive && p.state === 'ground') this._drawViewModel(br);
      this.stats.ms = performance.now() - t0;
      return true;
    },

    _renderShadow(br, chars) {
      const gl = this.gl, cam = this.cam;
      // 注視点（地上なら足元の少し前、空中なら真下）
      let cx = cam.pos[0] + cam.f[0] * 14, cy = cam.pos[1] + cam.f[1] * 14;
      let ext = 30;
      if (cam.mode === 'plane' || cam.mode === 'drop') { cx = cam.pos[0] + cam.f[0] * 40; cy = cam.pos[1] + cam.f[1] * 40; ext = 70; }
      const L = SUN;
      // 光の基底
      const up = Math.abs(L[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
      let rx = up[1] * L[2] - up[2] * L[1], ry = up[2] * L[0] - up[0] * L[2], rz = up[0] * L[1] - up[1] * L[0];
      const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
      const ux = L[1] * rz - L[2] * ry, uy = L[2] * rx - L[0] * rz, uz = L[0] * ry - L[1] * rx;
      // テクセル単位に中心を揃えて、動いた時のちらつきを抑える
      const texel = ext * 2 / this.shadowSize;
      let pr = cx * rx + cy * ry, pu = cx * ux + cy * uy;
      pr = Math.round(pr / texel) * texel; pu = Math.round(pu / texel) * texel;
      const center = [rx * pr + ux * pu, ry * pr + uy * pu, rz * pr + uz * pu];
      // 地面(z=0)の注視点に戻す
      const pl = (cx * L[0] + cy * L[1]) - (center[0] * L[0] + center[1] * L[1] + center[2] * L[2]);
      center[0] += L[0] * pl; center[1] += L[1] * pl; center[2] += L[2] * pl;
      const eye = [center[0] + L[0] * 80, center[1] + L[1] * 80, center[2] + L[2] * 80];
      const V = M4().create(), P = M4().create();
      M4().view(V, eye, [rx, ry, rz], [ux, uy, uz], [-L[0], -L[1], -L[2]]);
      M4().ortho(P, -ext, ext, -ext, ext, 1, 200);
      M4().mul(this.shadowVP, P, V);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.6, 3.0);
      const D = this.P.depth;
      gl.useProgram(D.p);
      gl.uniformMatrix4fv(D.u.u_vp, false, this.shadowVP);
      gl.uniformMatrix4fv(D.u.u_model, false, M4().identity(this.model));
      gl.bindVertexArray(this.solidMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.solidMesh.count);
      // 人物
      const DC = this.P.depthChar;
      gl.useProgram(DC.p);
      gl.uniformMatrix4fv(DC.u.u_vp, false, this.shadowVP);
      chars.forEach(it => {
        if (it.dist > 45) return;
        const c = it.c;
        const look = this.poseChar(c, br);
        const mesh = this._charMesh(c, look, 1);
        gl.uniformMatrix4fv(DC.u.u_bones, false, this.bones);
        gl.bindVertexArray(mesh.gl.vao);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.gl.count);
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    },

    _drawSky(Q) {
      const gl = this.gl, P = this.P.sky;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniformMatrix4fv(P.u.u_invVP, false, this.invVP);
      gl.uniform1f(P.u.u_clouds, Q.clouds && (this.env || ENVS.clear).clouds ? 1 : 0);
      gl.depthMask(false);
      gl.bindVertexArray(this.skyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      this.stats.draws++;
    },

    _drawGround() {
      const gl = this.gl, P = this.P.ground;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.groundTex); gl.uniform1i(P.u.u_ground, 2);
      gl.bindVertexArray(this.terrainMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.terrainMesh.count);
      this.stats.draws++;
    },

    _drawStatic() {
      const gl = this.gl, P = this.P.lit;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniformMatrix4fv(P.u.u_model, false, M4().identity(this.model));
      gl.uniform1f(P.u.u_cutout, 0);
      gl.uniform1f(P.u.u_wind, 1);
      gl.uniform1f(P.u.u_emit, 0);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);        // 近くの葉を網点で透かす
      gl.bindVertexArray(this.solidMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.solidMesh.count);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      this.stats.draws++;
    },

    _drawCutout() {
      const gl = this.gl, P = this.P.lit;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniformMatrix4fv(P.u.u_model, false, M4().identity(this.model));
      gl.uniform1f(P.u.u_cutout, 1);
      gl.uniform1f(P.u.u_wind, 1);
      gl.uniform1f(P.u.u_emit, 0);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(this.cutoutMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.cutoutMesh.count);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      this.stats.draws++;
    },

    _drawGrass(n) {
      const gl = this.gl, P = this.P.grass, cam = this.cam;
      if (cam.mode === 'plane' || (cam.mode === 'drop' && cam.pos[2] > 12)) return;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform2f(P.u.u_cam, cam.pos[0], cam.pos[1]);
      gl.uniform1f(P.u.u_patch, this.grassPatch);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.maskTex); gl.uniform1i(P.u.u_mask, 3);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.groundTex); gl.uniform1i(P.u.u_ground, 2);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(this.grassMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, Math.min(this.grassCount, n) * 12);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      this.stats.draws++;
    },

    _drawWater() {
      const gl = this.gl, P = this.P.water;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.shoreTex); gl.uniform1i(P.u.u_shore, 3);
      gl.uniform1f(P.u.u_mapW, this.map.w);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.waterMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.waterMesh.count);
      gl.disable(gl.BLEND);
      this.stats.draws++;
    },

    _charMesh(c, look, lod) {
      const armed = c.alive && c.state !== 'dead' && c.weapons && c.weapons[c.wIdx];
      const wcls = armed ? (c.weapons[c.wIdx].def.cls || 'AR') : null;
      const vest = c.armorMax >= 120 ? 3 : (c.armorMax >= 80 ? 2 : (c.armorMax > 0 ? 1 : 0));
      const pack = c.state === 'ground' || c.state === 'dead' ? (c.isPlayer ? Math.min(3, 1 + ((BR.stats && BR.stats.lootPicked) > 6 ? 1 : 0)) : look.pack) : 1;
      const m = GLChar.charMesh(look, c.helmet || 0, vest, pack, wcls, lod);
      if (!m.gl) m.gl = GLC.mesh(this.gl, m.data, this.CHARL);
      return m;
    },

    _drawChars(br, chars) {
      const gl = this.gl, P = this.P.char, cam = this.cam, p = br.player;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_shadowK, 1);
      gl.uniform1f(P.u.u_fill, 0.06);
      chars.forEach(it => {
        const c = it.c;
        // 一人称では自分の体は描かない（影だけ落とす）
        if (it.self && cam.mode === 'fpp') return;
        // 画面外は描かない（大まかな円錐判定）
        const dx = c.x - cam.pos[0], dy = c.y - cam.pos[1], dz = (c.state === 'drop' ? (c.z || 0) * ALT_K : 0.5) - cam.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > 3 && (dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2]) / d < 0.2) { this.poseChar(c, br); return; }
        const look = this.poseChar(c, br);
        const lod = it.dist < 22 ? 0 : 1;
        const mesh = this._charMesh(c, look, lod);
        let alpha = 1;
        if (!c.alive) alpha = clamp(1 - ((c.deadT || 0) - 2.2) / 1.0, 0, 1);
        if (it.self && cam.tpp && cam.dist < 0.9) alpha = Math.min(alpha, clamp((cam.dist - 0.35) / 0.55, 0.15, 1));
        gl.uniform1f(P.u.u_alpha, alpha);
        const hurt = c.hurtT > 0 && c.alive ? clamp(c.hurtT * 2.2, 0, 0.3) : 0;
        gl.uniform4f(P.u.u_tint, 0.8, 0.12, 0.08, hurt);
        gl.uniformMatrix4fv(P.u.u_bones, false, this.bones);
        gl.bindVertexArray(mesh.gl.vao);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.gl.count);
        this.stats.draws++; this.stats.chars++;
        // 銃口の位置（マズルフラッシュ・弾道の起点）
        this._storeMuzzle(c);
        // パラシュート
        if (c.state === 'drop' && c.chute) {
          const LP = this.P.lit;
          gl.useProgram(LP.p);
          this._uniformsCommon(LP);
          M4().trs(this.model, c.x, c.y, (c.z || 0) * ALT_K, c.ang || 0, 1);
          gl.uniformMatrix4fv(LP.u.u_model, false, this.model);
          gl.uniform1f(LP.u.u_cutout, 0); gl.uniform1f(LP.u.u_wind, 0); gl.uniform1f(LP.u.u_emit, 0);
          gl.bindVertexArray(this.chuteMeshGL.vao);
          gl.drawArrays(gl.TRIANGLES, 0, this.chuteMeshGL.count);
          gl.useProgram(P.p);
          this._uniformsCommon(P);
          gl.uniform1f(P.u.u_shadowK, 1);
          gl.uniform1f(P.u.u_fill, 0.06);
        }
      });
    },

    _storeMuzzle(c) {
      const st = c._gl;
      if (!st || !st.armed) return;
      const w = c.weapons[c.wIdx];
      const cls = w && w.def ? w.def.cls : 'AR';
      const mz = (this._mzCache[cls] || (this._mzCache[cls] = GLChar.muzzleOf(cls)));
      const B = this.bones, o = GLChar.BI.weapon * 16;
      st.muzzle = st.muzzle || [0, 0, 0];
      st.muzzle[0] = B[o + 12] + B[o] * mz[0] + B[o + 4] * mz[1] + B[o + 8] * mz[2];
      st.muzzle[1] = B[o + 13] + B[o + 1] * mz[0] + B[o + 5] * mz[1] + B[o + 9] * mz[2];
      st.muzzle[2] = B[o + 14] + B[o + 2] * mz[0] + B[o + 6] * mz[1] + B[o + 10] * mz[2];
      st.wBone = true;
    },
    _mzCache: {},

    _drawLoot(br) {
      const gl = this.gl, P = this.P.lit, cam = this.cam;
      if (cam.mode === 'plane') return;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_cutout, 0); gl.uniform1f(P.u.u_wind, 0);
      const R2 = 34 * 34;
      const list = br.pickups || br.loot;
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (!l.alive) continue;
        const dx = l.x - cam.pos[0], dy = l.y - cam.pos[1];
        if (dx * dx + dy * dy > R2) continue;
        const key = l.kind + ':' + l.id;
        let m = this.lootMeshes[key];
        if (!m) m = this.lootMeshes[key] = GLC.mesh(gl, GLChar.lootMesh(l.kind, l.id), this.LITL);
        const rot = ((l.x * 12.9898 + l.y * 78.233) % 6.283);
        M4().trs(this.model, l.x, l.y, 0.005, rot, 1);
        gl.uniformMatrix4fv(P.u.u_model, false, this.model);
        // 近くの物はほんのり光らせて見つけやすくする
        const near = dx * dx + dy * dy < 4 ? 0.25 : 0.06;
        gl.uniform1f(P.u.u_emit, near);
        gl.bindVertexArray(m.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
        this.stats.draws++;
      }
    },

    /** 飛んでいるグレネード */
    _drawProjectiles(br) {
      const gl = this.gl, P = this.P.lit;
      const list = br.projectiles;
      if (!list || !list.length) return;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_cutout, 0); gl.uniform1f(P.u.u_wind, 0); gl.uniform1f(P.u.u_emit, 0);
      let m = this.lootMeshes['item:frag'];
      if (!m) m = this.lootMeshes['item:frag'] = GLC.mesh(gl, GLChar.lootMesh('item', 'frag'), this.LITL);
      list.forEach(pr => {
        if (!pr.alive || pr.kind !== 'frag') return;
        M4().trs(this.model, pr.x, pr.y, Math.max(0, pr.z - 0.07), this._t * 9 + pr.x, 1);
        gl.uniformMatrix4fv(P.u.u_model, false, this.model);
        gl.bindVertexArray(m.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      });
    },

    /** 弾痕（壁・地面に残る小さな穴。古い物から消える） */
    _decals: [],
    addDecal(x, y, z, n) {
      if (!n) return;
      this._decals.push({ x: x + n[0] * 0.02, y: y + n[1] * 0.02, z: z + n[2] * 0.02, n: n.slice(), t: 0, s: 0.032 + Math.random() * 0.012, r: Math.random() * 6.28 });
      if (this._decals.length > 90) this._decals.shift();
    },

    /** 爆発の閃光（加算の大きな光球 + 周りを照らす） */
    _blasts: [],
    addBlast(x, y, z) {
      this._blasts.push({ x, y, z: Math.max(0.3, z || 0.3), t: 0 });
      if (this._blasts.length > 6) this._blasts.shift();
    },

    _drawPlane(br) {
      const pl = br.plane;
      if (!pl || pl.done) return;
      const gl = this.gl, P = this.P.lit;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_cutout, 0); gl.uniform1f(P.u.u_wind, 0); gl.uniform1f(P.u.u_emit, 0);
      const ang = Math.atan2(pl.dy, pl.dx);
      const z = pl.alt * ALT_K;
      M4().trs(this.model, pl.x, pl.y, z, ang, 1);
      gl.uniformMatrix4fv(P.u.u_model, false, this.model);
      gl.bindVertexArray(this.planeMeshGL.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.planeMeshGL.count);
      // プロペラ
      const ca = Math.cos(ang), sa = Math.sin(ang);
      [-6.2, -3.4, 3.4, 6.2].forEach((y, i) => {
        const px = pl.x + ca * 2.55 - sa * y, py = pl.y + sa * 2.55 + ca * y;
        const m = this.model;
        const spin = this._t * 40 + i;
        const cs = Math.cos(spin), ss = Math.sin(spin);
        // Z回転(機首方向) × X回転(プロペラ回転)
        m[0] = ca; m[1] = sa; m[2] = 0; m[3] = 0;
        m[4] = -sa * cs; m[5] = ca * cs; m[6] = ss; m[7] = 0;
        m[8] = sa * ss; m[9] = -ca * ss; m[10] = cs; m[11] = 0;
        m[12] = px; m[13] = py; m[14] = z + 1.17; m[15] = 1;
        gl.uniformMatrix4fv(P.u.u_model, false, m);
        gl.bindVertexArray(this.propMeshGL.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.propMeshGL.count);
      });
    },

    _drawZone(br) {
      const z = br.zone;
      if (!z) return;
      const gl = this.gl, P = this.P.zone;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform4f(P.u.u_zone, z.cx, z.cy, z.r, 60);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(this.zoneMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.zoneMesh.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },

    /* --- エフェクト（ビルボードをCPUで組んで2回で描く） --- */
    _fxN: 0,
    _fxPush(x, y, z, sx, sy, col, a, shape, rx, ry, rz, ux, uy, uz) {
      // 中心(x,y,z)、半径(sx,sy)、右ベクトル(r)・上ベクトル(u)で四角形
      const b = this.fxBuf;
      if (this._fxN + 60 > b.length) return;
      let n = this._fxN;
      const put = (px, py, pz, u, v) => {
        b[n++] = px; b[n++] = py; b[n++] = pz; b[n++] = u; b[n++] = v;
        b[n++] = col[0]; b[n++] = col[1]; b[n++] = col[2]; b[n++] = a; b[n++] = shape;
      };
      const ax = rx * sx, ay = ry * sx, az = rz * sx, bx = ux * sy, by = uy * sy, bz = uz * sy;
      put(x - ax - bx, y - ay - by, z - az - bz, 0, 0);
      put(x + ax - bx, y + ay - by, z + az - bz, 1, 0);
      put(x + ax + bx, y + ay + by, z + az + bz, 1, 1);
      put(x - ax - bx, y - ay - by, z - az - bz, 0, 0);
      put(x + ax + bx, y + ay + by, z + az + bz, 1, 1);
      put(x - ax + bx, y - ay + by, z - az + bz, 0, 1);
      this._fxN = n;
    },
    _billboard(x, y, z, s, col, a, shape) {
      const c = this.cam;
      this._fxPush(x, y, z, s, s, col, a, shape, c.r[0], c.r[1], c.r[2], c.u[0], c.u[1], c.u[2]);
    },
    /** 線分をカメラに向けた帯として描く */
    _streak(x0, y0, z0, x1, y1, z1, w, col, a) {
      const c = this.cam;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz) || 1e-4;
      const tx = dx / len, ty = dy / len, tz = dz / len;
      const vx = (x0 + x1) / 2 - c.pos[0], vy = (y0 + y1) / 2 - c.pos[1], vz = (z0 + z1) / 2 - c.pos[2];
      let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      this._fxPush((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, len / 2, w, col, a, 1, tx, ty, tz, nx, ny, nz);
    },

    _hexCache: {},
    _col(hex) {
      let v = this._hexCache[hex];
      if (!v) { v = this._hexCache[hex] = GLC.lin(hex && hex[0] === '#' && hex.length === 7 ? hex : '#ffffff'); }
      return v;
    },

    _drawFx(br) {
      const gl = this.gl, P = this.P.fx, cam = this.cam, p = br.player;
      const add = [], alpha = [];
      // 1) 半透明（土煙・血・破片）
      this._fxN = 0;
      br.parts.forEach(pt => {
        if (!pt.alive && pt.alive !== undefined) return;
        const k = clamp(pt.life / pt.maxLife, 0, 1);
        if (pt.kind === 'dust') {
          const s = pt.size * 2.2 * (1.6 - k * 0.7);
          this._billboard(pt.x, pt.y, pt.z, s, this._col(pt.color), k * k * (pt.alpha || 0.5) * 0.8, 0);
        } else if (!pt.add && pt.kind !== 'spark') {
          this._billboard(pt.x, pt.y, pt.z, pt.size * 1.2, this._col(pt.color), k, 4);
        }
      });
      // 血しぶき（加算ではなく暗い赤）
      br.parts.forEach(pt => {
        if (pt.add && pt.grav === 4.5) {
          const k = clamp(pt.life / pt.maxLife, 0, 1);
          this._billboard(pt.x, pt.y, pt.z, pt.size * 2.4, [0.35, 0.02, 0.02], k * 0.9, 0);
        }
      });
      // 弾痕（半透明。法線の向きに貼る）
      const dts = 1 / 60;
      this._decals.forEach(dc => {
        dc.t += dts;
        const a = clamp(1 - (dc.t - 25) / 5, 0, 1) * 0.9;
        if (a <= 0) return;
        const n = dc.n;
        let rx, ry, rz, ux, uy, uz;
        if (Math.abs(n[2]) > 0.5) { rx = 1; ry = 0; rz = 0; ux = 0; uy = 1; uz = 0; }
        else { rx = -n[1]; ry = n[0]; rz = 0; ux = 0; uy = 0; uz = 1; }
        const c = Math.cos(dc.r), sn = Math.sin(dc.r);
        const Rx = rx * c + ux * sn, Ry = ry * c + uy * sn, Rz = rz * c + uz * sn;
        const Ux = ux * c - rx * sn, Uy = uy * c - ry * sn, Uz = uz * c - rz * sn;
        this._fxPush(dc.x, dc.y, dc.z, dc.s, dc.s, [0.03, 0.028, 0.025], a, 5, Rx, Ry, Rz, Ux, Uy, Uz);
      });
      this._decals = this._decals.filter(dc => dc.t < 30);
      const nAlpha = this._fxN;
      void alpha;
      // 2) 加算（火花・弾道・マズルフラッシュ）
      br.parts.forEach(pt => {
        const k = clamp(pt.life / pt.maxLife, 0, 1);
        if (pt.kind === 'spark') {
          const vx = pt.vx || 0, vy = pt.vy || 0, vz = pt.vz || 0;
          const l = 0.035;
          this._streak(pt.x, pt.y, pt.z, pt.x - vx * l, pt.y - vy * l, pt.z - vz * l, pt.size * 0.35, [1.6, 1.1, 0.5], k);
        } else if (pt.add && pt.grav !== 4.5) {
          this._billboard(pt.x, pt.y, pt.z, pt.size * 1.4, this._col(pt.color), k * 1.4, 0);
        }
      });
      // 弾道（弾が飛んでいく光の筋）
      br.tracers.forEach(t => {
        const s = this._tracerStart(t, br);
        if (!s) return;
        const age = 1 - clamp(t.life / t.maxLife, 0, 1);
        const ex = t.x1, ey = t.y1, ez = t.z1 != null ? t.z1 : 0.6;
        const k0 = clamp(age * 1.6 - 0.35, 0, 1), k1 = clamp(age * 1.6 + 0.15, 0, 1);
        const ax = s[0] + (ex - s[0]) * k0, ay = s[1] + (ey - s[1]) * k0, az = s[2] + (ez - s[2]) * k0;
        const bx = s[0] + (ex - s[0]) * k1, by = s[1] + (ey - s[1]) * k1, bz = s[2] + (ez - s[2]) * k1;
        this._streak(ax, ay, az, bx, by, bz, 0.018, [2.2, 1.7, 0.9], 0.9);
      });
      // 他人のマズルフラッシュ
      br.combatants.forEach(c => {
        if (c === p && cam.mode === 'fpp') return;
        if (!(c.flashT > 0.02) || !c._gl || !c._gl.muzzle || c._gl.frame !== this._frame) return;
        const m = c._gl.muzzle;
        this._billboard(m[0], m[1], m[2], 0.16 + Math.random() * 0.08, [2.4, 1.6, 0.7], clamp(c.flashT * 9, 0, 1), 3);
      });
      // 爆発
      this._blasts.forEach(b => {
        const k = 1 - clamp(b.t / 0.45, 0, 1);
        if (k <= 0) return;
        this._billboard(b.x, b.y, b.z + 0.3, 1.2 + (1 - k) * 2.2, [3.0, 1.6, 0.5], k, 0);
        this._billboard(b.x, b.y, b.z + 0.2, 0.6 + (1 - k) * 1.2, [3.5, 2.8, 1.6], k * k, 3);
      });
      // 足元のLoot（レア度の輪）
      const RAR = BRDATA.RARITY;
      const list = br.pickups || [];
      if (cam.mode !== 'plane' && cam.mode !== 'drop') {
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          const dx = l.x - cam.pos[0], dy = l.y - cam.pos[1];
          const d2 = dx * dx + dy * dy;
          if (d2 > 400) continue;
          const tier = l.tier || 'common';
          if (tier === 'common' && d2 > 16) continue;
          const col = this._col(RAR[tier] ? RAR[tier].color : '#ffffff');
          this._fxPush(l.x, l.y, 0.02, 0.32, 0.32, col, tier === 'common' ? 0.25 : 0.55, 2, 1, 0, 0, 0, 1, 0);
        }
      }

      const n = this._fxN;
      if (n === 0) return;
      GLC.update(gl, this.fxMesh, this.fxBuf, n);
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.bindVertexArray(this.fxMesh.vao);
      if (nAlpha > 0) {
        gl.uniform1f(P.u.u_add, 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
        gl.drawArrays(gl.TRIANGLES, 0, nAlpha / 10);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      if (n > nAlpha) {
        gl.uniform1f(P.u.u_add, 1);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, nAlpha / 10, (n - nAlpha) / 10);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.stats.draws += 2;
      void add;
    },

    _tracerStart(t, br) {
      if (t.x0 != null) return [t.x0, t.y0, t.z0];
      const src = t.src;
      if (src && src._gl && src._gl.muzzle && src !== br.player) return src._gl.muzzle;
      if (src === br.player || !src) {
        const c = this.cam;
        if (this._vmMuzzle && c.mode === 'fpp') return this._vmMuzzle;
        if (src && src._gl && src._gl.muzzle) return src._gl.muzzle;
        return [c.pos[0] + c.f[0] * 0.5 + c.r[0] * 0.15, c.pos[1] + c.f[1] * 0.5 + c.r[1] * 0.15, c.pos[2] - 0.12];
      }
      return [src.x, src.y, 0.62];
    },

    /* --- 一人称の腕と銃 --- */
    _drawViewModel(br) {
      const gl = this.gl, p = br.player, cam = this.cam;
      const w = p.weapons[p.wIdx];
      if (!w) { this._vmMuzzle = null; return; }
      const cls = w.def.cls || 'AR';
      const zoomT = br.zoomT || 0;
      if (zoomT > 0.7 && (w.def.zoom || 1) > 1.5) { this._vmMuzzle = null; return; }   // スコープ中は消す
      const look = p._look || (p._look = GLChar.lookFor(p));
      const vm = GLChar.vmMesh(cls, look);
      if (!vm.gl) vm.gl = GLC.mesh(gl, vm.data, this.CHARL);

      // 視点空間での置き場所（+X 前 / +Y 左 / +Z 上）
      const ads = zoomT;
      const bob = p.bobPhase || 0, amp = p.bobAmp || 0;
      const rec = p.recoilVis || 0;
      let dip = 0, roll = 0;
      if (p.reloading && p.reloadTotal) {
        const rl = Math.sin(clamp(1 - p.reloadLeft / p.reloadTotal, 0, 1) * Math.PI);
        dip += rl * 0.07; roll += rl * 0.6;
      }
      if (p.switchT > 0 && p.switchTotal) {
        const k = Math.sin(clamp(p.switchT / p.switchTotal, 0, 1) * Math.PI);
        dip = Math.max(dip, k * 0.12); roll = Math.max(roll, k * 0.4);
      }
      if (p.useT > 0) dip = Math.max(dip, 0.1);
      const sprint = p.sprinting ? 1 : 0;
      // 照準器の高さ（銃ごとに違う）: ADSで目線の真下に来るように
      const sightH = { SMG: 0.050, AR: 0.062, DMR: 0.062, SNIPER: 0.075, PISTOL: 0.024, SHOTGUN: 0.030, LMG: 0.044 }[cls] || 0.05;
      const ox = 0.40 - ads * 0.10 - rec * 0.018 - dip * 0.2;
      const oy = -0.150 * (1 - ads) + Math.sin(bob) * 0.012 * amp * (1 - ads * 0.8) + sprint * 0.04;
      const oz = -0.118 * (1 - ads) - sightH * ads - Math.abs(Math.cos(bob)) * 0.010 * amp - dip - rec * 0.006 - sprint * 0.03;
      const yawV = (-0.08 * (1 - ads) + sprint * 0.55) + Math.sin(bob * 0.5) * 0.01 * amp;
      const pitV = 0.03 * (1 - ads) + rec * 0.05 - sprint * 0.35;
      // 行列（視点空間）: 銃の -Z を前(+X)へ、+X(上) を上(+Z)へ
      const cy = Math.cos(yawV), sy = Math.sin(yawV), cp = Math.cos(pitV), sp = Math.sin(pitV);
      const fwd = [cy * cp, sy * cp, sp];
      const cr = Math.cos(roll), sr = Math.sin(roll);
      let up = [-sp * cy, -sp * sy, cp];
      const lft = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
      up = [up[0] * cr + lft[0] * sr, up[1] * cr + lft[1] * sr, up[2] * cr + lft[2] * sr];
      const left = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
      // 銃ローカル (x=上, y=左, z=後ろ) → 視点空間
      const Lx = up, Ly = left, Lz = [-fwd[0], -fwd[1], -fwd[2]];
      // 視点空間 (前, 左, 上) → 世界
      const F = cam.f, Lw = [-cam.r[0], -cam.r[1], -cam.r[2]], U = cam.u;
      const toW = v => [F[0] * v[0] + Lw[0] * v[1] + U[0] * v[2], F[1] * v[0] + Lw[1] * v[1] + U[1] * v[2], F[2] * v[0] + Lw[2] * v[1] + U[2] * v[2]];
      const S = 1.0;
      const cx = toW(Lx), cyv = toW(Ly), cz = toW(Lz), org = toW([ox, oy, oz]);
      const B = this.bones;
      B[0] = cx[0] * S; B[1] = cx[1] * S; B[2] = cx[2] * S; B[3] = 0;
      B[4] = cyv[0] * S; B[5] = cyv[1] * S; B[6] = cyv[2] * S; B[7] = 0;
      B[8] = cz[0] * S; B[9] = cz[1] * S; B[10] = cz[2] * S; B[11] = 0;
      B[12] = cam.pos[0] + org[0]; B[13] = cam.pos[1] + org[1]; B[14] = cam.pos[2] + org[2]; B[15] = 1;
      const mz = vm.muzzle;
      this._vmMuzzle = [B[12] + B[0] * mz[0] + B[4] * mz[1] + B[8] * mz[2], B[13] + B[1] * mz[0] + B[5] * mz[1] + B[9] * mz[2], B[14] + B[2] * mz[0] + B[6] * mz[1] + B[10] * mz[2]];

      // 専用の狭い画角で、深度を消して手前に描く
      const aspect = this.W / this.H;
      const fy = 2 * (cam.zoom || 1) * 1.08, fx = fy / aspect;
      const proj = M4().persp(M4().create(), fx, fy, 0.01, 10);
      const vpSave = this.vp;
      this.vp = M4().mul(M4().create(), proj, this.viewM);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const P = this.P.char;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_alpha, 1);
      gl.uniform4f(P.u.u_tint, 0, 0, 0, 0);
      gl.uniform1f(P.u.u_shadowK, 0.85);
      gl.uniform1f(P.u.u_fill, 0.55);
      gl.uniformMatrix4fv(P.u.u_bones, false, B);
      gl.bindVertexArray(vm.gl.vao);
      gl.drawArrays(gl.TRIANGLES, 0, vm.gl.count);
      // マズルフラッシュ
      if (p.flashT > 0.02) {
        this._fxN = 0;
        const m = this._vmMuzzle;
        const s = 0.09 + Math.random() * 0.05;
        this._billboard(m[0] + cam.f[0] * 0.03, m[1] + cam.f[1] * 0.03, m[2] + cam.f[2] * 0.03, s, [3.0, 2.0, 0.9], clamp(p.flashT * 9, 0, 1), 3);
        GLC.update(gl, this.fxMesh, this.fxBuf, this._fxN);
        const FP = this.P.fx;
        gl.useProgram(FP.p);
        this._uniformsCommon(FP);
        gl.uniform1f(FP.u.u_add, 1);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        gl.bindVertexArray(this.fxMesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this._fxN / 10);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      this.vp = vpSave;
      this.stats.vm = 1;
    },

    /* =================================================================
     * ロビー（自分のキャラクターを飾る）
     * =============================================================== */
    renderLobby(t, dummy) {
      if (!this.ok) return false;
      const gl = this.gl;
      if (!this._lobbyMap) {
        // 小さな舞台: 人物の後ろに林と小屋と木箱を置く（当たり判定は使わない）
        const w = 40, grid = new Uint8Array(w * w), deco = new Uint8Array(w * w);
        const R = WorldTex.mulberry(99);
        for (let i = 0; i < 70; i++) {
          const x = 2 + ((R() * (w - 4)) | 0), y = 2 + ((R() * 13) | 0);
          if (x > 8 && x < 17 && y > 4) continue;
          grid[y * w + x] = 2; deco[y * w + x] = 1;
        }
        [[23, 16], [24, 16], [23, 15], [15, 17]].forEach(([x, y]) => { grid[y * w + x] = 3; deco[y * w + x] = 3; });
        const bd = { x: 8, y: 7, bw: 8, bh: 6, area: 'village', key: 'village', partX: -1 };
        for (let x = bd.x; x < bd.x + bd.bw; x++) { grid[bd.y * w + x] = 1; grid[(bd.y + bd.bh - 1) * w + x] = 1; }
        for (let y = bd.y; y < bd.y + bd.bh; y++) { grid[y * w + bd.x] = 1; grid[y * w + bd.x + bd.bw - 1] = 1; }
        grid[(bd.y + bd.bh - 1) * w + 11] = 0; grid[(bd.y + bd.bh - 1) * w + 12] = 0;
        this._lobbyMap = { lobby: true, w, h: w, grid, seed: 777, deco, buildings: [bd],
          landmarks: [{ key: 'village', name: '', x: 20, y: 30, r: 3 }], lootSpots: [], spawnable: [], center: { x: 20, y: 20 } };
      }
      this.setMap(this._lobbyMap);
      this._t = t;
      this._frame++;
      const a = t * 0.1;
      const c = dummy;
      c.x = 20; c.y = 20; c.animT = t;
      // 南から北を見る。人物は画面の左寄り（右側はメニュー）
      const look = -Math.PI / 2 + Math.sin(a) * 0.06;
      c.ang = look + Math.PI - 0.45;
      const d = 2.3;
      const yaw = look + 0.30;
      const pos = [c.x - Math.cos(look) * d, c.y - Math.sin(look) * d, 0.62];
      this._setCamera(pos, yaw, 0.02, 1.25, 0.05, 500);
      this._fogDen = 0.006;
      this._shadowOn = true;
      this._renderShadow({ map: this._lobbyMap, combatants: [c] }, [{ c, dist: 1 }]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      this._drawSky({ clouds: true });
      this._drawGround();
      this._drawStatic();
      this._drawGrass(this._qual().grass ? 3000 : 0);
      this._drawCutout();
      this._drawWater();
      const P = this.P.char;
      gl.useProgram(P.p);
      this._uniformsCommon(P);
      gl.uniform1f(P.u.u_shadowK, 1);
      gl.uniform1f(P.u.u_fill, 0.12);
      gl.uniform1f(P.u.u_alpha, 1);
      gl.uniform4f(P.u.u_tint, 0, 0, 0, 0);
      const lk = this.poseChar(c, null);
      const mesh = this._charMesh(c, lk, 0);
      gl.uniformMatrix4fv(P.u.u_bones, false, this.bones);
      gl.bindVertexArray(mesh.gl.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.gl.count);
      return true;
    },

    /* =================================================================
     * 当たり判定（描いたカメラと同じ光線で取る）
     * =============================================================== */
    /**
     * 画面座標 (sx, sy)（Render の内部解像度）を通る光線で撃つ。
     * @returns {{hit, head, wx, wy, wz, c, t}}
     */
    ray(sx, sy) {
      const cam = this.cam, R = Render;
      const D = R.H * (cam.zoom || 1);
      const nx = (sx - R.W / 2) / D, ny = -(sy - R.H / 2) / D;
      let dx = cam.f[0] + cam.r[0] * nx + cam.u[0] * ny;
      let dy = cam.f[1] + cam.r[1] * nx + cam.u[1] * ny;
      let dz = cam.f[2] + cam.r[2] * nx + cam.u[2] * ny;
      const l = Math.hypot(dx, dy, dz);
      return { o: cam.pos.slice(), d: [dx / l, dy / l, dz / l] };
    },

    /** 光線と壁/地面の最初の交点までの距離 */
    rayWorld(br, o, d, maxT) {
      const map = br.map, H = this.tileH;
      let t = maxT;
      const N = this._rayN || (this._rayN = [0, 0, 1]);
      N[0] = 0; N[1] = 0; N[2] = 1;
      this._rayTile = 0; this._rayProp = null;
      // 地面
      if (d[2] < -1e-4) t = Math.min(t, -o[2] / d[2]);
      // グリッドを水平に辿り、セルの高さより下を通るなら当たり
      const hl = Math.hypot(d[0], d[1]);
      if (hl > 1e-5) {
        const rdx = d[0] / hl, rdy = d[1] / hl;
        let mapX = Math.floor(o[0]), mapY = Math.floor(o[1]);
        const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
        let stepX, stepY, sdx, sdy;
        if (rdx < 0) { stepX = -1; sdx = (o[0] - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - o[0]) * ddx; }
        if (rdy < 0) { stepY = -1; sdy = (o[1] - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - o[1]) * ddy; }
        let hd = 0, side = 0;
        for (let guard = 0; guard < 400; guard++) {
          const enter = hd;
          if (sdx < sdy) { hd = sdx; sdx += ddx; mapX += stepX; side = 0; } else { hd = sdy; sdy += ddy; mapY += stepY; side = 1; }
          const tEnter = hd / hl;
          if (tEnter > t) break;
          if (mapX < 0 || mapY < 0 || mapX >= map.w || mapY >= map.h) break;
          const i = mapY * map.w + mapX;
          const tile = map.grid[i];
          if (!tile || tile === 4) continue;
          const tExit = Math.min(sdx, sdy) / hl;
          const pr = this.props && this.props[i];
          if (pr && tile !== 1) {
            const th = this._hitProp(pr, o, d, tEnter, Math.min(tExit, t));
            if (th >= 0 && th < t) { t = th; this._rayTile = tile; this._rayProp = pr.t; break; }
            continue;
          }
          const top = H ? (H[i] || 1.2) : 1.2;
          const zIn = o[2] + d[2] * tEnter;
          const zOut = o[2] + d[2] * tExit;
          if (Math.min(zIn, zOut) < top) {
            // 入った面で当たる（上から入る場合は天面）
            this._rayTile = tile; this._rayProp = null;
            if (zIn < top) {
              if (tEnter < t) { t = tEnter; N[0] = side === 0 ? -stepX : 0; N[1] = side === 1 ? -stepY : 0; N[2] = 0; }
            } else {
              const tt = (top - o[2]) / d[2];
              if (tt < t) { t = tt; N[0] = 0; N[1] = 0; N[2] = 1; }
            }
            break;
          }
          void enter;
        }
      }
      return t;
    },

    /**
     * セルの中の小物（幹・岩・木箱）と光線の交差。見た目の形に近い単純形状で取る。
     * @returns {number} 当たった距離（外れたら -1）。法線は this._rayN に入れる
     */
    _hitProp(pr, o, d, t0, t1) {
      const N = this._rayN;
      if (pr.t === 'cyl') {
        const ox = o[0] - pr.cx, oy = o[1] - pr.cy;
        const a = d[0] * d[0] + d[1] * d[1];
        if (a < 1e-9) return -1;
        const b = ox * d[0] + oy * d[1], c = ox * ox + oy * oy - pr.r * pr.r;
        const disc = b * b - a * c;
        if (disc < 0) return -1;
        const sq = Math.sqrt(disc);
        const tin = (-b - sq) / a, tout = (-b + sq) / a;
        if (tout < t0 || tin > t1) return -1;
        const zi = o[2] + d[2] * Math.max(tin, t0);
        if (tin >= t0 && zi < pr.h && zi >= 0) {
          const hx = ox + d[0] * tin, hy = oy + d[1] * tin, l = Math.hypot(hx, hy) || 1;
          N[0] = hx / l; N[1] = hy / l; N[2] = 0;
          return tin;
        }
        // 上から天面に入る
        if (d[2] < 0) {
          const tt = (pr.h - o[2]) / d[2];
          if (tt >= Math.max(tin, t0) && tt <= Math.min(tout, t1)) { N[0] = 0; N[1] = 0; N[2] = 1; return tt; }
        }
        return -1;
      }
      // 箱（下段 + 上段）
      let best = -1;
      const slab = (hx, hy, z0, z1) => {
        let tmin = t0, tmax = t1, ax = -1;
        const lo = [pr.cx - hx, pr.cy - hy, z0], hi = [pr.cx + hx, pr.cy + hy, z1];
        for (let k = 0; k < 3; k++) {
          if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return; continue; }
          let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
          if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > tmin) { tmin = ta; ax = k; }
          if (tb < tmax) tmax = tb;
          if (tmin > tmax) return;
        }
        if (best < 0 || tmin < best) {
          best = tmin;
          N[0] = ax === 0 ? -Math.sign(d[0]) : 0; N[1] = ax === 1 ? -Math.sign(d[1]) : 0; N[2] = ax === 2 ? -Math.sign(d[2]) : 0;
        }
      };
      slab(pr.hx, pr.hy, 0, pr.h);
      if (pr.h2 > pr.h && pr.hx2 > 0) slab(pr.hx2, pr.hx2, pr.h, pr.h2);
      return best;
    },

    /** 光線とカプセルの交差（最初に触れる距離）。外れたら -1 */
    _rayCapsule(o, d, a, b, r) {
      // 光線(o + d t)と線分(a + v s)の最近点を求め、半径 r 以内なら当たり
      const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
      const wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
      const bb = d[0] * vx + d[1] * vy + d[2] * vz;
      const cc = vx * vx + vy * vy + vz * vz;
      const dd = d[0] * wx + d[1] * wy + d[2] * wz;
      const ee = vx * wx + vy * wy + vz * wz;
      const den = cc - bb * bb;
      let s = den > 1e-9 ? (ee - bb * dd) / den : 0;
      s = clamp(s, 0, 1);
      const t = s * bb - dd;
      if (t < 0) return -1;
      const px = o[0] + d[0] * t - (a[0] + vx * s), py = o[1] + d[1] * t - (a[1] + vy * s), pz = o[2] + d[2] * t - (a[2] + vz * s);
      const dist2 = px * px + py * py + pz * pz;
      if (dist2 > r * r) return -1;
      return Math.max(0, t - Math.sqrt(Math.max(0, r * r - dist2)));
    },

    /**
     * 射撃の判定。Render と同じ画面座標を受け取り、3Dの光線で人物と壁を調べる。
     * aim: エイムアシスト倍率（胴と手足の太さに掛ける。頭は控えめ）
     */
    hitscan(br, sx, sy, w, aim) {
      const R = this.ray(sx, sy);
      const o = R.o, d = R.d;
      const maxR = w.def.range * 2 + 12;
      const p = br.player;
      // 三人称では、自分より手前の物には当てない（肩越し視点の裏技を防ぐ）
      let tMin = 0;
      if (this.cam.tpp) {
        const ex = p.x - o[0], ey = p.y - o[1];
        tMin = Math.max(0, (ex * d[0] + ey * d[1]) - 0.2);
      }
      const tWall = this.rayWorld(br, [o[0] + d[0] * tMin, o[1] + d[1] * tMin, o[2] + d[2] * tMin], d, maxR) + tMin;
      let best = null, bestT = tWall;
      const k = aim || 1;
      for (let i = 0; i < br.combatants.length; i++) {
        const c = br.combatants[i];
        if (c === p || !c.alive || c.state !== 'ground') continue;
        const st = c._gl;
        if (!st || !st.caps || !st.caps.length) continue;
        const dx = c.x - o[0], dy = c.y - o[1];
        if (dx * dx + dy * dy > (maxR + 2) * (maxR + 2)) continue;
        for (let j = 0; j < st.caps.length; j++) {
          const cp = st.caps[j];
          const rr = cp.k === 'head' ? cp.r * (1 + (k - 1) * 0.35) : cp.r * k;
          const t = this._rayCapsule(o, d, cp.a, cp.b, rr);
          if (t < 0 || t < tMin || t >= bestT) continue;
          bestT = t; best = { c, part: cp.k, t };
        }
      }
      if (best) {
        return { hit: true, c: best.c, head: best.part === 'head', leg: best.part === 'leg', t: best.t,
          wx: o[0] + d[0] * best.t, wy: o[1] + d[1] * best.t, wz: o[2] + d[2] * best.t };
      }
      const t = Math.min(tWall, maxR);
      const n = this._rayN ? this._rayN.slice() : [0, 0, 1];
      return { hit: false, wall: tWall < maxR, t, n, tile: this._rayTile, prop: this._rayProp, wx: o[0] + d[0] * (t - 0.02), wy: o[1] + d[1] * (t - 0.02), wz: o[2] + d[2] * (t - 0.02) };
    },

    /**
     * 今の画面を1枚描いて、画素の統計を返す（テストと自己診断用）。
     * 描いた直後に読むので preserveDrawingBuffer なしでも中身が取れる。
     * region: [x0,y0,x1,y1]（0..1）
     */
    sample(br, region) {
      if (!this.ok) return null;
      if (br) this.render(br, 0.0001);
      const gl = this.gl, W = this.W, H = this.H;
      const r = region || [0, 0, 1, 1];
      const x0 = Math.floor(r[0] * W), x1 = Math.max(x0 + 1, Math.floor(r[2] * W));
      const y0 = Math.floor((1 - r[3]) * H), y1 = Math.max(y0 + 1, Math.floor((1 - r[1]) * H));
      const w = x1 - x0, h = y1 - y0;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, sum2 = 0, n = 0;
      const uniq = new Set();
      for (let i = 0; i < px.length; i += 4 * 3) {
        const l = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
        sum += l; sum2 += l * l; n++;
        uniq.add((px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | (px[i + 2] >> 3));
      }
      const mean = sum / n;
      return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), uniq: uniq.size, w, h };
    },

    /** 当たり判定用の骨を最新にする（描画していない相手も含む） */
    refreshCaps(br) {
      if (!this.ok) return;
      br.combatants.forEach(c => {
        if (c === br.player || !c.alive || c.state !== 'ground') return;
        if (c._gl && c._gl.frame === this._frame) return;
        this.poseChar(c, br);
      });
    }
  };

  g.GL3D = GL3D;
})(window);
