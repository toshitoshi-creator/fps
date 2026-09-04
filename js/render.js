/* ===== render.js — raycasting 3D renderer (2D canvas, mobile-tuned) ===== */
(function (g) {
  'use strict';

  /* --- 地面の模様に使う値ノイズ（整数格子の乱数を滑らかに補間する） --- */
  const NOISE = new Float32Array(4096);
  (function () {
    let seed = 0x9e3779b9;
    for (let i = 0; i < NOISE.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      NOISE[i] = ((seed >>> 8) & 0xffff) / 65535;
    }
  })();
  function nAt(xi, yi) {
    return NOISE[((xi * 73856093) ^ (yi * 19349663)) & 4095];
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = nAt(xi, yi), b = nAt(xi + 1, yi);
    const c = nAt(xi, yi + 1), d = nAt(xi + 1, yi + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }

  const R = {
    canvas: null, ctx: null,
    W: 0, H: 0, cssW: 0, cssH: 0,
    scale: 1, stripe: 2, quality: 'AUTO',
    zbuf: null, rays: 0,
    tex: [], theme: null, floorGrid: true,
    use3d: false,               // 3Dキャラクター描画（BR側で有効化する）
    groundTex: false,           // 地面のフロアキャスト（BR側で有効化する）
    groundDirt: null,           // 土の色（テーマごとに設定）
    sun: null,                  // 太陽の向き [x,y,z]。空に光芒を描く
    cam: { x: 0, y: 0, dirX: 1, dirY: 0, planeX: 0, planeY: 1, D: 1, horizon: 0, eyeZ: .5, ang: 0 },
    _grad: { key: '', ceil: null, floor: null },
    fpsAvg: 60, _autoStep: 0,

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.resize();
      return this;
    },

    setQuality(q) { this.quality = q; this.resize(); },

    resize() {
      const c = this.canvas;
      const cw = Math.max(320, c.clientWidth || window.innerWidth);
      const ch = Math.max(200, c.clientHeight || window.innerHeight);
      this.cssW = cw; this.cssH = ch;
      let targetW;
      switch (this.quality) {
        case 'LOW': targetW = 400; this.stripe = 3; break;
        case 'MID': targetW = 560; this.stripe = 2; break;
        case 'HIGH': targetW = 800; this.stripe = 1; break;
        default: targetW = 560; this.stripe = 2; break;   // AUTO (adapts at runtime)
      }
      const s = Math.min(1, targetW / cw);
      this.W = Math.round(cw * s);
      this.H = Math.round(ch * s);
      c.width = this.W; c.height = this.H;
      this.rays = Math.ceil(this.W / this.stripe);
      this.zbuf = new Float32Array(this.rays + 2);
      this._grad.key = '';
      this.ctx.imageSmoothingEnabled = false;
    },

    // runtime auto quality: drop resolution if fps sags, raise if plenty of headroom
    autoTune(fps) {
      if (this.quality !== 'AUTO') return;
      this.fpsAvg = this.fpsAvg * 0.94 + fps * 0.06;
      this._autoStep++;
      if (this._autoStep < 90) return;
      this._autoStep = 0;
      if (this.fpsAvg < 42 && this.stripe < 4) { this.stripe++; this.rays = Math.ceil(this.W / this.stripe); this.zbuf = new Float32Array(this.rays + 2); }
      else if (this.fpsAvg > 57 && this.stripe > 1) { this.stripe--; this.rays = Math.ceil(this.W / this.stripe); this.zbuf = new Float32Array(this.rays + 2); }
    },

    setStage(theme) {
      this.theme = theme;
      this.tex = Sprites.makeWallTextures(theme);
      this._grad.key = '';
    },

    /* ---------- camera ---------- */
    // 自分の3Dモデルを目視で確認するための三人称オフセット（既定は0＝一人称）
    thirdPerson: 0,
    showSelf: false,
    updateCamera(p, shakeYaw, shakePitch, zoom) {
      const cam = this.cam;
      const ang = p.ang + (shakeYaw || 0);
      cam.ang = ang;
      cam.x = p.x; cam.y = p.y;
      if (this.thirdPerson > 0) {
        cam.x -= Math.cos(ang) * this.thirdPerson;
        cam.y -= Math.sin(ang) * this.thirdPerson;
      }
      cam.dirX = Math.cos(ang); cam.dirY = Math.sin(ang);
      cam.D = this.H * (zoom || 1);
      const pl = (this.W / 2) / cam.D;
      cam.planeX = -cam.dirY * pl; cam.planeY = cam.dirX * pl;
      cam.planeLen = pl;
      cam.horizon = this.H / 2 + (p.pitch + (shakePitch || 0)) * this.H;
      cam.eyeZ = p.eyeZ;
    },

    /* project a world point -> screen. returns null when behind camera */
    project(wx, wy) {
      const c = this.cam;
      const rx = wx - c.x, ry = wy - c.y;
      const det = c.planeX * c.dirY - c.dirX * c.planeY;
      if (!det) return null;
      const inv = 1 / det;
      const tx = inv * (c.dirY * rx - c.dirX * ry);
      const ty = inv * (-c.planeY * rx + c.planeX * ry);   // depth
      if (ty <= 0.02) return null;
      return { sx: (this.W / 2) * (1 + tx / ty), depth: ty, lineH: c.D / ty };
    },

    zAt(sx) {
      const i = U.clamp(Math.floor(sx / this.stripe), 0, this.rays - 1);
      return this.zbuf[i];
    },

    /* ---------- DDA raycast against the grid ---------- */
    cast(map, ox, oy, rdx, rdy, maxDist) {
      let mapX = ox | 0, mapY = oy | 0;
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (ox - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - ox) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (oy - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - oy) * ddy; }
      let side = 0, tile = 0, guard = 0;
      const lim = maxDist || 64;
      while (guard++ < 256) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= map.w || mapY >= map.h) return { dist: lim, side, tile: 1, hit: false };
        tile = map.grid[mapY * map.w + mapX];
        if (tile) {
          const dist = side === 0 ? (sdx - ddx) : (sdy - ddy);
          if (dist > lim) return { dist: lim, side, tile: 1, hit: false };
          return { dist, side, tile, mapX, mapY, hit: true };
        }
        if ((side === 0 ? sdx : sdy) > lim) return { dist: lim, side, tile: 1, hit: false };
      }
      return { dist: lim, side, tile: 1, hit: false };
    },

    /* line-of-sight between two world points (walls block) */
    los(map, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) return true;
      const r = this.cast(map, ax, ay, dx / d, dy / d, d);
      return !r.hit || r.dist >= d - 0.03;
    },

    /* ---------- main frame ---------- */
    renderWorld(game) {
      const x = this.ctx, W = this.W, H = this.H, cam = this.cam, map = game.map;
      // setStage 前に描画要求が来ても落ちないよう、既定のテーマを用意する
      if (!this.theme) this.setStage({
        ceil: '#0b1622', ceil2: '#16304a', floor: '#1a2430', floor2: '#26343f',
        fog: '#0b1622', walls: ['#5b6a78', '#4a5a68', '#6b7a88', '#3f4d5a']
      });
      const th = this.theme;
      const horizon = cam.horizon;

      /* --- ceiling & floor --- */
      const key = W + 'x' + H + ':' + Math.round(horizon);
      if (this._grad.key !== key) {
        const cg = x.createLinearGradient(0, 0, 0, Math.max(1, horizon));
        cg.addColorStop(0, th.ceil2); cg.addColorStop(1, th.ceil);
        const fg = x.createLinearGradient(0, horizon, 0, H);
        fg.addColorStop(0, th.floor2); fg.addColorStop(0.35, th.floor); fg.addColorStop(1, Sprites.shade(th.floor, 18));
        this._grad = { key, ceil: cg, floor: fg };
      }
      x.fillStyle = this._grad.ceil;
      x.fillRect(0, 0, W, Math.max(0, Math.min(H, horizon)));
      x.fillStyle = this._grad.floor;
      const fy = U.clamp(horizon, 0, H);
      x.fillRect(0, fy, W, H - fy);

      // 地面。1/4解像度でフロアキャストして、草・土・小石のむらを描く。
      // 世界座標から色を決めるので、歩くと模様がきちんと流れる。
      if (this.groundTex && horizon < H - 2) this.renderFloor(game, horizon);
      else if (this.floorGrid && horizon < H) {
        x.save();
        const eye = cam.eyeZ * cam.D;
        for (let k = 1; k <= 16; k++) {
          const y0 = horizon + eye / (k + 1), y1 = horizon + eye / k;
          if (y1 < fy) continue;
          if (y0 > H) break;
          const a = U.clamp(1 - k / 17, 0, 1) * 0.14;
          x.fillStyle = (k % 2) ? 'rgba(255,255,255,' + a.toFixed(3) + ')'
            : 'rgba(0,0,0,' + (a * 0.55).toFixed(3) + ')';
          x.fillRect(0, Math.max(fy, y0), W, Math.min(H, y1) - Math.max(fy, y0));
        }
        x.restore();
      }
      // 太陽の光芒。空が単なるグラデーションに見えないようにする
      if (this.sun && horizon > 0) {
        const sa = Math.atan2(this.sun[1], this.sun[0]);
        let da = sa - cam.ang;
        while (da > Math.PI) da -= U.TAU;
        while (da < -Math.PI) da += U.TAU;
        if (Math.abs(da) < 1.35) {
          const sx2 = W / 2 + Math.tan(da) * (W / 2) / (cam.planeLen || 0.66);
          const sy2 = horizon - H * 0.62 * (this.sun[2] || 0.8);
          const rad = Math.max(W, H) * 0.42;
          const gr2 = x.createRadialGradient(sx2, sy2, 1, sx2, sy2, rad);
          gr2.addColorStop(0, 'rgba(255,250,225,.85)');
          gr2.addColorStop(0.12, 'rgba(255,240,200,.34)');
          gr2.addColorStop(0.45, 'rgba(255,235,190,.10)');
          gr2.addColorStop(1, 'rgba(255,235,190,0)');
          x.save();
          x.globalCompositeOperation = 'lighter';
          x.beginPath();
          x.rect(0, 0, W, Math.max(0, Math.min(H, horizon)));
          x.clip();
          x.fillStyle = gr2;
          x.fillRect(sx2 - rad, sy2 - rad, rad * 2, rad * 2);
          x.restore();
        }
      }

      // horizon haze
      if (horizon > -20 && horizon < H + 20) {
        x.globalAlpha = 0.5;
        const hg = x.createLinearGradient(0, horizon - H * 0.10, 0, horizon + H * 0.10);
        hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, th.fog); hg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = hg;
        x.fillRect(0, horizon - H * 0.10, W, H * 0.20);
        x.globalAlpha = 1;
      }

      /* --- walls --- */
      const SW = this.stripe, rays = this.rays;
      const fogR = th.fog;
      for (let i = 0; i < rays; i++) {
        const sx = i * SW;
        const camX = 2 * (sx + SW * 0.5) / W - 1;
        const rdx = cam.dirX + cam.planeX * camX;
        const rdy = cam.dirY + cam.planeY * camX;
        const hit = this.cast(map, cam.x, cam.y, rdx, rdy, 42);
        const dist = Math.max(0.06, hit.dist);
        this.zbuf[i] = dist;
        const lineH = cam.D / dist;
        const yBot = horizon + cam.eyeZ * lineH;
        const yTop = yBot - lineH;
        if (yBot < 0 || yTop > H) continue;

        const tex = this.tex[(hit.tile - 1) % this.tex.length] || this.tex[0];
        let wallX;
        if (hit.side === 0) wallX = cam.y + dist * rdy; else wallX = cam.x + dist * rdx;
        wallX -= Math.floor(wallX);
        let tx = (wallX * 64) | 0;
        if (hit.side === 0 && rdx > 0) tx = 63 - tx;
        if (hit.side === 1 && rdy < 0) tx = 63 - tx;

        const dy0 = Math.max(yTop, -2), dy1 = Math.min(yBot, H + 2);
        const srcY = ((dy0 - yTop) / lineH) * 64;
        const srcH = ((dy1 - dy0) / lineH) * 64;
        if (srcH <= 0) continue;
        x.drawImage(tex, tx, srcY, 1, srcH, sx, dy0, SW, dy1 - dy0);

        // distance fog + side shading
        // 近〜中距離は素の色を保ち、遠景だけ大気に溶かす（奥行きは出しつつ白飛びを防ぐ）
        const fogMax = this.floorGrid ? 0.46 : 0.58;
        let a = U.clamp((dist - 6) / 30, 0, fogMax);
        if (hit.side === 1) a = Math.min(fogMax + 0.1, a + 0.13);
        if (a > 0.02) {
          x.globalAlpha = a;
          x.fillStyle = fogR;
          x.fillRect(sx, dy0, SW, dy1 - dy0);
          x.globalAlpha = 1;
        }
      }
    },

    /* ---------- 地面（フロアキャスト） ---------- */
    // 補間つきの値ノイズ。格子が四角く見えないよう滑らかにつなぐ
    _vn: null,
    /**
     * 画面の下半分を粗い格子でサンプリングし、世界座標から地面色を決める。
     * 1ピクセルずつではなく 1/4 の解像度で塗ってから引き伸ばすので軽い。
     */
    renderFloor(game, horizon) {
      const cam = this.cam, W = this.W, H = this.H;
      const y0 = Math.max(0, Math.ceil(horizon));
      const fh = H - y0;
      if (fh <= 1) return;
      // 描画品質でサンプル間隔を変える（LOWほど粗く）
      const q = this.quality;
      const SX = q === 'LOW' ? 6 : (q === 'HIGH' ? 2 : 4), SY = q === 'HIGH' ? 1 : 2;
      const fw = Math.ceil(W / SX), fr = Math.ceil(fh / SY);
      if (!this._fl || this._fl.w !== fw || this._fl.h !== fr) {
        const cv = document.createElement('canvas');
        cv.width = fw; cv.height = fr;
        const cx2 = cv.getContext('2d');
        this._fl = { w: fw, h: fr, cv, ctx: cx2, img: cx2.createImageData(fw, fr) };
        this._fl.px = new Uint32Array(this._fl.img.data.buffer);
      }
      const F = this._fl, px = F.px;
      const th = this.theme;
      const g1 = Raster3D.hexRGB(th.floor), g2 = Raster3D.hexRGB(th.floor2);
      const fogc = Raster3D.hexRGB(th.fog);
      const dirt = this.groundDirt || [122, 104, 78];
      const camX0 = -1, camX1 = 1;
      const rdx0 = cam.dirX + cam.planeX * camX0, rdy0 = cam.dirY + cam.planeY * camX0;
      const rdx1 = cam.dirX + cam.planeX * camX1, rdy1 = cam.dirY + cam.planeY * camX1;
      const eyeD = cam.eyeZ * cam.D;
      const map = game.map;
      const mw = map ? map.w : 0, mh = map ? map.h : 0;

      for (let j = 0; j < fr; j++) {
        const sy = y0 + j * SY + 0.5;
        const rowD = eyeD / Math.max(0.5, sy - horizon);   // その行の距離
        if (rowD > 90) { for (let i = 0; i < fw; i++) px[j * fw + i] = 0; continue; }
        const fog = U.clamp((rowD - 8) / 34, 0, 0.66);
        const sx0 = cam.x + rdx0 * rowD, sy0 = cam.y + rdy0 * rowD;
        const stepX = (cam.x + rdx1 * rowD - sx0) / fw;
        const stepY = (cam.y + rdy1 * rowD - sy0) / fw;
        let wx = sx0, wy = sy0;
        const rowO = j * fw;
        for (let i = 0; i < fw; i++, wx += stepX, wy += stepY) {
          // なめらかな値ノイズを2オクターブ。歩くと模様が正しく流れる
          const n1 = vnoise(wx * 3.1, wy * 3.1);
          const n2 = vnoise(wx * 0.85, wy * 0.85);
          const patch = vnoise(wx * 0.24 + 11.3, wy * 0.24 - 7.1);
          const t = U.clamp(0.30 + n2 * 0.52 + n1 * 0.26, 0, 1);
          let r = g1[0] + (g2[0] - g1[0]) * t;
          let g3 = g1[1] + (g2[1] - g1[1]) * t;
          let b = g1[2] + (g2[2] - g1[2]) * t;
          if (patch > 0.60) {                    // 土がのぞくところ
            const k = U.clamp((patch - 0.60) / 0.30, 0, 1) * 0.9;
            const dv = 0.75 + n1 * 0.45;
            r += (dirt[0] * dv - r) * k;
            g3 += (dirt[1] * dv - g3) * k;
            b += (dirt[2] * dv - b) * k;
          }
          if (mw && wx > 1 && wy > 1 && wx < mw - 1 && wy < mh - 1) {
            const gx = wx | 0, gy = wy | 0;
            const tile = map.grid[gy * mw + gx];
            if (tile === 4) { r = r * 0.30 + 34; g3 = g3 * 0.42 + 86; b = b * 0.48 + 136; }
            else {
              // 壁ぎわを暗くして、建物と地面が接している感じを出す（簡易AO）
              const fx = wx - gx, fy = wy - gy;
              let ao = 0;
              if (fx < 0.34 && map.grid[gy * mw + gx - 1]) ao = Math.max(ao, (0.34 - fx) * 2.9);
              else if (fx > 0.66 && map.grid[gy * mw + gx + 1]) ao = Math.max(ao, (fx - 0.66) * 2.9);
              if (fy < 0.34 && map.grid[(gy - 1) * mw + gx]) ao = Math.max(ao, (0.34 - fy) * 2.9);
              else if (fy > 0.66 && map.grid[(gy + 1) * mw + gx]) ao = Math.max(ao, (fy - 0.66) * 2.9);
              if (ao > 0) { const k = 1 - ao * 0.42; r *= k; g3 *= k; b *= k; }
            }
          }
          if (fog > 0) { r += (fogc[0] - r) * fog; g3 += (fogc[1] - g3) * fog; b += (fogc[2] - b) * fog; }
          px[rowO + i] = 0xff000000 | ((b | 0) << 16) | ((g3 | 0) << 8) | (r | 0);
        }
      }
      F.ctx.putImageData(F.img, 0, 0);
      const x = this.ctx;
      const sm = x.imageSmoothingEnabled;
      x.imageSmoothingEnabled = true;             // 引き伸ばしをなめらかに
      x.drawImage(F.cv, 0, 0, fw, fr, 0, y0, W, fh);
      x.imageSmoothingEnabled = sm;
    },

    /* ---------- sprites (enemies / projectiles / pickups / particles) ---------- */
    renderSprites(game) {
      const x = this.ctx, W = this.W, H = this.H, cam = this.cam;
      const list = [];

      game.enemies.forEach(e => {
        if (e.state === 'dead' && e.deadT > 3.2) return;
        const p = this.project(e.x, e.y);
        if (!p || p.depth > 44) return;
        list.push({ kind: 'enemy', e, p });
      });
      if (this.showSelf && game.player) {
        const p = this.project(game.player.x, game.player.y);
        if (p && p.depth > 0.25) list.push({ kind: 'enemy', e: game.player, p });
      }
      game.projectiles.forEach(pr => {
        if (!pr.alive) return;
        const p = this.project(pr.x, pr.y);
        if (!p) return;
        list.push({ kind: 'proj', pr, p });
      });
      game.pickups.forEach(pk => {
        if (!pk.alive) return;
        const p = this.project(pk.x, pk.y);
        if (!p) return;
        list.push({ kind: 'pickup', pk, p });
      });
      (game.zones || []).forEach(z => {
        const p = this.project(z.x, z.y);
        if (!p) return;
        list.push({ kind: 'zone', z, p });
      });
      game.parts.forEach(pt => {
        if (!pt.alive) return;
        const p = this.project(pt.x, pt.y);
        if (!p) return;
        list.push({ kind: 'part', pt, p });
      });

      list.sort((a, b) => b.p.depth - a.p.depth);

      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.kind === 'enemy') this._drawEnemy(it.e, it.p, game);
        else if (it.kind === 'proj') this._drawProj(it.pr, it.p);
        else if (it.kind === 'pickup') this._drawPickup(it.pk, it.p);
        else if (it.kind === 'zone') this._drawZone(it.z, it.p, game);
        else this._drawParticle(it.pt, it.p);
      }
      x.globalAlpha = 1;
    },

    _occlVisible(x0, x1, depth) {
      // returns list of [sx, w] visible segments
      const segs = [];
      const SW = this.stripe;
      let i0 = Math.max(0, Math.floor(x0 / SW)), i1 = Math.min(this.rays - 1, Math.ceil(x1 / SW));
      let run = -1;
      for (let i = i0; i <= i1; i++) {
        const vis = this.zbuf[i] > depth;
        if (vis && run < 0) run = i;
        else if (!vis && run >= 0) { segs.push([run * SW, (i - run) * SW]); run = -1; }
      }
      if (run >= 0) segs.push([run * SW, (i1 + 1 - run) * SW]);
      return segs;
    },

    _drawEnemy(e, p, game) {
      const x = this.ctx, cam = this.cam, H = this.H;
      const set = Sprites.getEnemySprites(e.type);
      const def = e.def;
      const lineH = p.lineH;
      const spH = lineH * def.height * 1.06;
      const spW = spH * (set.w / set.h);
      const yBot = cam.horizon + cam.eyeZ * lineH;
      const yTop = yBot - spH;
      const x0 = p.sx - spW / 2, x1 = p.sx + spW / 2;
      if (x1 < -8 || x0 > this.W + 8 || yBot < -8 || yTop > H + 8) { e.scr = null; return; }

      // --- 3Dキャラクター（近〜中距離）。当たり判定に使う e.scr は
      //     従来どおりスプライト基準のままなので、撃ち心地は変わらない ---
      if (this.use3d && g.Char3D && Char3D.enabled) {
        const segs3 = this._occlVisible(x0, x1, p.depth);
        if (!segs3.length) { e.scr = null; return; }
        e.scr = { x0, x1, yTop, yBottom: yBot, depth: p.depth, sx: p.sx, h: spH };
        Char3D.shadow(this, e, p);
        const tint = (e.hurtT > 0 && e.state !== 'dead')
          ? { rgb: Raster3D.hexRGB(e.lastCrit ? '#ffd24a' : '#ff8a8a'), k: U.clamp(e.hurtT * 4.2, 0, 0.8) }
          : null;
        const box = Char3D.draw(this, e, p, { tint });
        if (box) {
          this._drawMuzzle3D(e, p);
          this._drawEnemyTags(e, p, spW, spH, yTop, def);
          return;
        }
      }

      let img;
      if (e.state === 'dead') {
        const f = U.clamp(Math.floor(e.deadT / 0.11), 0, 3);
        img = set.dead[f];
      } else if (e.hurtT > 0) img = set.hurt;
      else if (e.atkFlash > 0) img = set.attack;
      else if (e.moving) img = (Math.floor(e.animT * 6) % 2) ? set.walk1 : set.walk2;
      else img = set.stand;

      const segs = this._occlVisible(x0, x1, p.depth);
      if (!segs.length) { e.scr = null; return; }

      e.scr = { x0, x1, yTop, yBottom: yBot, depth: p.depth, sx: p.sx, h: spH };

      // fade-out on death
      let alpha = 1;
      if (e.state === 'dead') alpha = U.clamp(1 - (e.deadT - 2.2) / 1.0, 0, 1);
      x.globalAlpha = alpha;

      // 分割数が多いときは、まとめてクリップして1回で描く（drawImage回数の削減）
      if (segs.length > 4) {
        x.save();
        x.beginPath();
        for (let s = 0; s < segs.length; s++) x.rect(segs[s][0], yTop, segs[s][1], spH);
        x.clip();
        x.drawImage(img, 0, 0, set.w, set.h, x0, yTop, spW, spH);
        x.restore();
      } else {
        for (let s = 0; s < segs.length; s++) {
          const sx = segs[s][0], sw = segs[s][1];
          const u0 = (sx - x0) / spW, u1 = (sx + sw - x0) / spW;
          const su0 = U.clamp(u0, 0, 1) * set.w, su1 = U.clamp(u1, 0, 1) * set.w;
          if (su1 - su0 <= 0) continue;
          const dx0 = x0 + (su0 / set.w) * spW;
          x.drawImage(img, su0, 0, su1 - su0, set.h, dx0, yTop, (su1 - su0) / set.w * spW, spH);
        }
      }

      // hurt flash — tint the silhouette so the hit reads without a coloured box
      if (e.hurtT > 0 && e.state !== 'dead') {
        const fimg = e.lastCrit ? set.flashCrit : set.flashHit;
        x.save();
        x.globalAlpha = U.clamp(e.hurtT * 4.2, 0, 0.85) * alpha;
        x.globalCompositeOperation = 'lighter';
        for (let s2 = 0; s2 < segs.length; s2++) {
          const sx = segs[s2][0], sw = segs[s2][1];
          const su0 = U.clamp((sx - x0) / spW, 0, 1) * set.w;
          const su1 = U.clamp((sx + sw - x0) / spW, 0, 1) * set.w;
          if (su1 - su0 <= 0) continue;
          x.drawImage(fimg, su0, 0, su1 - su0, set.h,
            x0 + (su0 / set.w) * spW, yTop, (su1 - su0) / set.w * spW, spH);
        }
        x.restore();
      }
      x.globalAlpha = 1;

      if (e.state === 'dead') return;
      this._drawEnemyTags(e, p, spW, spH, yTop, def);
    },

    /** HPバーと警戒マーク。3D描画でもビルボードでも共通で使う */
    _drawEnemyTags(e, p, spW, spH, yTop, def) {
      if (e.state === 'dead') return;
      const x = this.ctx;
      const showBar = e.hp < e.maxHp || def.boss || e.showBarT > 0;
      if (showBar && p.depth < 26) {
        const bw = Math.max(20, spW * 0.72), bh = Math.max(3, spH * 0.035);
        const bx = p.sx - bw / 2, by = yTop - bh * 2.1;
        x.fillStyle = 'rgba(0,0,0,.65)'; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        const r = U.clamp(e.hp / e.maxHp, 0, 1);
        x.fillStyle = r > 0.5 ? '#4dff9a' : (r > 0.22 ? '#ffc23a' : '#ff3b46');
        x.fillRect(bx, by, bw * r, bh);
        if (def.boss) {
          x.fillStyle = '#ff6ad5'; x.fillRect(bx, by - bh - 2, bw, 2);
        }
      }
      if (e.alertT > 0 && p.depth < 26) {
        x.save();
        x.globalAlpha = U.clamp(e.alertT, 0, 1);
        x.fillStyle = '#ffdd44';
        x.font = 'bold ' + Math.max(12, spH * 0.20) + 'px sans-serif';
        x.textAlign = 'center';
        x.fillText('!', p.sx, yTop - spH * 0.10);
        x.restore();
      }
    },

    /** 3Dモデルの銃口から出る発砲光 */
    _drawMuzzle3D(e, p) {
      if (!(e.flashT > 0.005)) return;
      const w = Char3D.muzzleWorld(e);
      if (!w) return;
      const pr = this.project(w[0], w[1]);
      if (!pr || this.zAt(pr.sx) < pr.depth) return;
      const x = this.ctx;
      const y = this.cam.horizon + (this.cam.eyeZ - w[2]) * pr.lineH;
      const s = Math.max(3, pr.lineH * 0.10) * U.clamp(e.flashT * 3.4, 0.3, 1);
      x.save();
      x.globalCompositeOperation = 'lighter';
      const gr = x.createRadialGradient(pr.sx, y, 0.5, pr.sx, y, s * 2.4);
      gr.addColorStop(0, 'rgba(255,255,235,.95)');
      gr.addColorStop(0.35, 'rgba(255,196,90,.75)');
      gr.addColorStop(1, 'rgba(255,120,0,0)');
      x.fillStyle = gr;
      x.beginPath(); x.arc(pr.sx, y, s * 2.4, 0, 7); x.fill();
      x.restore();
    },

    _drawProj(pr, p) {
      const x = this.ctx, cam = this.cam;
      const lineH = p.lineH;
      const size = Math.max(2, lineH * pr.r * 2);
      const yc = cam.horizon + (cam.eyeZ - pr.z) * lineH;
      if (this.zAt(p.sx) < p.depth) return;
      x.save();
      x.globalCompositeOperation = 'lighter';
      const gr = x.createRadialGradient(p.sx, yc, 1, p.sx, yc, size * 2.2);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.28, pr.color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.beginPath(); x.arc(p.sx, yc, size * 2.2, 0, 7); x.fill();
      x.restore();
    },

    _drawPickup(pk, p) {
      const x = this.ctx, cam = this.cam;
      const lineH = p.lineH;
      if (this.zAt(p.sx) < p.depth) return;
      const s = lineH * 0.16;
      const yc = cam.horizon + (cam.eyeZ - 0.18 - Math.sin(pk.t * 3) * 0.05) * lineH;
      x.save();
      x.translate(p.sx, yc);
      x.rotate(pk.t * 1.6);
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = ({
        ammo: '#7fe3ff', health: '#4dff9a', power: '#ff5f7a',
        shield: '#8ab4ff', haste: '#ffd23f'
      })[pk.type] || '#ffd24a';
      x.shadowColor = x.fillStyle; x.shadowBlur = s;
      x.beginPath();
      x.moveTo(0, -s); x.lineTo(s * .8, 0); x.lineTo(0, s); x.lineTo(-s * .8, 0);
      x.closePath(); x.fill();
      x.restore();
    },

    /** 拠点・脱出地点。床の輪と光の柱で遠くからでも位置が分かるようにする */
    _drawZone(z, p, game) {
      const x = this.ctx, cam = this.cam;
      if (this.zAt(p.sx) < p.depth) return;
      if (p.depth < 0.9) return;              // 真上に立っている時は描かない
      const lineH = p.lineH;
      const yBase = cam.horizon + cam.eyeZ * lineH;
      // 近づくほど巨大化して視界を塞ぐので、幅と濃さに上限を設ける
      const w = Math.min(lineH * 1.5, this.W * 0.30);
      const near = U.clamp((p.depth - 0.9) / 1.6, 0, 1);
      const done = z.done;
      const col = z.locked ? '#ff5f7a' : (z.kind === 'exit' ? '#4dff9a' : (done ? '#4dff9a' : '#ffd23f'));
      const pulse = 0.55 + Math.sin((z.t || 0) * 4) * 0.22;

      x.save();
      // 光の柱
      const top = yBase - lineH * 1.4;
      const g2 = x.createLinearGradient(0, top, 0, yBase);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, col);
      x.globalAlpha = (done ? 0.22 : 0.16) * pulse * near;
      x.fillStyle = g2;
      x.fillRect(p.sx - w * 0.30, top, w * 0.60, yBase - top);
      // 床の輪
      x.globalAlpha = (done ? 0.85 : 0.7) * (0.35 + near * 0.65);
      x.strokeStyle = col;
      x.lineWidth = Math.max(2, lineH * 0.035);
      x.beginPath(); x.ellipse(p.sx, yBase, w * 0.5, w * 0.16, 0, 0, 7); x.stroke();
      // 確保の進捗
      if (z.kind === 'capture' && !done && z.progress > 0) {
        x.strokeStyle = '#4dff9a';
        x.lineWidth = Math.max(3, lineH * 0.055);
        x.beginPath();
        x.ellipse(p.sx, yBase, w * 0.5, w * 0.16, 0, -Math.PI / 2, -Math.PI / 2 + z.progress * U.TAU);
        x.stroke();
      }
      x.restore();
    },

    _drawParticle(pt, p) {
      const x = this.ctx, cam = this.cam;
      if (this.zAt(p.sx) < p.depth) return;
      const lineH = p.lineH;
      const s = Math.max(1, lineH * pt.size);
      const yc = cam.horizon + (cam.eyeZ - pt.z) * lineH;
      const k = U.clamp(pt.life / pt.maxLife, 0, 1);

      // 砂ぼこり・煙は「ふわっと広がって薄れる」丸で描く
      if (pt.kind === 'dust') {
        const rr2 = s * (1.6 - k * 0.7);
        if (!this._dustGrad) {
          const gr = x.createRadialGradient(0, 0, 0, 0, 0, 1);
          gr.addColorStop(0, 'rgba(255,255,255,0.85)');
          gr.addColorStop(0.6, 'rgba(255,255,255,0.35)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          this._dustGrad = gr;
        }
        x.save();
        x.globalAlpha = k * k * (pt.alpha || 0.5);
        x.translate(p.sx, yc);
        x.scale(rr2, rr2 * 0.8);
        x.fillStyle = pt.color;
        x.beginPath(); x.arc(0, 0, 1, 0, 7); x.fill();
        x.globalAlpha = k * k * (pt.alpha || 0.5) * 0.5;
        x.fillStyle = this._dustGrad;
        x.beginPath(); x.arc(0, 0, 1, 0, 7); x.fill();
        x.restore();
        return;
      }
      // 火花は細い光の線
      if (pt.kind === 'spark') {
        x.save();
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = k;
        x.strokeStyle = pt.color;
        x.lineWidth = Math.max(1, s * 0.35);
        x.lineCap = 'round';
        const vx = (pt.vx || 0), vz = (pt.vz || 0);
        const l2 = Math.max(1, s * 1.4);
        x.beginPath();
        x.moveTo(p.sx, yc);
        x.lineTo(p.sx - vx * l2 * 0.5, yc + vz * l2 * 0.4);
        x.stroke();
        x.restore();
        return;
      }

      x.save();
      x.globalAlpha = k;
      x.fillStyle = pt.color;
      if (Sprites.style === 'pop') {
        // 紙吹雪のような丸／角丸。加算合成は明るい背景で飛ぶので使わない
        x.beginPath(); x.arc(p.sx, yc, s * 0.55, 0, 7); x.fill();
        x.strokeStyle = 'rgba(27,34,51,.5)'; x.lineWidth = Math.max(1, s * 0.16); x.stroke();
      } else {
        if (pt.add) x.globalCompositeOperation = 'lighter';
        x.fillRect(p.sx - s / 2, yc - s / 2, s, s);
      }
      x.restore();
    },

    /* ---------- 2D overlays ---------- */
    renderTracers(game) {
      const x = this.ctx;
      game.tracers.forEach(t => {
        if (!t.alive) return;
        const a = t.life / t.maxLife;
        const p1 = this.project(t.x1, t.y1);
        if (!p1) return;
        const y1 = this.cam.horizon + (this.cam.eyeZ - t.z1) * (this.cam.D / p1.depth);
        x.save();
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = a * 0.85;
        x.strokeStyle = t.color;
        x.lineWidth = Math.max(1, 2.4 * a);
        x.beginPath();
        x.moveTo(t.sx0, t.sy0);
        x.lineTo(p1.sx, y1);
        x.stroke();
        x.restore();
      });
      x.globalAlpha = 1;
    },

    /** 狙撃兵などの攻撃予兆。プレイヤーへ伸びる赤い線で「今狙われている」ことを伝える */
    renderLasers(game) {
      const x = this.ctx, W = this.W, H = this.H;
      let any = false;
      for (let i = 0; i < game.enemies.length; i++) {
        const e = game.enemies[i];
        if (e.state === 'dead' || e.windupT <= 0 || !e.def.laser) continue;
        const p = this.project(e.x, e.y);
        if (!p || this.zAt(p.sx) < p.depth) continue;
        const lineH = p.lineH;
        const y0 = this.cam.horizon + (this.cam.eyeZ - e.def.height * 0.62) * lineH;
        const k = 1 - U.clamp(e.windupT / Math.max(0.01, e.windupMax), 0, 1);
        any = true;
        x.save();
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = 0.35 + k * 0.5;
        x.strokeStyle = '#ff3b46';
        x.lineWidth = Math.max(1, 1.6 + k * 2.2);
        x.beginPath();
        x.moveTo(p.sx, y0);
        x.lineTo(W / 2, H / 2);
        x.stroke();
        x.restore();
      }
      if (any) {
        // 中央に着弾予告のリング
        x.save();
        x.globalAlpha = 0.55;
        x.strokeStyle = '#ff3b46';
        x.lineWidth = 2;
        x.beginPath(); x.arc(W / 2, H / 2, Math.min(W, H) * 0.045, 0, 7); x.stroke();
        x.restore();
      }
    },

    renderDamageNumbers(game) {
      const x = this.ctx;
      game.dmgNums.forEach(d => {
        if (!d.alive) return;
        const p = this.project(d.x, d.y);
        if (!p) return;
        const lineH = this.cam.D / p.depth;
        const yc = this.cam.horizon + (this.cam.eyeZ - d.z) * lineH - d.rise * lineH * 0.5;
        const a = U.clamp(d.life / d.maxLife, 0, 1);
        const size = U.clamp(lineH * (d.crit ? 0.10 : 0.075), 11, 44);
        const pop = Sprites.style === 'pop';
        x.save();
        x.globalAlpha = a;
        x.translate(p.sx, yc);
        if (pop) {
          const pulse = 1 + (1 - a) * 0.25;
          x.rotate(d.tilt || 0);
          x.scale(pulse, pulse);
          x.font = '900 ' + size.toFixed(0) + 'px "Baloo 2","Nunito",system-ui,sans-serif';
          x.textAlign = 'center';
          x.lineJoin = 'round';
          x.lineWidth = Math.max(3, size * 0.34);
          x.strokeStyle = '#1b2233';
          x.strokeText(d.text, 0, 0);
          x.lineWidth = Math.max(2, size * 0.18);
          x.strokeStyle = '#ffffff';
          x.strokeText(d.text, 0, 0);
          x.fillStyle = d.crit ? '#ffd23f' : '#ff5f7a';
          x.fillText(d.text, 0, 0);
        } else {
          x.font = 'bold ' + size.toFixed(0) + 'px "Bahnschrift",Impact,sans-serif';
          x.textAlign = 'center';
          x.lineWidth = Math.max(2, size * 0.16);
          x.strokeStyle = 'rgba(0,0,0,.85)';
          x.strokeText(d.text, 0, 0);
          x.fillStyle = d.crit ? '#ffd24a' : '#ffffff';
          x.fillText(d.text, 0, 0);
        }
        x.restore();
      });
      x.globalAlpha = 1;
    },

    renderScope(zoomT) {
      if (zoomT <= 0.02) return;
      const x = this.ctx, W = this.W, H = this.H;
      x.save();
      x.globalAlpha = zoomT;
      const r = Math.min(W, H) * 0.42;
      x.fillStyle = 'rgba(0,0,0,.92)';
      x.beginPath();
      x.rect(0, 0, W, H);
      x.arc(W / 2, H / 2, r, 0, Math.PI * 2, true);
      x.fill();
      x.strokeStyle = 'rgba(120,220,255,.55)'; x.lineWidth = 2;
      x.beginPath(); x.arc(W / 2, H / 2, r, 0, Math.PI * 2); x.stroke();
      x.beginPath();
      x.moveTo(W / 2 - r, H / 2); x.lineTo(W / 2 + r, H / 2);
      x.moveTo(W / 2, H / 2 - r); x.lineTo(W / 2, H / 2 + r);
      x.strokeStyle = 'rgba(120,220,255,.35)'; x.lineWidth = 1; x.stroke();
      x.strokeStyle = 'rgba(255,80,80,.9)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(W / 2 - 12, H / 2); x.lineTo(W / 2 - 3, H / 2);
      x.moveTo(W / 2 + 3, H / 2); x.lineTo(W / 2 + 12, H / 2);
      x.moveTo(W / 2, H / 2 - 12); x.lineTo(W / 2, H / 2 - 3);
      x.moveTo(W / 2, H / 2 + 3); x.lineTo(W / 2, H / 2 + 12);
      x.stroke();
      x.restore();
    },

    renderWeapon(game) {
      const x = this.ctx, W = this.W, H = this.H;
      const p = game.player;
      const w = p.weapon;
      if (!w) return;                               // 素手のときは何も描かない
      if (game.zoomT > 0.7 && (w.zoom || 1) > 1) return;   // hidden while scoped

      // --- 3D: 腕と武器を立体で描く（三人称と同じ骨格・アニメを使う） ---
      if (this.use3d && g.Char3D && Char3D.enabled) {
        if (Char3D.drawViewModel(this, game)) {
          if (p.flashT > 0.005) {
            const mz = Char3D.vmMuzzle(this, game);
            if (mz) {
              const s = Math.max(6, mz.s * 0.055) * U.clamp(p.flashT * 3.4, 0.35, 1);
              x.save();
              x.globalCompositeOperation = 'lighter';
              const g2 = x.createRadialGradient(mz.x, mz.y, 0.5, mz.x, mz.y, s * 2.6);
              g2.addColorStop(0, 'rgba(255,255,240,.95)');
              g2.addColorStop(0.32, 'rgba(255,198,96,.8)');
              g2.addColorStop(1, 'rgba(255,120,0,0)');
              x.fillStyle = g2;
              x.beginPath(); x.arc(mz.x, mz.y, s * 2.6, 0, 7); x.fill();
              x.restore();
            }
          }
          this._muzzleLight(game, p, w);
          return;
        }
      }
      const base = Math.min(W / 900, H / 500);
      const s = base * 1.0 * (1 - game.zoomT * 0.25);
      // sway + bob + recoil + reload dip + switch dip
      const bob = p.bobPhase;
      const sway = Math.sin(bob) * 12 * p.bobAmp;
      const bobY = Math.abs(Math.cos(bob)) * 9 * p.bobAmp;
      const rec = p.recoilVis;
      let dip = 0, rot = 0;
      if (p.reloading) {
        const t = 1 - p.reloadLeft / p.reloadTotal;
        const k = Math.sin(U.clamp(t, 0, 1) * Math.PI);
        dip = k * 110; rot = k * 0.55;
      }
      if (p.switchT > 0) {
        const k = Math.sin(U.clamp(p.switchT / p.switchTotal, 0, 1) * Math.PI);
        dip = Math.max(dip, k * 150); rot = Math.max(rot, k * 0.4);
      }
      const cx = W * (Input.lefty ? 0.30 : 0.70) + sway - rec * 6;
      const cy = H * 0.92 + bobY + dip + rec * 10;
      Sprites.drawWeapon(x, w.id, cx, cy, s, {
        flash: p.flashT * 3.2,
        rot: rot * (Input.lefty ? -1 : 1) - rec * 0.05,
        color: w.base.color
      });

      this._muzzleLight(game, p, w);
    },

    /** 発砲時に画面全体をわずかに照らす */
    _muzzleLight(game, p, w) {
      if (!(p.flashT > 0.005)) return;
      const x = this.ctx, W = this.W, H = this.H;
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = U.clamp(p.flashT * 2.4, 0, 0.5) * (w.flash || 0.3);
      const gr = x.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(255,210,140,.9)');
      gr.addColorStop(1, 'rgba(255,120,0,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, W, H);
      x.restore();
    },

    render(game) {
      const p = game.player;
      this.updateCamera(p, game.shakeYaw, game.shakePitch, game.curZoom);
      this.renderWorld(game);
      this.renderSprites(game);
      this.renderLasers(game);
      this.renderTracers(game);
      this.renderDamageNumbers(game);
      this.renderWeapon(game);
      // 倍率のある武器だけスコープを覗いた表示にする
      const pw = p.weapon;
      this.renderScope((pw && (pw.zoom || 1) > 1.5) ? game.zoomT : 0);
    }
  };

  g.Render = R;
})(window);
