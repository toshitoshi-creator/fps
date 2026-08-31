/* ===== sprites.js — procedural textures & billboards (no external assets) ===== */
(function (g) {
  'use strict';

  function cvs(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  const OUTLINE = '#1b2233';

  /** 角丸パス（ctx.roundRect が無い環境でも動くよう自前で引く） */
  function rr(x, px, py, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    x.beginPath();
    x.moveTo(px + r, py);
    x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }
  /** 塗り＋太い輪郭。ポップな見た目の要 */
  function inked(x, fill, lw, fn) {
    fn();
    x.lineJoin = 'round'; x.lineCap = 'round';
    x.strokeStyle = OUTLINE; x.lineWidth = lw;
    x.stroke();
    x.fillStyle = fill;
    x.fill();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r + amt), 0, 255);
    gg = U.clamp(Math.round(gg + amt), 0, 255);
    b = U.clamp(Math.round(b + amt), 0, 255);
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  /* ------------------------------------------------------------------
   *  WALL TEXTURES — 64x64, 4 variants, tinted by stage theme
   * ----------------------------------------------------------------*/
  function makeWallTextures(theme) {
    return API.style === 'pop' ? makeWallTexturesPop(theme) : makeWallTexturesMil(theme);
  }

  /** POP: フラットな原色ブロック。上端に濃い縁を入れて壁の上辺が線として立つようにする */
  function makeWallTexturesPop(theme) {
    const T = 64, out = [];
    for (let v = 0; v < 4; v++) {
      const c = cvs(T, T), x = c.getContext('2d');
      const base = theme.walls[v] || theme.walls[0];
      x.fillStyle = base; x.fillRect(0, 0, T, T);

      if (v === 0) {                       // キャンディブロック
        x.fillStyle = shade(base, -30);
        for (let r = 0; r < 3; r++) {
          const off = (r % 2) * 16;
          for (let cn = -1; cn < 3; cn++) {
            rr(x, off + cn * 32 + 2, 6 + r * 20, 28, 15, 5); x.fill();
          }
        }
        x.fillStyle = shade(base, 26);
        for (let r = 0; r < 3; r++) {
          const off = (r % 2) * 16;
          for (let cn = -1; cn < 3; cn++) { rr(x, off + cn * 32 + 2, 6 + r * 20, 28, 11, 5); x.fill(); }
        }
      } else if (v === 1) {                // 水玉パネル
        x.fillStyle = shade(base, 30);
        for (let r = 0; r < 4; r++) for (let cn = 0; cn < 4; cn++) {
          x.beginPath();
          x.arc(8 + cn * 16 + (r % 2) * 8, 10 + r * 16, 4.5, 0, 7);
          x.fill();
        }
      } else if (v === 2) {                // トイっぽい箱
        x.fillStyle = shade(base, -34);
        rr(x, 3, 3, 58, 58, 10); x.fill();
        x.fillStyle = base;
        rr(x, 6, 6, 52, 52, 8); x.fill();
        x.strokeStyle = shade(base, -34); x.lineWidth = 5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(14, 14); x.lineTo(50, 50); x.moveTo(50, 14); x.lineTo(14, 50); x.stroke();
        x.fillStyle = '#ffd23f';
        rr(x, 22, 26, 20, 12, 5); x.fill();
      } else {                             // 太い斜めストライプ
        x.fillStyle = shade(base, 34);
        for (let i = -6; i < 10; i++) {
          x.beginPath();
          x.moveTo(i * 16, 0); x.lineTo(i * 16 + 8, 0);
          x.lineTo(i * 16 + 8 + 64, 64); x.lineTo(i * 16 + 64, 64);
          x.closePath(); x.fill();
        }
      }
      // 上辺の縁取り（壁の輪郭に見せる）
      x.fillStyle = 'rgba(27,34,51,.55)';
      x.fillRect(0, 0, T, 5);
      x.fillStyle = 'rgba(255,255,255,.30)';
      x.fillRect(0, 5, T, 3);
      x.fillStyle = 'rgba(27,34,51,.20)';
      x.fillRect(0, T - 4, T, 4);
      out.push(c);
    }
    return out;
  }

  function makeWallTexturesMil(theme) {
    const T = 64, out = [];
    for (let v = 0; v < 4; v++) {
      const c = cvs(T, T), x = c.getContext('2d');
      const base = theme.walls[v] || theme.walls[0];
      x.fillStyle = base; x.fillRect(0, 0, T, T);
      if (v === 0) {                       // brick / block wall
        x.fillStyle = shade(base, -22);
        for (let r = 0; r < 4; r++) {
          const off = (r % 2) * 16;
          for (let cn = 0; cn < 3; cn++) {
            x.fillRect(off + cn * 32 - 30, r * 16, 30, 14);
          }
        }
        x.fillStyle = shade(base, 16);
        for (let r = 0; r < 4; r++) {
          const off = (r % 2) * 16;
          for (let cn = 0; cn < 3; cn++) x.fillRect(off + cn * 32 - 30, r * 16, 30, 2);
        }
      } else if (v === 1) {                // tech panel
        x.fillStyle = shade(base, -26); x.fillRect(2, 2, 60, 60);
        x.fillStyle = shade(base, 12); x.fillRect(4, 4, 56, 56);
        x.fillStyle = shade(base, -34);
        x.fillRect(0, 30, 64, 4); x.fillRect(30, 0, 4, 64);
        x.fillStyle = 'rgba(120,230,255,.55)';
        x.fillRect(8, 8, 12, 3); x.fillRect(44, 53, 12, 3);
        x.fillStyle = shade(base, 28);
        x.fillRect(6, 44, 20, 2); x.fillRect(40, 12, 18, 2);
      } else if (v === 2) {                // crate / cover
        x.fillStyle = shade(base, -30); x.fillRect(0, 0, T, T);
        x.fillStyle = base; x.fillRect(3, 3, 58, 58);
        x.strokeStyle = shade(base, -40); x.lineWidth = 3;
        x.strokeRect(3, 3, 58, 58);
        x.beginPath(); x.moveTo(3, 3); x.lineTo(61, 61); x.moveTo(61, 3); x.lineTo(3, 61); x.stroke();
        x.fillStyle = shade(base, 30); x.fillRect(3, 3, 58, 3);
        x.fillStyle = 'rgba(255,190,40,.65)'; x.fillRect(24, 28, 16, 8);
      } else {                             // hazard stripes
        x.fillStyle = shade(base, -18); x.fillRect(0, 0, T, T);
        x.save(); x.translate(0, 0);
        x.fillStyle = shade(base, 34);
        for (let i = -8; i < 12; i++) {
          x.beginPath();
          x.moveTo(i * 12, 0); x.lineTo(i * 12 + 6, 0);
          x.lineTo(i * 12 + 6 + 64, 64); x.lineTo(i * 12 + 64, 64);
          x.closePath(); x.fill();
        }
        x.restore();
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, 0, 64, 4); x.fillRect(0, 60, 64, 4);
      }
      // subtle grain for depth
      x.globalAlpha = 0.08;
      for (let i = 0; i < 90; i++) {
        x.fillStyle = Math.random() < .5 ? '#000' : '#fff';
        x.fillRect((Math.random() * T) | 0, (Math.random() * T) | 0, 1, 1);
      }
      x.globalAlpha = 1;
      out.push(c);
    }
    return out;
  }

  /* ------------------------------------------------------------------
   *  ENEMY BILLBOARDS
   * ----------------------------------------------------------------*/
  function drawSoldier(x, W, H, pal, pose, type) {
    const cx = W / 2;
    const isBoss = type === 'boss';
    const legTop = H * 0.60, headY = H * 0.155, headR = W * (isBoss ? 0.145 : 0.125);
    const torsoTop = H * 0.27, torsoBot = H * 0.62;
    const torsoW = W * (isBoss ? 0.60 : 0.42);
    let lean = 0, legSpread = 0.5, armAng = 0, bob = 0;

    if (pose === 'walk1') { legSpread = 1.35; bob = -H * 0.012; }
    else if (pose === 'walk2') { legSpread = 0.15; bob = H * 0.012; }
    else if (pose === 'attack') { armAng = -0.12; lean = -0.05; }
    else if (pose === 'hurt') { lean = 0.16; bob = H * 0.02; }

    x.save();
    x.translate(cx, bob);
    x.rotate(lean * 0.35);
    x.translate(-cx, 0);

    // --- ground glow (readability) ---
    x.save();
    x.globalAlpha = 0.5;
    const gr = x.createRadialGradient(cx, H * 0.985, 1, cx, H * 0.985, W * 0.42);
    gr.addColorStop(0, pal.trim); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr;
    x.beginPath(); x.ellipse(cx, H * 0.985, W * 0.40, H * 0.035, 0, 0, 7); x.fill();
    x.restore();

    const outline = (fn) => { x.save(); x.lineWidth = Math.max(2, W * 0.045); x.strokeStyle = 'rgba(4,8,12,.92)'; fn(true); x.restore(); fn(false); };

    // --- legs ---
    const lw = W * (isBoss ? 0.17 : 0.13);
    [-1, 1].forEach((s, i) => {
      const off = s * W * 0.10 * (1 + (i === 0 ? legSpread : -legSpread) * 0.35);
      const footX = cx + off + s * W * 0.02 * legSpread;
      x.beginPath();
      x.moveTo(cx + s * W * 0.09, legTop);
      x.lineTo(footX, H * 0.97);
      x.lineWidth = lw + 4; x.strokeStyle = 'rgba(4,8,12,.9)'; x.lineCap = 'round'; x.stroke();
      x.lineWidth = lw; x.strokeStyle = pal.sec; x.stroke();
      // boot
      x.fillStyle = shade('#101418', 0);
      x.beginPath(); x.ellipse(footX, H * 0.975, lw * 0.75, lw * 0.40, 0, 0, 7); x.fill();
    });

    // --- torso ---
    outline(function (isStroke) {
      x.beginPath();
      x.moveTo(cx - torsoW / 2, torsoTop + H * 0.03);
      x.lineTo(cx - torsoW / 2 * 0.86, torsoBot);
      x.lineTo(cx + torsoW / 2 * 0.86, torsoBot);
      x.lineTo(cx + torsoW / 2, torsoTop + H * 0.03);
      x.lineTo(cx + torsoW / 2 * 0.78, torsoTop);
      x.lineTo(cx - torsoW / 2 * 0.78, torsoTop);
      x.closePath();
      if (isStroke) x.stroke();
      else { x.fillStyle = pal.main; x.fill(); }
    });
    // chest plate + core light
    x.fillStyle = shade(pal.sec, -6);
    x.fillRect(cx - torsoW * 0.30, torsoTop + H * 0.055, torsoW * 0.60, H * 0.115);
    x.fillStyle = pal.trim;
    x.globalAlpha = 0.9;
    x.fillRect(cx - torsoW * 0.13, torsoTop + H * 0.075, torsoW * 0.26, H * 0.035);
    x.globalAlpha = 1;
    if (isBoss) {
      const cgr = x.createRadialGradient(cx, torsoTop + H * 0.16, 1, cx, torsoTop + H * 0.16, W * 0.22);
      cgr.addColorStop(0, '#fff'); cgr.addColorStop(0.35, pal.visor); cgr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = cgr;
      x.beginPath(); x.arc(cx, torsoTop + H * 0.16, W * 0.22, 0, 7); x.fill();
    }

    // --- shoulders ---
    [-1, 1].forEach(s => {
      x.beginPath();
      x.ellipse(cx + s * torsoW * 0.56, torsoTop + H * 0.045, W * (isBoss ? 0.16 : 0.11), H * (isBoss ? 0.07 : 0.055), s * 0.25, 0, 7);
      x.fillStyle = 'rgba(4,8,12,.9)'; x.fill();
      x.beginPath();
      x.ellipse(cx + s * torsoW * 0.56, torsoTop + H * 0.045, W * (isBoss ? 0.14 : 0.093), H * (isBoss ? 0.058 : 0.043), s * 0.25, 0, 7);
      x.fillStyle = shade(pal.sec, 14); x.fill();
    });

    // --- head / helmet ---
    x.beginPath(); x.arc(cx, headY, headR + 2.5, 0, 7);
    x.fillStyle = 'rgba(4,8,12,.92)'; x.fill();
    x.beginPath(); x.arc(cx, headY, headR, 0, 7);
    x.fillStyle = shade(pal.main, 14); x.fill();
    // helmet crest
    x.fillStyle = shade(pal.sec, -4);
    x.beginPath(); x.arc(cx, headY, headR, Math.PI * 1.08, Math.PI * 1.92); x.lineTo(cx, headY); x.closePath(); x.fill();
    // visor (glowing — key readability cue)
    x.save();
    x.shadowColor = pal.visor; x.shadowBlur = W * 0.28;
    x.fillStyle = pal.visor;
    x.fillRect(cx - headR * 0.86, headY - headR * 0.10, headR * 1.72, headR * 0.52);
    x.restore();
    if (isBoss) {
      x.save(); x.shadowColor = pal.visor; x.shadowBlur = W * 0.3; x.fillStyle = '#fff';
      x.fillRect(cx - headR * 0.9, headY - headR * 0.02, headR * 1.8, headR * 0.12);
      x.restore();
      // horns
      x.strokeStyle = pal.trim; x.lineWidth = W * 0.035; x.lineCap = 'round';
      [-1, 1].forEach(s => { x.beginPath(); x.moveTo(cx + s * headR * 0.8, headY - headR * 0.6); x.lineTo(cx + s * headR * 1.7, headY - headR * 1.5); x.stroke(); });
    }

    // --- arms + weapon ---
    const gy = torsoTop + H * 0.155;
    x.save();
    x.translate(cx, gy);
    x.rotate(armAng);
    if (type === 'rusher') {
      // energy blade
      x.strokeStyle = 'rgba(4,8,12,.9)'; x.lineWidth = W * 0.075; x.lineCap = 'round';
      x.beginPath(); x.moveTo(-torsoW * 0.2, 0); x.lineTo(torsoW * 0.62, -H * 0.06); x.stroke();
      x.save(); x.shadowColor = pal.trim; x.shadowBlur = W * 0.3;
      x.strokeStyle = pal.trim; x.lineWidth = W * 0.045;
      x.beginPath(); x.moveTo(torsoW * 0.30, -H * 0.03); x.lineTo(torsoW * 0.95, -H * 0.10); x.stroke();
      x.restore();
    } else {
      const gunL = W * (isBoss ? 0.62 : 0.46), gunH = H * (isBoss ? 0.055 : 0.038);
      x.fillStyle = 'rgba(4,8,12,.92)';
      x.fillRect(-torsoW * 0.18 - 2, -gunH / 2 - 2, gunL + 4, gunH + 4);
      x.fillStyle = '#2a3138';
      x.fillRect(-torsoW * 0.18, -gunH / 2, gunL, gunH);
      x.fillStyle = shade(pal.trim, -20);
      x.fillRect(gunL - torsoW * 0.18 - W * 0.06, -gunH / 2, W * 0.06, gunH);
      if (isBoss) {
        x.fillStyle = '#2a3138';
        x.fillRect(-torsoW * 0.18, -gunH * 1.9, gunL * 0.9, gunH);
      }
    }
    // arms
    x.strokeStyle = 'rgba(4,8,12,.9)'; x.lineWidth = W * 0.085; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-torsoW * 0.34, -H * 0.02); x.lineTo(torsoW * 0.05, H * 0.005); x.stroke();
    x.strokeStyle = shade(pal.main, -10); x.lineWidth = W * 0.055;
    x.beginPath(); x.moveTo(-torsoW * 0.34, -H * 0.02); x.lineTo(torsoW * 0.05, H * 0.005); x.stroke();
    x.restore();

    // rim light for contrast against any wall
    x.save();
    x.globalCompositeOperation = 'source-atop';
    const rg = x.createLinearGradient(0, 0, W, 0);
    rg.addColorStop(0, 'rgba(255,255,255,.16)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0)');
    rg.addColorStop(1, 'rgba(255,255,255,.10)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    x.restore();

    x.restore();
  }

  function drawCorpse(x, W, H, pal, frame) {
    // frame 0..1 : falling -> flat
    const t = frame;
    x.save();
    x.translate(W / 2, H * 0.97);
    x.rotate(-Math.PI / 2 * t * 0.92);
    x.translate(-W / 2, -H * 0.97);
    x.globalAlpha = 1 - t * 0.15;
    drawSoldier(x, W, H, pal, 'hurt', 'grunt');
    x.restore();
  }


  /* ------------------------------------------------------------------
   *  POP: ずんぐりしたロボット。太い輪郭・大きな目・単純なシルエットで
   *  明るい背景でも一瞬で「敵」だと分かるようにする。
   * ----------------------------------------------------------------*/
  function drawBot(x, W, H, pal, pose, type) {
    const cx = W / 2;
    const boss = type === 'boss';
    const lw = W * (boss ? 0.045 : 0.06);

    let lean = 0, legSpread = 0.5, bob = 0;
    if (pose === 'walk1') { legSpread = 1.5; bob = -H * 0.016; }
    else if (pose === 'walk2') { legSpread = 0.0; bob = H * 0.016; }
    else if (pose === 'attack') { lean = -0.06; bob = -H * 0.008; }
    else if (pose === 'hurt') { lean = 0.18; bob = H * 0.026; }
    if (type === 'rusher') lean -= 0.10;

    // 接地影
    x.save();
    x.globalAlpha = 0.28;
    x.fillStyle = OUTLINE;
    x.beginPath(); x.ellipse(cx, H * 0.965, W * 0.30, H * 0.030, 0, 0, 7); x.fill();
    x.restore();

    x.save();
    x.translate(cx, H * 0.6 + bob);
    x.rotate(lean);
    x.translate(-cx, -H * 0.6);

    const bodyW = W * (boss ? 0.62 : type === 'shooter' ? 0.40 : type === 'heavy' ? 0.58 : 0.48);
    const bodyTop = H * (type === 'shooter' ? 0.40 : 0.42);
    const bodyBot = H * 0.80;
    const headR = W * (boss ? 0.30 : type === 'heavy' ? 0.27 : 0.26);
    const headY = H * (type === 'shooter' ? 0.24 : 0.26);

    // --- 脚 ---
    [-1, 1].forEach((sd, i) => {
      const sw = (i === 0 ? legSpread : 1 - legSpread) - 0.5;
      const fx = cx + sd * bodyW * 0.26 + sd * sw * W * 0.05;
      inked(x, shade(pal.sec, -6), lw, () => rr(x, fx - W * 0.075, bodyBot - H * 0.02, W * 0.15, H * 0.17 + sw * H * 0.02, W * 0.06));
    });

    // --- 胴体 ---
    inked(x, pal.main, lw, () => rr(x, cx - bodyW / 2, bodyTop, bodyW, bodyBot - bodyTop, W * 0.13));
    // お腹のプレート
    x.fillStyle = shade(pal.main, 34);
    rr(x, cx - bodyW * 0.28, bodyTop + H * 0.09, bodyW * 0.56, H * 0.18, W * 0.06); x.fill();
    x.fillStyle = pal.trim;
    rr(x, cx - bodyW * 0.16, bodyTop + H * 0.13, bodyW * 0.32, H * 0.05, W * 0.03); x.fill();

    // --- 腕 ---
    [-1, 1].forEach(sd => {
      inked(x, shade(pal.main, -14), lw, () =>
        rr(x, cx + sd * (bodyW / 2) - (sd > 0 ? 0 : W * 0.12), bodyTop + H * 0.06, W * 0.12, H * 0.20, W * 0.055));
    });

    // --- 武器 ---
    if (type === 'rusher') {
      // 大きなトゲ付きハンマー
      x.save();
      x.translate(cx + bodyW * 0.62, bodyTop + H * 0.02);
      x.rotate(pose === 'attack' ? -0.5 : -0.15);
      inked(x, '#ffd23f', lw, () => rr(x, -W * 0.05, 0, W * 0.10, H * 0.22, W * 0.03));
      inked(x, pal.trim, lw, () => rr(x, -W * 0.16, -H * 0.10, W * 0.32, H * 0.13, W * 0.05));
      x.restore();
    } else {
      const gw = W * (boss ? 0.46 : type === 'heavy' ? 0.38 : 0.32);
      inked(x, shade(pal.sec, -10), lw, () =>
        rr(x, cx + bodyW * 0.36, bodyTop + H * 0.10, gw, H * 0.11, W * 0.05));
      x.fillStyle = pose === 'attack' ? '#fff3b0' : pal.trim;
      x.beginPath(); x.arc(cx + bodyW * 0.36 + gw, bodyTop + H * 0.155, W * 0.045, 0, 7); x.fill();
      if (boss || type === 'heavy') {
        inked(x, shade(pal.sec, -10), lw, () =>
          rr(x, cx - bodyW * 0.36 - gw, bodyTop + H * 0.10, gw, H * 0.11, W * 0.05));
      }
    }

    // --- 頭 ---
    inked(x, shade(pal.main, 12), lw, () => rr(x, cx - headR, headY - headR * 0.92, headR * 2, headR * 1.84, headR * 0.5));

    // 種別ごとの飾り（シルエットで見分けられるように）
    if (type === 'grunt') {
      x.strokeStyle = OUTLINE; x.lineWidth = lw * 0.9; x.lineCap = 'round';
      x.beginPath(); x.moveTo(cx, headY - headR * 0.9); x.lineTo(cx, headY - headR * 1.5); x.stroke();
      inked(x, pal.trim, lw * 0.8, () => { x.beginPath(); x.arc(cx, headY - headR * 1.62, W * 0.05, 0, 7); });
    } else if (type === 'rusher') {
      inked(x, '#ffd23f', lw * 0.85, () => {
        x.beginPath();
        x.moveTo(cx - headR * 0.9, headY - headR * 0.8);
        x.lineTo(cx - headR * 0.3, headY - headR * 1.7);
        x.lineTo(cx + headR * 0.1, headY - headR * 0.9);
        x.lineTo(cx + headR * 0.6, headY - headR * 1.6);
        x.lineTo(cx + headR * 0.95, headY - headR * 0.8);
        x.closePath();
      });
    } else if (type === 'shooter') {
      inked(x, shade(pal.sec, 10), lw * 0.85, () => rr(x, cx - W * 0.03, headY - headR * 1.9, W * 0.06, headR * 1.0, W * 0.03));
      inked(x, pal.trim, lw * 0.8, () => { x.beginPath(); x.arc(cx, headY - headR * 1.95, W * 0.055, 0, 7); });
    } else if (type === 'heavy') {
      inked(x, shade(pal.sec, 6), lw * 0.9, () => rr(x, cx - headR * 1.15, headY - headR * 1.15, headR * 2.3, headR * 0.55, W * 0.05));
    } else if (boss) {
      inked(x, '#ffd23f', lw * 0.9, () => {
        x.beginPath();
        x.moveTo(cx - headR * 1.05, headY - headR * 0.75);
        x.lineTo(cx - headR * 0.75, headY - headR * 1.75);
        x.lineTo(cx - headR * 0.30, headY - headR * 1.05);
        x.lineTo(cx, headY - headR * 2.0);
        x.lineTo(cx + headR * 0.30, headY - headR * 1.05);
        x.lineTo(cx + headR * 0.75, headY - headR * 1.75);
        x.lineTo(cx + headR * 1.05, headY - headR * 0.75);
        x.closePath();
      });
    }

    // --- 目（状態が一目で分かる） ---
    const eyeW = headR * 1.5, eyeH = headR * 0.86;
    inked(x, pal.visor, lw * 0.8, () => rr(x, cx - eyeW / 2, headY - eyeH * 0.42, eyeW, eyeH, headR * 0.30));
    const ey = headY;
    const eyes = boss ? [-0.46, 0, 0.46] : (type === 'shooter' ? [0] : [-0.30, 0.30]);
    const er = headR * (type === 'shooter' ? 0.34 : boss ? 0.16 : 0.20);
    x.fillStyle = OUTLINE;
    if (pose === 'hurt') {
      x.strokeStyle = OUTLINE; x.lineWidth = lw * 0.85; x.lineCap = 'round';
      eyes.forEach(o => {
        const px = cx + eyeW * o;
        x.beginPath();
        x.moveTo(px - er, ey - er); x.lineTo(px + er, ey + er);
        x.moveTo(px + er, ey - er); x.lineTo(px - er, ey + er);
        x.stroke();
      });
    } else {
      eyes.forEach(o => {
        const px = cx + eyeW * o;
        x.beginPath(); x.arc(px, ey, er, 0, 7); x.fill();
        x.save(); x.fillStyle = 'rgba(255,255,255,.9)';
        x.beginPath(); x.arc(px - er * 0.32, ey - er * 0.34, er * 0.30, 0, 7); x.fill();
        x.restore();
      });
      if (pose === 'attack') {          // 怒り眉
        x.strokeStyle = OUTLINE; x.lineWidth = lw; x.lineCap = 'round';
        eyes.forEach((o, i) => {
          const px = cx + eyeW * o, sd = eyes.length === 1 ? 1 : (i === 0 ? 1 : -1);
          x.beginPath();
          x.moveTo(px - er * 1.2 * sd, ey - er * 1.9);
          x.lineTo(px + er * 1.1 * sd, ey - er * 1.1);
          x.stroke();
        });
      }
    }

    x.restore();
  }

  function drawCorpsePop(x, W, H, pal, frame, type) {
    const t = frame;
    x.save();
    x.translate(W / 2, H * 0.95);
    x.rotate(Math.PI / 2 * t * 0.9);
    x.scale(1, 1 - t * 0.15);
    x.translate(-W / 2, -H * 0.95);
    x.globalAlpha = 1 - t * 0.1;
    drawBot(x, W, H, pal, 'hurt', type);
    x.restore();
  }

  /** 画像をひとつの色で塗りつぶしたシルエットを作る */
  function tintCanvas(src, color, W, H) {
    const c = cvs(W, H), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, W, H);
    return c;
  }

  /**
   * 白フチを付けてステッカー状にする。
   * POPは背景が明るく彩度も高いので、敵と同系色の床の上でも輪郭が消えないよう
   * 濃い輪郭の外側にもう一段白を回す。
   */
  function sticker(src, W, H, r) {
    const c = cvs(W, H), x = c.getContext('2d');
    const sil = tintCanvas(src, '#ffffff', W, H);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      x.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
    x.drawImage(src, 0, 0);
    return c;
  }

  const enemyCache = {};
  function getEnemySprites(typeId) {
    const key = API.style + ':' + typeId;
    if (enemyCache[key]) return enemyCache[key];
    const def = DATA.ENEMIES[typeId];
    const isBoss = !!def.boss;
    const W = isBoss ? 150 : 84, H = isBoss ? 168 : 104;
    const poses = ['stand', 'walk1', 'walk2', 'attack', 'hurt'];
    const pop = API.style === 'pop';
    const figure = pop ? drawBot : drawSoldier;
    const halo = W * 0.035;
    const set = { w: W, h: H };
    poses.forEach(p => {
      const c = cvs(W, H);
      figure(c.getContext('2d'), W, H, def.palette, p, typeId);
      set[p] = pop ? sticker(c, W, H, halo) : c;
    });
    // 被弾フラッシュ用のシルエット（当たり判定の箱ではなく本体を光らせる）
    set.flashHit = tintCanvas(set.hurt, '#ff8a8a', W, H);
    set.flashCrit = tintCanvas(set.hurt, '#ffd24a', W, H);

    set.dead = [];
    for (let i = 0; i < 4; i++) {
      const c = cvs(W, H);
      if (pop) drawCorpsePop(c.getContext('2d'), W, H, def.palette, i / 3, typeId);
      else drawCorpse(c.getContext('2d'), W, H, def.palette, i / 3);
      set.dead.push(pop ? sticker(c, W, H, halo) : c);
    }
    enemyCache[key] = set;
    return set;
  }

  function clearCache() { Object.keys(enemyCache).forEach(k => delete enemyCache[k]); }

  /* ------------------------------------------------------------------
   *  FIRST-PERSON WEAPON MODELS (vector drawn each frame)
   * ----------------------------------------------------------------*/
  function drawWeapon(x, id, cx, cy, s, opt) {
    if (API.style === 'pop') return drawWeaponPop(x, id, cx, cy, s, opt || {});
    opt = opt || {};
    const flash = opt.flash || 0;
    x.save();
    x.translate(cx, cy);
    x.rotate(opt.rot || 0);
    x.scale(s, s);
    x.lineJoin = 'round';

    const body = '#252c33', body2 = '#161b20', hi = '#3c4650', accent = opt.color || '#7fe3ff';
    const rect = (a, b, c2, d, col) => { x.fillStyle = col; x.fillRect(a, b, c2, d); };

    if (id === 'sg') {
      rect(-140, -14, 190, 30, body);
      rect(-140, -14, 190, 5, hi);
      rect(48, -11, 96, 12, body2);      // barrel
      rect(48, 3, 96, 9, body2);         // pump
      rect(24, 3, 44, 15, hi);
      rect(-150, -10, 34, 62, body2);    // stock
      x.fillStyle = accent; x.fillRect(-92, -9, 46, 5);
      rect(-46, 14, 20, 34, body2);      // grip
    } else if (id === 'sr') {
      rect(-160, -10, 250, 22, body);
      rect(-160, -10, 250, 4, hi);
      rect(88, -6, 100, 12, body2);      // long barrel
      rect(-40, -34, 92, 22, body2);     // scope
      x.fillStyle = '#0a0f14'; x.fillRect(-34, -30, 80, 14);
      x.fillStyle = accent; x.globalAlpha = .8; x.fillRect(-34, -26, 80, 3); x.globalAlpha = 1;
      rect(-56, -30, 10, 22, hi); rect(38, -30, 10, 22, hi);
      rect(-170, -6, 40, 58, body2);     // stock
      rect(-52, 10, 20, 40, body2);      // grip
      rect(20, 8, 60, 10, hi);           // bipod rail
    } else if (id === 'smg') {
      rect(-118, -13, 150, 27, body);
      rect(-118, -13, 150, 4, hi);
      rect(30, -8, 52, 14, body2);
      rect(-124, -8, 26, 48, body2);
      rect(-40, 12, 22, 52, body2);      // long mag
      x.fillStyle = accent; x.fillRect(-84, -8, 40, 4);
      rect(-10, 12, 18, 30, body2);
    } else {                             // assault rifle (default)
      rect(-140, -14, 195, 28, body);
      rect(-140, -14, 195, 4, hi);
      rect(52, -8, 74, 13, body2);       // barrel
      rect(96, -11, 26, 19, hi);         // muzzle brake
      rect(-146, -8, 30, 54, body2);     // stock
      rect(-30, 12, 24, 46, body2);      // mag
      rect(-56, 12, 20, 34, body2);      // grip
      x.fillStyle = accent; x.fillRect(-96, -9, 44, 5);
      rect(-4, -24, 40, 11, hi);         // optic
      x.fillStyle = '#0a0f14'; x.fillRect(0, -21, 32, 6);
    }

    // muzzle flash
    if (flash > 0.02) {
      const mx = id === 'sr' ? 190 : (id === 'sg' ? 146 : (id === 'smg' ? 84 : 124));
      const my = id === 'sr' ? 0 : (id === 'sg' ? -5 : (id === 'smg' ? -1 : -2));
      x.save();
      x.translate(mx, my);
      x.globalAlpha = U.clamp(flash, 0, 1);
      const r = 70 * (0.6 + flash * 0.8);
      const gr = x.createRadialGradient(0, 0, 2, 0, 0, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,225,140,.95)');
      gr.addColorStop(0.6, 'rgba(255,150,40,.5)');
      gr.addColorStop(1, 'rgba(255,90,0,0)');
      x.fillStyle = gr;
      x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
      // star spikes
      x.strokeStyle = 'rgba(255,240,190,.95)'; x.lineWidth = 7 * flash;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4 + 0.3;
        x.beginPath(); x.moveTo(-Math.cos(a) * r * .8, -Math.sin(a) * r * .8);
        x.lineTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8); x.stroke();
      }
      x.restore();
    }
    x.restore();
  }

  /** POP: 角丸・原色・太い輪郭のトイガン */
  function drawWeaponPop(x, id, cx, cy, s, opt) {
    const flash = opt.flash || 0;
    const accent = opt.color || '#4ad4c4';
    x.save();
    x.translate(cx, cy);
    x.rotate(opt.rot || 0);
    x.scale(s, s);
    const lw = 12;
    const white = '#ffffff', dark = '#4a5568', grey = '#8b9bb0';
    const part = (fill, px, py, w, h, r) => inked(x, fill, lw, () => rr(x, px, py, w, h, r));

    if (id === 'sg') {
      part(accent, -150, -22, 210, 44, 16);      // 本体は武器色でしっかり主張させる
      part(dark, 46, -15, 110, 26, 11);          // 銃身
      part(white, -120, -12, 54, 14, 7);         // ライン
      part(grey, 10, 14, 66, 24, 10);            // ポンプ
      part(dark, -62, 16, 34, 50, 12);           // グリップ
    } else if (id === 'sr') {
      part(accent, -170, -16, 268, 34, 14);
      part(dark, 96, -11, 104, 24, 11);
      part(grey, -46, -52, 108, 32, 13);         // スコープ
      part(white, -34, -44, 84, 14, 7);
      part(dark, -70, 12, 30, 52, 12);
      part(grey, -180, -12, 42, 56, 15);         // ストック
    } else if (id === 'smg') {
      part(accent, -124, -20, 164, 40, 16);
      part(dark, 38, -12, 58, 24, 10);
      part(white, -100, -12, 46, 14, 7);
      part(dark, -52, 14, 34, 62, 13);           // ロングマガジン
      part(grey, -132, -12, 30, 44, 12);
    } else {
      part(accent, -148, -22, 214, 42, 16);
      part(dark, 58, -13, 78, 24, 11);           // 銃身
      part(grey, 106, -19, 34, 36, 12);          // マズル
      part(white, -116, -13, 58, 16, 8);         // ライン
      part(dark, -44, 16, 38, 54, 13);           // マガジン
      part(dark, -78, 14, 30, 38, 12);           // グリップ
      part(grey, -12, -40, 52, 20, 9);           // サイト
    }

    if (flash > 0.02) {
      const mx = id === 'sr' ? 206 : (id === 'sg' ? 162 : (id === 'smg' ? 100 : 142));
      const my = id === 'sr' ? 0 : -2;
      x.save();
      x.translate(mx, my);
      x.globalAlpha = U.clamp(flash, 0, 1);
      const r = 78 * (0.6 + flash * 0.8);
      // ポップな星型フラッシュ
      x.fillStyle = '#ffd23f';
      x.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        const rad = (i % 2 ? r * 0.44 : r);
        x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
      }
      x.closePath(); x.fill();
      x.fillStyle = '#fff8d0';
      x.beginPath(); x.arc(0, 0, r * 0.42, 0, 7); x.fill();
      x.restore();
    }
    x.restore();
  }

  const API = {
    style: 'pop', fx: null,
    cvs, shade, rr, inked, makeWallTextures, getEnemySprites, drawWeapon, drawSoldier, drawBot, clearCache
  };
  g.Sprites = API;
})(window);
