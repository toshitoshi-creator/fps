/* =========================================================================
 * tooltest.js — tools/scan2map.html をブラウザで実際に操作し、
 * スキャン → マップ変換 → ゲームへの登録 → 実プレイ まで通しで検証する。
 *   node test/tooltest.js
 * ======================================================================= */
function loadPlaywright() {
  const cands = [process.env.PW, 'playwright', '@playwright/test'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  throw new Error('playwright が見つかりません。`npm i -D playwright` を実行してください。');
}
function launchOpts() {
  const fs = require('fs');
  const args = ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage'];
  const paths = [process.env.CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const p of paths) if (fs.existsSync(p)) return { executablePath: p, args };
  return { args };
}
const { chromium } = loadPlaywright();
const server = require('./serve.js');
const PORT = 8957;

let pass = 0, fail = 0;
const log = [];
const ok = (n, c, i) => {
  if (c) { pass++; log.push('  \x1b[32m✓\x1b[0m ' + n + (i ? '  \x1b[90m' + i + '\x1b[0m' : '')); }
  else { fail++; log.push('  \x1b[31m✗ ' + n + '\x1b[0m' + (i ? '  ' + i : '')); }
};
const section = t => log.push('\n\x1b[36m▌' + t + '\x1b[0m');
const report = () => {
  console.log(log.join('\n'));
  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch(launchOpts());
  const ctx = await b.newContext({ viewport: { width: 1180, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });

  /* ---------------- ツール画面 ---------------- */
  section('1. 変換ツールの起動');
  await page.goto(`http://127.0.0.1:${PORT}/tools/scan2map.html`);
  await page.waitForFunction(() => window.__scan2map);
  await page.waitForTimeout(200);
  ok('ページがエラーなく開く', errors.length === 0, errors.join(' | '));
  ok('変換ライブラリが読み込まれている', await page.evaluate(() => !!window.Scan2Map));
  ok('初期状態では未読み込み', (await page.textContent('#stat')).includes('まだ'));

  section('2. スキャンの読み込みと変換');
  await page.click('#demo');
  await page.waitForFunction(() => window.__scan2map.state.grid, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    const s = window.__scan2map.state;
    return { w: s.grid.w, h: s.grid.h, free: s.grid.freeCells, pts: s.cloud.count, tilt: s.grid.plane.tiltDeg, cell: s.grid.cell };
  });
  ok('点群が生成・変換される', g.pts > 30000, g.pts.toLocaleString() + ' 点');
  ok('妥当なサイズのグリッドになる', g.w >= 16 && g.w <= 26 && g.h >= 9 && g.h <= 18, g.w + '×' + g.h + ' cell=' + g.cell.toFixed(2) + 'm');
  ok('歩ける空間が確保される', g.free > 80, 'free=' + g.free);
  ok('検証を通過する（そのまま遊べる）', (await page.textContent('#issues')).includes('✓'), await page.textContent('#issues'));
  ok('プレイ開始ボタンが有効になる', !(await page.isDisabled('#play')));
  ok('ステージ定義が出力される', (await page.inputValue('#out')).includes('map: ['));

  section('3. パラメータ操作が結果に反映される');
  const before = await page.evaluate(() => window.__scan2map.state.grid.w);
  await page.evaluate(() => { const e = document.getElementById('cell'); e.value = 150; e.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__scan2map.state.grid.w);
  ok('セルサイズを変えるとグリッドが変わる', after < before, before + ' → ' + after + ' 列');
  await page.evaluate(() => { const e = document.getElementById('cell'); e.value = 100; e.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(500);
  const rotBefore = await page.evaluate(() => [window.__scan2map.state.grid.w, window.__scan2map.state.grid.h]);
  await page.click('#rotR');
  await page.waitForTimeout(400);
  const rotAfter = await page.evaluate(() => [window.__scan2map.state.grid.w, window.__scan2map.state.grid.h]);
  ok('回転で縦横が入れ替わる', rotAfter[0] === rotBefore[1] && rotAfter[1] === rotBefore[0],
    rotBefore.join('×') + ' → ' + rotAfter.join('×'));
  await page.click('#rotL');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const e = document.getElementById('ecount'); e.value = 9; e.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(500);
  ok('敵の数スライダーが効く', (await page.evaluate(() => window.__scan2map.state.enemies.length)) === 9,
    (await page.evaluate(() => window.__scan2map.state.enemies.length)) + '体');

  section('4. キャンバス直接編集');
  const painted = await page.evaluate(() => {
    const st = window.__scan2map.state, g = st.grid;
    // 中央付近の床セルを探して壁を塗る
    let target = null;
    for (let y = 2; y < g.h - 2 && !target; y++) for (let x = 2; x < g.w - 2; x++)
      if (!g.grid[y * g.w + x]) { target = { x, y }; break; }
    const before = g.grid[target.y * g.w + target.x];
    document.querySelector('.tool[data-t="wall"]').click();
    const r = document.getElementById('cv').getBoundingClientRect();
    const view = { s: 0 };
    // 実際のポインタ操作でセルを塗る
    const s = (window.devicePixelRatio);
    const ev = (type, cx, cy) => document.getElementById('cv').dispatchEvent(
      new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 1 }));
    // canvas 座標 → 画面座標は draw() の view を使う必要があるため、内部関数経由で位置を割り出す
    const cv = document.getElementById('cv');
    const rect = cv.getBoundingClientRect();
    // fit() と同じ計算を再現
    const W = cv.width, H = cv.height, pad = 20 * s;
    const sc = Math.max(4, Math.min((W - pad * 2) / g.w, (H - pad * 2) / g.h));
    const ox = (W - g.w * sc) / 2, oy = (H - g.h * sc) / 2;
    const px = rect.left + (ox + (target.x + 0.5) * sc) / s;
    const py = rect.top + (oy + (target.y + 0.5) * sc) / s;
    ev('pointerdown', px, py); ev('pointerup', px, py);
    return { before, after: window.__scan2map.state.grid.grid[target.y * g.w + target.x], target };
  });
  ok('クリックで床を壁に塗れる', painted.before === 0 && painted.after === 1,
    `(${painted.target.x},${painted.target.y}) ${painted.before}→${painted.after}`);

  section('5. ゲームへの登録');
  await page.click('#play');
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('steel_protocol_custom_stage');
    return raw ? JSON.parse(raw) : null;
  });
  ok('localStorage にマップが保存される', !!stored && Array.isArray(stored.map), stored ? stored.map.length + ' 行' : 'なし');
  ok('保存されたマップに開始地点がある', !!stored && stored.map.join('').includes('P'));
  ok('保存されたマップに敵がいる', !!stored && /[grshB]/.test(stored.map.join('')));
  await page.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => { });
  ok('ゲーム画面へ遷移する', page.url().includes('index.html'), page.url());

  /* ---------------- ゲーム側 ---------------- */
  section('6. 取り込んだマップが実際に遊べる');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.waitForTimeout(400);
  const G = fn => page.evaluate(fn);
  ok('カスタムステージが登録される', await G(() => __game.DATA.STAGES.some(s => s.custom)));
  ok('本編のステージ数は10のままである', (await G(() => __game.DATA.builtinStages().length)) === 10);
  await page.click('[data-nav="stage"]');
  await page.waitForTimeout(250);
  ok('STAGE一覧にCUSTOMカードが出る', (await page.locator('.stage-card.custom').count()) === 1);
  ok('CUSTOMは最初から選択できる', !(await page.locator('.stage-card.custom').first().getAttribute('class')).includes('locked'));
  await page.locator('.stage-card.custom').first().click();
  await page.waitForTimeout(250);
  ok('ブリーフィングが出る', await page.isVisible('#briefScreen'));
  ok('CUSTOM MAP と表示される', (await page.textContent('#briefStage')).includes('CUSTOM'));
  await page.click('[data-nav="deploy"]');
  await page.waitForTimeout(500);
  const play = await G(() => ({
    state: __game.state(), id: __game.Game.stage.id, custom: !!__game.Game.stage.custom,
    enemies: __game.Game.enemies.length, w: __game.Game.map.w, h: __game.Game.map.h,
    inWall: __game.Game.map.grid[(__game.Game.player.y | 0) * __game.Game.map.w + (__game.Game.player.x | 0)] !== 0,
    eInWall: __game.Game.enemies.filter(e => __game.Game.map.grid[(e.y | 0) * __game.Game.map.w + (e.x | 0)] !== 0).length
  }));
  ok('スキャンマップでゲームが開始する', play.state === 'playing' && play.custom, 'stage=' + play.id);
  ok('敵が出現する', play.enemies > 0, play.enemies + '体 / ' + play.w + '×' + play.h);
  ok('プレイヤーが壁に埋まっていない', !play.inWall);
  ok('敵が壁に埋まっていない', play.eInWall === 0);

  const fight = await page.evaluate(async () => {
    const G2 = __game.Game, R = __game.Render, p = G2.player;
    // 実際に撃って倒せるか
    let target = null, bd = 1e9;
    G2.enemies.forEach(e => {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (R.los(G2.map, p.x, p.y, e.x, e.y) && d < bd) { bd = d; target = e; }
    });
    if (!target) {
      // 見えていなければ敵が近づいてくるまで回す
      for (let i = 0; i < 900 && !target; i++) {
        G2.update(1 / 60);
        G2.enemies.forEach(e => { if (!target && R.los(G2.map, p.x, p.y, e.x, e.y)) target = e; });
        if (i % 60 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    if (!target) return { err: '敵と遭遇できませんでした' };
    __game.aimAt(target);
    const hp0 = target.hp;
    __game.shootOnce();
    const hit = target.hp < hp0;
    // 全滅させてクリアまで
    G2.enemies.forEach(e => { let n = 0; while (e.state !== 'dead' && n++ < 400) G2.damageEnemy(e, 999, false, 'body', .6); });
    for (let i = 0; i < 200; i++) { G2.update(1 / 60); await new Promise(r => setTimeout(r, 0)); if (G2.state !== 'playing') break; }
    return { hit, state: G2.state, kills: G2.kills, dist: bd };
  });
  ok('スキャンマップ内で敵に命中する', fight.hit === true, fight.err || ('距離 ' + (fight.dist || 0).toFixed(1) + 'm'));
  ok('スキャンマップをクリアできる', fight.state === 'clear', 'state=' + fight.state + ' kills=' + fight.kills);
  ok('クリア画面が出る', await page.isVisible('#clearScreen'));

  section('7. 本編の進行度が汚染されない');
  const prog = await G(() => ({ cleared: __game.Save.data.cleared.slice(), max: __game.Save.maxStage(), coins: __game.Save.data.coins }));
  ok('カスタムクリアは cleared に入らない', prog.cleared.indexOf(99) < 0 && prog.cleared.length === 0, JSON.stringify(prog.cleared));
  ok('本編の解放ステージは1のまま', prog.max === 1, 'maxStage=' + prog.max);
  ok('コインは獲得できる', prog.coins > 0, prog.coins + '◆');

  section('8. 登録の削除');
  await page.goto(`http://127.0.0.1:${PORT}/tools/scan2map.html`);
  await page.waitForFunction(() => window.__scan2map);
  await page.click('#rm');
  await page.waitForTimeout(200);
  ok('登録を削除できる', (await page.evaluate(() => localStorage.getItem('steel_protocol_custom_stage'))) === null);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.waitForTimeout(300);
  ok('削除後はCUSTOMが消える', !(await G(() => __game.DATA.STAGES.some(s => s.custom))));
  ok('本編は通常どおり動く', (await G(() => __game.DATA.STAGES.length)) === 10);

  section('9. 壊れたデータへの耐性');
  const robust = await page.evaluate(() => {
    const bad = [
      'not json at all', '{}', '{"map":[]}', '{"map":["###","#.#"]}',
      JSON.stringify({ map: ['####', '#..#', '####'] }),                       // P も敵も無い
      JSON.stringify({ map: ['#####', '#P..#', '####'] }),                     // 行長が不揃い
      JSON.stringify({ map: Array(70).fill('#'.repeat(70)) })                  // 大きすぎる
    ];
    const results = [];
    bad.forEach(v => {
      localStorage.setItem('steel_protocol_custom_stage', v);
      let threw = false, added = false;
      try { added = !!__game.DATA.installCustomStage(); } catch (e) { threw = true; }
      results.push({ threw, added });
    });
    localStorage.removeItem('steel_protocol_custom_stage');
    __game.DATA.installCustomStage();
    return results;
  });
  ok('壊れた保存データで例外を投げない', robust.every(r => !r.threw));
  ok('壊れた保存データは取り込まない', robust.every(r => !r.added));
  ok('壊れたデータの後も本編は10ステージ', (await G(() => __game.DATA.STAGES.length)) === 10);

  section('10. 実行時エラー');
  ok('全工程を通してJSエラーが無い', errors.length === 0, errors.slice(0, 3).join(' | '));

  report();
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { report(); console.error('\n\x1b[31mABORTED:\x1b[0m', e.message); process.exit(2); });
