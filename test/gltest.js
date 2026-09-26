/* =========================================================================
 * gltest.js — LAST ISLAND の WebGL2 描画（写実寄り3D）を実ブラウザで検査する。
 *
 * brtest.js はGPUの無い環境（ヘッドレス）では従来描画で走る。こちらは ?gl=1 で
 * WebGL2 を強制し、3D描画・カメラ・当たり判定・装備の見た目・HUDを確かめる。
 *
 *   node test/gltest.js
 * ======================================================================= */
function loadPlaywright() {
  const cands = [process.env.PW, 'playwright', '@playwright/test'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  throw new Error('playwright が見つかりません。`npm i -D playwright` を実行してください。');
}
function launchOpts() {
  const fs = require('fs');
  const args = ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];
  const paths = [process.env.CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const p of paths) if (fs.existsSync(p)) return { executablePath: p, args };
  return { args };
}
const { chromium } = loadPlaywright();
const server = require('./serve.js');

const PORT = 8917;
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, info) {
  if (cond) { pass++; results.push('  \x1b[32m✓\x1b[0m ' + name + (info != null && info !== '' ? '  \x1b[90m' + info + '\x1b[0m' : '')); }
  else { fail++; results.push('  \x1b[31m✗ ' + name + '\x1b[0m' + (info != null ? '  ' + info : '')); }
}
function section(t) { results.push('\n\x1b[36m▌' + t + '\x1b[0m'); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const wait = ms => page.waitForTimeout(ms);
  const press = async (sel, id) => {
    await page.dispatchEvent(sel, 'pointerdown', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'pointerup', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'click', { bubbles: true, cancelable: true });
  };
  const until = async (fn, ms, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { if (await page.evaluate(fn, arg)) return true; await wait(60); }
    return false;
  };

  await page.goto(`http://127.0.0.1:${PORT}/br/index.html?gl=1`);
  await page.waitForFunction(() => window.__br && window.__br.BR);
  await wait(600);

  // ページ内で使う小道具（3D座標 → Render の画面座標、開けた場所の確保）
  await G(() => {
    window.__t = {
      aim(x, y, z) {
        const m = __br.GL3D.vp, R = __br.Render;
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) return null;
        return { sx: (cx / cw * 0.5 + 0.5) * R.W, sy: (1 - (cy / cw * 0.5 + 0.5)) * R.H };
      },
      frame() { const BR = __br.BR; __br.Render.updateCamera(BR.player, 0, 0, BR.curZoom); __br.GL3D.render(BR, 0.0001); },
      open(dist) {
        const BR = __br.BR, m = BR.map;
        for (let t = 0; t < 3000; t++) {
          const s = m.spawnable[(Math.random() * m.spawnable.length) | 0];
          for (let a = 0; a < 16; a++) {
            const ang = a / 16 * Math.PI * 2;
            const tx = s.x + Math.cos(ang) * dist, ty = s.y + Math.sin(ang) * dist;
            if (BR.solidAt(tx, ty) || !BR.los(s.x, s.y, tx, ty)) continue;
            // 左右と背後にも余裕がある場所（三人称カメラが壁に寄らない）
            let clear = true;
            for (let k = 0; k < 8 && clear; k++) {
              const b = k / 8 * Math.PI * 2;
              if (!BR.los(s.x, s.y, s.x + Math.cos(b) * 3, s.y + Math.sin(b) * 3)) clear = false;
            }
            if (!clear) continue;
            return { x: s.x, y: s.y, ang, tx, ty };
          }
        }
        return null;
      },
      calm() {
        const BR = __br.BR;
        __br.godMode(true);
        BR.bots.forEach(b => { b.x = 1.5; b.y = 1.5; b.state = 'ground'; b.alive = true; b.hp = 100; b.weapons = [null, null]; b.bot.state = 'LOOTING'; });
        BR.zone.r = 200; BR.zone.nextR = 200; BR.zone.timer = 999;
      }
    };
  });

  /* ================= 1. 起動 ================= */
  section('1. WebGL2 の起動とロビー');
  ok('エラーなく起動する', errors.length === 0, errors.join(' | '));
  const boot = await G(() => ({
    active: __br.GL3D.active, cls: document.body.classList.contains('gl3d'),
    viewHidden: getComputedStyle(document.getElementById('view')).visibility === 'hidden',
    glShown: getComputedStyle(document.getElementById('gl')).display !== 'none',
    renderer: __br.GL3D.renderer
  }));
  ok('?gl=1 で WebGL2 描画が有効になる', boot.active, boot.renderer);
  ok('3D用canvasが表示され、従来のcanvasは隠れる', boot.cls && boot.viewHidden && boot.glShown);
  const lobbyPix = await G(() => { __br.GL3D.renderLobby(performance.now() / 1000, __br.lobbyDummy()); return __br.GL3D.sample(null); });
  ok('ロビーの背景が3Dで描かれている（色数が多い）', lobbyPix && lobbyPix.uniq > 150, lobbyPix && (lobbyPix.uniq + '色 / 平均' + lobbyPix.mean.toFixed(0)));
  const lobbyChar = await G(() => ({ drawn: !!__br.GL3D._worlds[777], chars: Object.keys(__br.GL3D._worlds).length }));
  ok('ロビー用の舞台（林・小屋）が作られる', lobbyChar.drawn);
  ok('STARTボタンが押せる位置にある', await G(() => {
    const el = document.querySelector('[data-nav="play"]'); const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width > 120 && r.bottom <= innerHeight && (t === el || el.contains(t));
  }));

  /* ================= 2. 世界の生成 ================= */
  section('2. 島の3Dジオメトリ');
  await press('[data-nav="play"]');
  await until(() => __br.BR.state === 'PLANE', 5000);
  await until(() => __br.GL3D.map === __br.BR.map, 6000);
  const world = await G(() => {
    const GL = __br.GL3D, BR = __br.BR, m = BR.map;
    let tall = 0, wallCells = 0, tree = 0;
    for (let i = 0; i < m.grid.length; i++) {
      if (m.grid[i] === 1) { wallCells++; if (GL.tileH[i] >= 1.6) tall++; }
      if (m.grid[i] === 2 && GL.tileH[i] >= 2.5) tree++;
    }
    const styles = new Set(m.buildings.map(b => b.style && (b.style.wall + ':' + b.style.roof)));
    return {
      tris: GL.stats.solidTris, ms: GL.stats.buildMs, tall, wallCells, tree, styles: styles.size,
      map: !!GL.mapCanvas && GL.mapCanvas.width, roofs: m.buildings.filter(b => b.style).length, nb: m.buildings.length,
      cutout: GL.cutoutMesh.count, terrain: GL.terrainMesh.count
    };
  });
  ok('建物・木・岩の3Dメッシュが作られる', world.tris > 8000, world.tris + '三角形');
  ok('生成が3秒以内に終わる', world.ms < 3000, world.ms.toFixed(0) + 'ms');
  ok('壁は人より高い（当たり判定用の高さを持つ）', world.tall === world.wallCells, world.tall + '/' + world.wallCells);
  ok('木は高さを持つ（弾が幹で止まる）', world.tree > 10, world.tree + '本');
  ok('建物の見た目に種類がある（材質×屋根）', world.styles >= 3, world.styles + '種');
  ok('すべての建物に屋根と材質が決まっている', world.roofs === world.nb);
  ok('茂みなどの切り抜き板がある', world.cutout > 600, (world.cutout / 6 | 0) + '枚');
  ok('地形メッシュがある', world.terrain > 10000);
  ok('UI用の地図が同じ地表から描かれる', world.map >= 512, world.map + 'px');

  /* ================= 3. 輸送機 → 降下 ================= */
  section('3. カメラ: 輸送機・降下・着地');
  await wait(300);
  ok('輸送機のカメラ', (await G(() => __br.GL3D.cam.mode)) === 'plane');
  const planePix = await G(() => __br.GL3D.sample(__br.BR));
  ok('輸送機からの景色が描かれる', planePix.uniq > 120, planePix.uniq + '色');
  ok('降下マップ（右上）が描かれる', await G(() => {
    const c = document.getElementById('dropMap'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 400) if (d[i] > 0) n++; return n > 50;
  }));
  ok('降下中は戦闘ボタンが隠れる', await G(() => getComputedStyle(document.getElementById('btnFire')).display === 'none'));
  await press('#btnDrop');
  await wait(300);
  ok('DROPで降下カメラになる', (await G(() => __br.GL3D.cam.mode)) === 'drop');
  ok('降下中はカメラが本人より上にある', await G(() => __br.GL3D.cam.pos[2] > 5));
  await until(() => __br.BR.player.chute, 15000);
  ok('パラシュートが開く', await G(() => __br.BR.player.chute));
  await until(() => __br.BR.player.state === 'ground', 20000);
  await wait(300);
  ok('着地すると三人称カメラ', (await G(() => __br.GL3D.cam.mode)) === 'tpp');
  ok('着地後は戦闘ボタンが戻る', await G(() => getComputedStyle(document.getElementById('btnFire')).display !== 'none'));
  ok('降下〜着地でエラーが出ない', errors.length === 0, errors.join(' | '));

  /* ================= 4. カメラ ================= */
  section('4. 視点（TPP / FPP）と壁抜け防止');
  await G(() => __t.calm());
  await press('#btnView');
  await wait(150);
  const fpp = await G(() => { __t.frame(); const c = __br.GL3D.cam, p = __br.BR.player; return { mode: c.mode, z: c.pos[2], eye: p.eyeZ * 1.6, set: __br.BRSave.data.settings.view, lbl: document.getElementById('viewLbl').textContent }; });
  ok('視点ボタンで一人称に切り替わる', fpp.mode === 'fpp' && fpp.set === 'FPP', fpp.mode + ' / ' + fpp.lbl);
  ok('一人称の目の高さが姿勢と一致する', Math.abs(fpp.z - fpp.eye) < 0.02, fpp.z.toFixed(2));
  await press('#btnView');
  await wait(100);
  ok('もう一度押すと三人称に戻る', (await G(() => { __t.frame(); return __br.GL3D.cam.mode; })) === 'tpp');
  const camSafe = await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map, GL = __br.GL3D;
    let bad = 0, n = 0, blocked = 0;
    for (let i = 0; i < 80; i++) {
      // 建物の近くに立たせて、いろいろな向きで調べる
      const bd = m.buildings[i % m.buildings.length];
      const x = bd.x - 1.5 + Math.random() * (bd.bw + 3), y = bd.y - 1.5 + Math.random() * (bd.bh + 3);
      if (BR.solidAt(x, y)) continue;
      p.x = x; p.y = y; p.ang = Math.random() * 6.28; p.pitch = (Math.random() - 0.5) * 0.8;
      GL.updateCamera(BR);
      n++;
      if (BR.solidAt(GL.cam.pos[0], GL.cam.pos[1])) bad++;
      if (!BR.los(p.x, p.y, GL.cam.pos[0], GL.cam.pos[1])) blocked++;
    }
    return { bad, n, blocked };
  });
  ok('三人称カメラが壁の中に入らない', camSafe.bad === 0, camSafe.bad + '/' + camSafe.n);
  ok('三人称カメラと本人の間に壁が無い', camSafe.blocked === 0, camSafe.blocked + '/' + camSafe.n);
  const adsCam = await G(() => {
    const BR = __br.BR; __br.giveWeapon('raptor', 0); BR.player.wIdx = 0; BR.zoomT = 0.9; BR.curZoom = 1.2;
    __br.GL3D.updateCamera(BR); const m = __br.GL3D.cam.mode; BR.zoomT = 0; BR.curZoom = 1; return m;
  });
  ok('三人称でもADS中は一人称で覗く', adsCam === 'fpp');

  /* ================= 5. 3Dの当たり判定 ================= */
  section('5. 射撃の当たり判定（描いた3Dモデルに当たる）');
  const hits = await G(() => {
    const BR = __br.BR, p = BR.player, T = __t;
    const spot = T.open(6);
    if (!spot) return null;
    __br.GL3D.view = 'FPP';
    p.x = spot.x; p.y = spot.y; p.ang = spot.ang; p.pitch = 0; p.stance = 'stand'; p.eyeZ = 0.55;
    const e = BR.bots[0];
    e.x = spot.tx; e.y = spot.ty; e.ang = spot.ang + Math.PI; e.state = 'ground'; e.alive = true; e.hp = 100; e.armor = 0; e.helmet = 0; e.stance = 'stand';
    e.moving = false; e.hurtT = 0;
    const w = __br.giveWeapon('raptor', 0); p.wIdx = 0;
    T.frame();
    const st = e._gl;
    const body = st.caps.find(c => c.k === 'body'), head = st.caps.find(c => c.k === 'head');
    const mid = (c, k) => [c.a[0] + (c.b[0] - c.a[0]) * k, c.a[1] + (c.b[1] - c.a[1]) * k, c.a[2] + (c.b[2] - c.a[2]) * k];
    const bc = mid(body, 0.5), hc = mid(head, 0.4);
    const out = {};
    let s = T.aim(bc[0], bc[1], bc[2]);
    let r = __br.GL3D.hitscan(BR, s.sx, s.sy, w, 1.0);
    out.body = r.hit && r.c === e && !r.head;
    s = T.aim(hc[0], hc[1], hc[2]);
    r = __br.GL3D.hitscan(BR, s.sx, s.sy, w, 1.0);
    out.head = r.hit && r.c === e && r.head;
    // 横へ1.2外すと当たらない
    const sx = -Math.sin(spot.ang) * 1.2, sy = Math.cos(spot.ang) * 1.2;
    s = T.aim(bc[0] + sx, bc[1] + sy, bc[2]);
    r = __br.GL3D.hitscan(BR, s.sx, s.sy, w, 1.5);
    out.miss = !r.hit;
    // 頭の少し上（空）を狙うと当たらない
    s = T.aim(hc[0], hc[1], hc[2] + 0.35);
    r = __br.GL3D.hitscan(BR, s.sx, s.sy, w, 1.0);
    out.over = !r.hit;
    // 伏せた相手は低い所に当たり判定がある
    e.stance = 'prone'; T.frame();
    const pb = e._gl.caps.find(c => c.k === 'body');
    out.proneLow = Math.max(pb.a[2], pb.b[2]) < 0.45;
    e.stance = 'stand'; T.frame();
    // BRPlayer 経由（ダメージが入る）
    const hp0 = e.hp;
    s = T.aim(bc[0], bc[1], bc[2]);
    __br.BRPlayer.hitscan(BR, s.sx, s.sy, w);
    out.dmg = hp0 - e.hp;
    out.dmgNum = BR.dmgNums.length > 0;
    // 三人称: 自分より手前（カメラとの間）の相手には当たらない
    __br.GL3D.view = 'TPP'; e.hp = 100; T.frame();
    const c = __br.GL3D.cam;
    e.x = (c.pos[0] + p.x) / 2; e.y = (c.pos[1] + p.y) / 2;
    T.frame();
    const b2 = e._gl.caps.find(cc => cc.k === 'body');
    const bc2 = mid(b2, 0.5);
    s = T.aim(bc2[0], bc2[1], bc2[2]);
    r = s ? __br.GL3D.hitscan(BR, s.sx, s.sy, w, 1.0) : { hit: false };
    out.behind = !(r.hit && r.c === e);
    return out;
  });
  ok('射撃テストの足場を確保できる', !!hits);
  if (hits) {
    ok('胴を狙うと胴に当たる', hits.body);
    ok('頭を狙うとヘッドショットになる', hits.head);
    ok('横に外すと当たらない（アシスト最大でも）', hits.miss);
    ok('頭の上の空を撃っても当たらない', hits.over);
    ok('伏せた相手の当たり判定は低くなる', hits.proneLow);
    ok('当たるとダメージが入る', hits.dmg > 0, hits.dmg + 'ダメージ');
    ok('ダメージ数値が出る', hits.dmgNum);
    ok('三人称でカメラと自分の間にいる相手は撃てない', hits.behind);
  }
  const wall = await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map, T = __t;
    __br.GL3D.view = 'FPP';
    for (const bd of m.buildings) {
      const yb = bd.y + bd.bh - 1;
      for (let x = bd.x + 1; x < bd.x + bd.bw - 1; x++) {
        if (m.grid[yb * m.w + x] !== 1 || m.grid[(yb - 1) * m.w + x] !== 0) continue;
        if (BR.solidAt(x + 0.5, yb + 3.5) || BR.solidAt(x + 0.5, yb + 2.5) || BR.solidAt(x + 0.5, yb + 1.5)) continue;
        p.x = x + 0.5; p.y = yb + 3.5; p.ang = -Math.PI / 2; p.pitch = 0;
        const e = BR.bots[0];
        e.x = x + 0.5; e.y = yb - 0.5; e.state = 'ground'; e.alive = true; e.hp = 100; e.stance = 'stand';
        T.frame();
        const body = e._gl.caps.find(c => c.k === 'body');
        const bc = [(body.a[0] + body.b[0]) / 2, (body.a[1] + body.b[1]) / 2, (body.a[2] + body.b[2]) / 2];
        const s = T.aim(bc[0], bc[1], bc[2]);
        const r = __br.GL3D.hitscan(BR, s.sx, s.sy, BR.player.weapons[0], 1.5);
        return { found: true, hit: r.hit, wall: r.wall, wz: r.wz };
      }
    }
    return { found: false };
  });
  ok('壁の向こうの相手には当たらない', wall.found && !wall.hit && wall.wall, JSON.stringify(wall));
  const fire = await G(async () => {
    const BR = __br.BR, p = BR.player, T = __t;
    const spot = T.open(5);
    __br.GL3D.view = 'FPP';
    p.x = spot.x; p.y = spot.y; p.ang = spot.ang; p.pitch = -0.03;
    const e = BR.bots[0];
    e.x = spot.tx; e.y = spot.ty; e.state = 'ground'; e.alive = true; e.hp = 100; e.armor = 0; e.helmet = 0; e.stance = 'stand';
    e.bot.state = 'LOOTING'; e.bot.reactT = 99;
    const w = __br.giveWeapon('raptor', 0); p.wIdx = 0; w.mag = 30;
    return { hp: e.hp, mag: w.mag };
  });
  await page.dispatchEvent('#btnFire2', 'pointerdown', { pointerId: 70, bubbles: true, cancelable: true });
  await wait(450);
  await page.dispatchEvent('#btnFire2', 'pointerup', { pointerId: 70, bubbles: true, cancelable: true });
  const fired = await G(() => ({ hp: __br.BR.bots[0].hp, mag: __br.BR.player.weapons[0].mag, tracers: __br.BR.tracers.length }));
  ok('左手側の射撃ボタンでも撃てる', fired.mag < fire.mag, fire.mag + '→' + fired.mag);
  ok('実際の射撃でも正面の相手に当たる', fired.hp < fire.hp, 'HP ' + fire.hp + '→' + Math.round(fired.hp));
  ok('オーバーレイにダメージ数値が描かれる', await G(() => {
    const o = document.getElementById('ovl'); const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; return n > 0 || __br.BR.dmgNums.length === 0;
  }));

  /* ================= 6. 人物と装備の見た目 ================= */
  section('6. 人物・装備・一人称の銃');
  const gear = await G(() => {
    const GC = __br.GL3D, BR = __br.BR;
    const look = window.GLChar.lookFor({ id: 'x#1' });
    const n = (h, v, pk, w) => window.GLChar.charMesh(look, h, v, pk, w, 0).data.length / 13;
    const looks = new Set(BR.bots.map(b => window.GLChar.lookFor(b).outfit.name));
    const naked = n(0, 0, 0, null);
    return {
      naked, helm1: n(1, 0, 0, null), helm3: n(3, 0, 0, null), vest3: n(0, 3, 0, null), vest1: n(0, 1, 0, null),
      pack: n(0, 0, 3, null), ar: n(0, 0, 0, 'AR'), sniper: n(0, 0, 0, 'SNIPER'), outfits: looks.size,
      bones: window.GLChar.BONES.length, stable: window.GLChar.lookFor({ id: 'A#5' }).outfit.name === window.GLChar.lookFor({ id: 'A#5' }).outfit.name
    };
  });
  ok('人物のメッシュが十分に細かい', gear.naked > 1500, gear.naked + '頂点');
  ok('ヘルメットのLvで形が変わる', gear.helm1 > gear.naked && gear.helm3 !== gear.helm1, gear.helm1 + ' / ' + gear.helm3);
  ok('ベストのLvで形が変わる（Lv3は襟と肩当て付き）', gear.vest3 > gear.vest1 && gear.vest1 > gear.naked);
  ok('バックパックが付く', gear.pack > gear.naked);
  ok('武器の種類で形が違う', gear.ar !== gear.sniper && gear.ar > gear.naked);
  ok('Botの服装に個体差がある', gear.outfits >= 4, gear.outfits + '種');
  ok('同じ人は毎回同じ服装', gear.stable);
  ok('骨は Model3D と共通（+武器）', gear.bones === 20);
  const armed = await G(() => {
    const BR = __br.BR, e = BR.bots[0];
    e.weapons[0] = BR.makeWeapon('raptor'); e.wIdx = 0; e.helmet = 3; e.armorMax = 120; e.alive = true; e.state = 'ground';
    __t.frame();
    const B = __br.GL3D.bones, W = window.GLChar.BI.weapon * 16, HR = window.GLChar.BI.handR * 16, H = window.GLChar.BI.head * 16, C = window.GLChar.BI.chest * 16;
    __br.GL3D.poseChar(e, BR);
    const d = Math.hypot(B[W + 12] - B[HR + 12], B[W + 13] - B[HR + 13], B[W + 14] - B[HR + 14]);
    const elbowR = window.GLChar.BI.armRL * 16;
    return { gripDist: d, elbowBelowHead: B[elbowR + 14] < B[H + 14], elbowZ: B[elbowR + 14], headZ: B[H + 14], chestZ: B[C + 14], mz: !!e._gl && Array.isArray(e._gl.muzzle) };
  });
  ok('銃が右手に付いている', armed.gripDist < 0.08, armed.gripDist.toFixed(3));
  ok('構えた時に肘が頭より下にある（敬礼のような姿勢にならない）', armed.elbowBelowHead, armed.elbowZ.toFixed(2) + ' < ' + armed.headZ.toFixed(2));
  ok('銃口の位置が取れる（弾道とマズルフラッシュの起点）', armed.mz);
  const vm = await G(() => {
    const BR = __br.BR, GL = __br.GL3D, p = BR.player;
    GL.view = 'FPP'; GL.stats.vm = 0;
    __br.giveWeapon('raptor', 0); p.wIdx = 0; BR.zoomT = 0; BR.curZoom = 1;
    __t.frame();
    const hip = GL.stats.vm;
    const hipMz = GL._vmMuzzle && GL._vmMuzzle.slice();
    __br.giveWeapon('longview', 0); BR.zoomT = 1; BR.curZoom = 4; GL.stats.vm = 0;
    __t.frame();
    const scoped = GL.stats.vm;
    BR.zoomT = 0; BR.curZoom = 1; __br.giveWeapon('raptor', 0); GL.view = 'TPP';
    return { hip, scoped, hipMz: !!hipMz };
  });
  ok('一人称で腕と銃が描かれる', vm.hip === 1 && vm.hipMz);
  ok('スコープを覗いている間は銃を消す', vm.scoped === 0);

  /* ================= 7. 画質 ================= */
  section('7. 光・影・画質設定');
  const light = await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map, GL = __br.GL3D;
    GL.view = 'TPP';
    const bd = m.buildings[0];
    p.x = bd.x + bd.bw / 2; p.y = bd.y - 4; p.ang = Math.PI / 2 + 0.5; p.pitch = -0.25;
    for (let i = 0; i < 30 && BR.solidAt(p.x, p.y); i++) p.y -= 0.7;
    GL.quality = 'AUTO';
    const on = GL.sample(BR, [0, 0.3, 1, 1]);
    GL.quality = 'LOW';
    const off = GL.sample(BR, [0, 0.3, 1, 1]);
    GL.quality = 'AUTO';
    return { on: on.mean, off: off.mean, uniq: on.uniq };
  });
  ok('影で画面の明るさが変わる（影が落ちている）', light.on < light.off - 0.5, light.on.toFixed(1) + ' vs ' + light.off.toFixed(1));
  ok('地上の景色の色数が十分ある', light.uniq > 200, light.uniq + '色');
  const qual = await G(() => {
    const GL = __br.GL3D;
    GL.setQuality('LOW'); const low = { w: GL.W, sh: GL._qual().shadows, grass: GL._qual().grass };
    GL.setQuality('HIGH'); const high = { w: GL.W, sh: GL._qual().shadows, grass: GL._qual().grass };
    GL.setQuality('AUTO');
    return { low, high };
  });
  ok('LOWは解像度を下げ、影と草を切る', qual.low.w < qual.high.w && !qual.low.sh && qual.low.grass === 0, qual.low.w + 'px / ' + qual.high.w + 'px');
  ok('HIGHは影と草が有効', qual.high.sh && qual.high.grass > 0);

  /* ================= 8. 世界の中の物 ================= */
  section('8. アイテム・グレネード・安全地帯');
  const loot = await G(() => {
    const BR = __br.BR, p = BR.player;
    const spot = __t.open(3);
    p.x = spot.x; p.y = spot.y;
    BR.loot.forEach(l => { if (Math.hypot(l.x - p.x, l.y - p.y) < 3) l.alive = false; });
    const mk = (kind, id, tier, name, dx) => { const l = { kind, id, tier, name, count: 1, x: p.x + dx, y: p.y + 0.3, t: 0, alive: true }; BR.loot.push(l); return l; };
    mk('weapon', 'vector', 'common', 'VECTOR AR', 0.2); mk('item', 'medkit', 'rare', 'メドキット', -0.3); mk('item', 'helm3', 'legendary', 'ヘルメット Lv3', 0.5);
    BR.update(0.001);
    __t.frame();
    return { meshes: Object.keys(__br.GL3D.lootMeshes).length };
  });
  await wait(200);
  const lootUi = await G(() => ({ first: !document.getElementById('lootPrompt').classList.contains('hidden'), rows: document.querySelectorAll('#lootMore .loot-row').length }));
  ok('落ちているアイテムが種類ごとの3Dモデルで描かれる', loot.meshes >= 3, loot.meshes + '種');
  ok('足元のアイテムが一覧で出る（最大4つ）', lootUi.first && lootUi.rows >= 2, '1 + ' + lootUi.rows);
  const helm0 = await G(() => __br.BR.player.helmet);
  await G(() => {
    const i = (__br.BRUI._lootRows || []).findIndex(l => l.id === 'helm3');
    const el = i >= 0 ? document.querySelector('#lootMore [data-loot="' + i + '"]') : document.getElementById('lootPrompt');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 77 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 77 }));
  });
  await wait(120);
  ok('一覧の行をタップして拾える', (await G(() => __br.BR.player.helmet)) === 3 || (await G(() => __br.BR.stats.lootPicked)) > 0, 'helmet ' + helm0 + '→' + (await G(() => __br.BR.player.helmet)));
  const nade = await G(async () => {
    const BR = __br.BR, p = BR.player;
    p.items.frag = 1; p.useT = 0; p.switchT = 0;
    const threw = BR.throwFrag(p);
    let seen = false;
    for (let i = 0; i < 90; i++) {
      BR.update(1 / 30);
      __t.frame();
      if (__br.GL3D._blasts.length) { seen = true; break; }
    }
    return { threw, seen };
  });
  ok('グレネードが飛んで爆発の閃光が出る', nade.threw && nade.seen);
  const zone = await G(() => {
    const BR = __br.BR, p = BR.player, z = BR.zone;
    z.r = 6; z.cx = p.x + 12; z.cy = p.y;
    p.ang = 0;
    const s = __br.GL3D.sample(BR, [0.3, 0.2, 0.7, 0.8]);
    z.r = 200; z.cx = BR.map.center.x; z.cy = BR.map.center.y;
    return s;
  });
  ok('安全地帯の青い壁を描いてもエラーが出ない', !!zone && errors.length === 0, errors.join(' | '));

  /* ================= 9. HUD ================= */
  section('9. HUD（方位計・ミニマップ・ボタン配置）');
  const hud = await G(() => {
    const BR = __br.BR, p = BR.player;
    p.ang = -Math.PI / 2;
    __br.BRUI.syncHud(BR);
    const c = document.getElementById('compass');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
    const m = document.getElementById('minimap');
    const md = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
    const cols = new Set(); for (let i = 0; i < md.length; i += 64) cols.add(md[i] >> 4 << 8 | md[i + 1] >> 4 << 4 | md[i + 2] >> 4);
    return { compass: n, mini: cols.size, alive: document.getElementById('aliveNum').textContent, kills: document.getElementById('killNum').textContent };
  });
  ok('方位計が描かれる', hud.compass > 100);
  ok('ミニマップに地表の絵が出る（色数）', hud.mini > 20, hud.mini + '色');
  ok('生存数とキル数が出る', +hud.alive > 0 && hud.kills !== '');
  const layout = await G(() => {
    const ids = ['btnFire', 'btnFire2', 'btnAds', 'btnReload', 'btnSwitch', 'btnSprint', 'btnCrouch', 'btnProne', 'btnItem', 'btnThrow', 'btnBag', 'btnView', 'btnMap'];
    return ids.map(id => {
      const el = document.getElementById(id); const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id, w: r.width, h: r.height, in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, hit: !!(t && (t === el || el.contains(t))) };
    });
  });
  ok('全ボタンが画面内', layout.every(l => l.in), layout.filter(l => !l.in).map(l => l.id).join(','));
  ok('全ボタンが44px以上', layout.every(l => l.w >= 44 && l.h >= 44), layout.filter(l => l.w < 44).map(l => l.id).join(','));
  ok('全ボタンが他の要素に隠れていない', layout.every(l => l.hit), layout.filter(l => !l.hit).map(l => l.id).join(','));
  const run = await G(async () => {
    const I = __br.Input;
    I._stickId = 99; I.move.x = 0; I.move.y = 1;
    await new Promise(r => setTimeout(r, 600));
    const s = __br.BR.player.sprinting;
    I._stickId = null; I.move.y = 0;
    return s;
  });
  ok('スティックを前に倒し切ると自動でダッシュ', run);

  /* ================= 10. 性能 ================= */
  section('10. 性能と後始末');
  const perf = await G(() => {
    const BR = __br.BR, GL = __br.GL3D;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { GL.render(BR, 1 / 60); GL.gl.finish(); }
    const full = (performance.now() - t0) / 20;
    let cpu = 0;
    for (let i = 0; i < 20; i++) { GL.render(BR, 1 / 60); cpu += GL.stats.ms; }
    return { full, cpu: cpu / 20, draws: GL.stats.draws };
  });
  ok('描画命令の発行（CPU側）が軽い', perf.cpu < 12, perf.cpu.toFixed(2) + 'ms / ' + perf.draws + 'draw');
  ok('ソフトウェアGPUでも1フレームが描き切れる', perf.full < 1500, perf.full.toFixed(0) + 'ms（GPUのある実機では数ms）');
  // 2試合目: 世界が作り直され、古い世界は捨てられる
  await G(() => { __br.godMode(false); __br.BR.kill(__br.BR.player, null); });
  await until(() => !document.getElementById('resultScreen').classList.contains('hidden'), 5000);
  await press('[data-nav="again"]');
  await until(() => __br.BR.state === 'PLANE', 5000);
  await until(() => __br.GL3D.map === __br.BR.map, 6000);
  const worlds = await G(() => Object.keys(__br.GL3D._worlds).length);
  ok('2試合目の世界に切り替わる', await G(() => __br.GL3D.map === __br.BR.map));
  ok('古い試合の世界は破棄される（ロビー+今の試合だけ残る）', worlds <= 2, worlds + '個');
  ok('全工程を通してエラーが出ない', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  await new Promise(r => server.close(r));
  console.log(results.join('\n'));
  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
