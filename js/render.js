/* ===== render.js — raycasting 3D renderer (2D canvas, mobile-tuned) ===== */
(function (g) {
  'use strict';

  const R = {
    canvas: null, ctx: null,
    W: 0, H: 0, cssW: 0, cssH: 0,
    scale: 1, stripe: 2, quality: 'AUTO',
    zbuf: null, rays: 0,
    tex: [], theme: null, floorGrid: true,
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
    updateCamera(p, shakeYaw, shakePitch, zoom) {
      const cam = this.cam;
      const ang = p.ang + (shakeYaw || 0);
      cam.ang = ang;
      cam.x = p.x; cam.y = p.y;
      cam.dirX = Math.cos(ang); cam.dirY = Math.sin(ang);
      cam.D = this.H * (zoom || 1);
      const pl = (this.W / 2) / cam.D;
      cam.planeX = -cam.dirY * pl; cam.planeY = cam.dirX * pl;
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
      const x = this.ctx, W = this.W, H = this.H, cam = this.cam, map = game.map, th = this.theme;
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

      // POP: 遠近の縞で床に奥行きを出す（1ピクセル単位の床描画より遥かに軽い）
      if (this.floorGrid && horizon < H) {
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
        const fogMax = this.floorGrid ? 0.46 : 0.58;    // POPは白飛びを抑える
        let a = U.clamp((dist - 3.2) / 22, 0, fogMax);
        if (hit.side === 1) a = Math.min(fogMax + 0.1, a + 0.13);
        if (a > 0.02) {
          x.globalAlpha = a;
          x.fillStyle = fogR;
          x.fillRect(sx, dy0, SW, dy1 - dy0);
          x.globalAlpha = 1;
        }
      }
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

      for (let s = 0; s < segs.length; s++) {
        const sx = segs[s][0], sw = segs[s][1];
        const u0 = (sx - x0) / spW, u1 = (sx + sw - x0) / spW;
        const su0 = U.clamp(u0, 0, 1) * set.w, su1 = U.clamp(u1, 0, 1) * set.w;
        if (su1 - su0 <= 0) continue;
        const dx0 = x0 + (su0 / set.w) * spW;
        x.drawImage(img, su0, 0, su1 - su0, set.h, dx0, yTop, (su1 - su0) / set.w * spW, spH);
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

      // --- health bar + state pip (readability) ---
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
      // alert "!" marker
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
      x.save();
      x.globalAlpha = U.clamp(pt.life / pt.maxLife, 0, 1);
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
      x.arc(W / 2, H / 2, r, 0, 7, true);
      x.fill();
      x.strokeStyle = 'rgba(120,220,255,.55)'; x.lineWidth = 2;
      x.beginPath(); x.arc(W / 2, H / 2, r, 0, 7); x.stroke();
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
      if (game.zoomT > 0.7 && w.zoom > 1) return;   // hidden while scoped
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

      // muzzle light on the scene
      if (p.flashT > 0.005) {
        x.save();
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = U.clamp(p.flashT * 2.4, 0, 0.5) * (w.flash || 0.3);
        const gr = x.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, Math.max(W, H) * 0.75);
        gr.addColorStop(0, 'rgba(255,210,140,.9)');
        gr.addColorStop(1, 'rgba(255,120,0,0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, W, H);
        x.restore();
      }
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
      this.renderScope(game.zoomT);
    }
  };

  g.Render = R;
})(window);
