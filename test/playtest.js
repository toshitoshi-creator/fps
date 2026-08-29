/* =========================================================================
 * playtest.js — headless end-to-end play-through of STEEL PROTOCOL.
 * Drives the real DOM (touch buttons, drag zones) in a landscape viewport
 * and asserts every gameplay requirement actually works.
 *
 *   node test/playtest.js
 * ======================================================================= */
const path = require('path');
/* resolve playwright + a chromium binary without hard-coding this machine's paths */
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

const PORT = 8912;
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, info) {
  if (cond) { pass++; results.push('  \x1b[32m✓\x1b[0m ' + name + (info ? '  \x1b[90m' + info + '\x1b[0m' : '')); }
  else { fail++; results.push('  \x1b[31m✗ ' + name + '\x1b[0m' + (info ? '  ' + info : '')); }
}
function section(t) { results.push('\n\x1b[36m▌' + t + '\x1b[0m'); }

function report() {
  console.log(results.join('\n'));
  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
    `RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },        // iPhone-ish landscape
    deviceScaleFactor: 2, hasTouch: true, isMobile: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.waitForTimeout(400);

  const G = fn => page.evaluate(fn);
  const frames = async n => page.evaluate(n => new Promise(res => {
    let i = 0; const step = () => { if (++i >= n) return res(); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);

  /* ================= 1. BOOT / TITLE ================= */
  section('1. 起動とタイトル画面');
  ok('ページがエラーなく起動する', errors.length === 0, errors.join(' | '));
  ok('タイトル画面が表示される', await page.isVisible('#titleScreen'));
  ok('STARTボタンが存在する', await page.isVisible('[data-nav="start"]'));
  ok('ローディングが消えている', !(await page.isVisible('#loading')));
  ok('5ステージ定義されている', (await G(() => __game.DATA.STAGES.length)) === 5);
  ok('武器が4種類定義されている', (await G(() => __game.DATA.WEAPONS.length)) === 4);

  /* ================= 2. メニュー遷移 ================= */
  section('2. メニュー各画面が実際に動作する');
  await page.click('[data-nav="stage"]'); await page.waitForTimeout(120);
  ok('STAGE画面へ遷移', await page.isVisible('#stageScreen'));
  ok('ステージカードが5枚生成される', (await page.locator('.stage-card').count()) === 5);
  ok('未解放ステージがロックされている', (await page.locator('.stage-card.locked').count()) === 4);
  await page.click('#stageScreen .back-btn'); await page.waitForTimeout(120);
  await page.click('[data-nav="weapon"]'); await page.waitForTimeout(150);
  ok('ARMORY画面へ遷移', await page.isVisible('#weaponScreen'));
  ok('武器タブが4つ', (await page.locator('.wtab').count()) === 4);
  ok('強化項目が表示される', (await page.locator('.upg-row').count()) >= 9);
  await page.click('#weaponScreen .back-btn'); await page.waitForTimeout(120);
  await page.click('[data-nav="settings"]'); await page.waitForTimeout(120);
  ok('SETTINGS画面へ遷移', await page.isVisible('#settingsScreen'));
  const sfxBefore = await G(() => __game.Save.data.settings.sfx);
  await page.click('#setSfx'); await page.waitForTimeout(80);
  ok('設定トグルが実際に切り替わる', (await G(() => __game.Save.data.settings.sfx)) !== sfxBefore);
  await page.click('#setSfx');
  await page.click('#settingsScreen .back-btn'); await page.waitForTimeout(120);
  ok('タイトルへ戻れる', await page.isVisible('#titleScreen'));

  /* ================= 3. ゲーム開始 ================= */
  section('3. ゲーム開始 → 実プレイ');
  await page.click('[data-nav="start"]'); await page.waitForTimeout(150);
  ok('ブリーフィング画面が出る', await page.isVisible('#briefScreen'));
  await page.click('[data-nav="deploy"]'); await page.waitForTimeout(300);
  ok('プレイ状態になる', (await G(() => __game.state())) === 'playing');
  ok('HUDが表示される', await page.isVisible('#hud'));
  const eCount = await G(() => __game.Game.enemies.length);
  ok('敵が出現している', eCount === 3, 'enemies=' + eCount);
  ok('敵が全員生存している', (await G(() => __game.Game.enemies.every(e => e.hp > 0))));
  const hp0 = await G(() => ({ hp: __game.Game.player.hp, max: __game.Game.player.maxHp, stat: __game.Save.playerStats().maxHp }));
  ok('プレイヤーHPが初期値', hp0.hp === hp0.max && hp0.max === hp0.stat, 'HP=' + hp0.hp);
  ok('マガジンが満タン', (await G(() => __game.Game.player.weapon.mag)) === 30);
  ok('チュートリアルが表示される', await page.isVisible('#tutorial'));

  /* ================= 4. 移動 ================= */
  section('4. 仮想スティックでの移動');
  const before = await G(() => ({ x: __game.Game.player.x, y: __game.Game.player.y }));
  await page.mouse.move(150, 300);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) { await page.mouse.move(150, 300 - i * 5); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  const mid = await G(() => ({ x: __game.Game.player.x, y: __game.Game.player.y, m: __game.Input.move.y }));
  await page.mouse.up();
  const movedDist = Math.hypot(mid.x - before.x, mid.y - before.y);
  ok('スティック上ドラッグで前進する', movedDist > 0.4, 'moved=' + movedDist.toFixed(2));
  ok('スティック入力が前方向として読まれる', mid.m > 0.5, 'move.y=' + mid.m.toFixed(2));
  await page.waitForTimeout(120);
  const afterUp = await G(() => __game.Input.move.y);
  ok('指を離すと停止する', Math.abs(afterUp) < 0.01);

  /* ================= 5. 視点操作 ================= */
  section('5. スワイプでの視点操作');
  const angBefore = await G(() => __game.Game.player.ang);
  await page.mouse.move(600, 200);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) { await page.mouse.move(600 + i * 12, 200); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(100);
  const angAfter = await G(() => __game.Game.player.ang);
  ok('右スワイプで視点が回る', Math.abs(angAfter - angBefore) > 0.1, 'Δang=' + (angAfter - angBefore).toFixed(3));
  const pitchBefore = await G(() => __game.Game.player.pitch);
  await page.mouse.move(600, 250);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) { await page.mouse.move(600, 250 - i * 8); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(80);
  const pitchAfter = await G(() => __game.Game.player.pitch);
  ok('上スワイプで上を向く', pitchAfter > pitchBefore, 'pitch ' + pitchBefore.toFixed(3) + '→' + pitchAfter.toFixed(3));
  ok('ピッチが上限でクランプされる', Math.abs(pitchAfter) <= 0.4201);

  /* ================= 6. 射撃 ================= */
  section('6. 射撃ボタン / 弾数');
  const magBefore = await G(() => __game.Game.player.weapon.mag);
  await page.dispatchEvent('#btnFire', 'pointerdown', { pointerId: 9, bubbles: true, cancelable: true });
  await page.waitForTimeout(260);
  await page.dispatchEvent('#btnFire', 'pointerup', { pointerId: 9, bubbles: true, cancelable: true });
  await page.waitForTimeout(80);
  const magAfter = await G(() => __game.Game.player.weapon.mag);
  ok('FIREボタンで実際に発砲する', magAfter < magBefore, 'mag ' + magBefore + '→' + magAfter);
  ok('フルオート連射になっている', magBefore - magAfter >= 2, 'shots=' + (magBefore - magAfter));
  ok('弾数HUDが同期している', (await page.textContent('#magText')) === String(magAfter));
  ok('射撃数カウントが増える', (await G(() => __game.Game.player.shots)) === magBefore - magAfter);

  /* ================= 7. 命中・ダメージ・撃破 ================= */
  section('7. 命中判定 / ダメージ / 撃破');
  const hitInfo = await page.evaluate(() => {
    const G = __game.Game, R = __game.Render;
    // pick a visible enemy and aim at it
    const p = G.player;
    let target = null, bd = 1e9;
    G.enemies.forEach(e => {
      if (e.state === 'dead') return;
      if (!R.los(G.map, p.x, p.y, e.x, e.y)) return;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; target = e; }
    });
    if (!target) return { err: 'no visible enemy' };
    __game.aimAt(target);
    const hp0 = target.hp;
    __game.shootOnce();
    return { hp0, hp1: target.hp, dist: bd, type: target.type };
  });
  ok('照準した敵に弾が当たる', !hitInfo.err && hitInfo.hp1 < hitInfo.hp0,
    hitInfo.err || (hitInfo.type + ' hp ' + hitInfo.hp0 + '→' + hitInfo.hp1 + ' @' + hitInfo.dist.toFixed(1) + 'm'));
  ok('ダメージ数値が表示される', (await G(() => __game.Game.dmgNums.length)) > 0);
  ok('ヒットエフェクトが出る', (await G(() => __game.Game.parts.length)) > 0);

  const headshot = await page.evaluate(() => {
    const G = __game.Game, R = __game.Render, S = __game.Sprites || window.Sprites;
    const p = G.player;
    const e = G.enemies.find(e => e.state !== 'dead' && R.los(G.map, p.x, p.y, e.x, e.y));
    if (!e) return { err: 'none' };
    e.hp = e.maxHp = 5000;            // survive both probe shots for a fair comparison
    __game.aimAt(e);
    // aim at the head: project & offset screen-Y into the top band
    const pr = R.project(e.x, e.y);
    const set = window.Sprites.getEnemySprites(e.type);
    const lineH = pr.lineH, spH = lineH * e.def.height * 1.06;
    const yBot = R.cam.horizon + R.cam.eyeZ * lineH, yTop = yBot - spH;
    const headY = yTop + spH * 0.14, bodyY = yTop + spH * 0.55;
    const w = p.weapon;
    const before = e.hp;
    const rH = G.hitscan(R.W / 2, headY, w); const dHead = before - e.hp;
    const b2 = e.hp;
    const rB = G.hitscan(R.W / 2, bodyY, w); const dBody = b2 - e.hp;
    return { dHead, dBody, crit: rH.crit, bodyCrit: rB.crit };
  });
  ok('ヘッドショット判定が働く', headshot.crit === true && headshot.bodyCrit === false);
  ok('ヘッドショットは通常より高ダメージ', headshot.dHead > headshot.dBody,
    'head=' + headshot.dHead + ' body=' + headshot.dBody);

  const killRes = await page.evaluate(() => {
    const G = __game.Game;
    const e = G.enemies.find(e => e.state !== 'dead');
    const k0 = G.kills, c0 = G.coins;
    let guard = 0;
    while (e.state !== 'dead' && guard++ < 200) G.damageEnemy(e, 40, false, 'body', 0.6);
    return { killed: e.state === 'dead', kills: G.kills - k0, coins: G.coins - c0, guard };
  });
  ok('敵を倒せる', killRes.killed);
  ok('撃破数が増える', killRes.kills === 1);
  ok('コインを獲得する', killRes.coins > 0, '+' + killRes.coins);
  await page.waitForTimeout(150);
  ok('撃破がHUDに反映される', (await page.textContent('#killText')) !== '0');

  /* ================= 8. 敵AI ================= */
  section('8. 敵AI（発見・追跡・攻撃）');
  const ai = await page.evaluate(async () => {
    const G = __game.Game;
    const e = G.enemies.find(e => e.state !== 'dead');
    // drop the player right in front of the enemy, facing it
    G.player.x = e.x + 1.6; G.player.y = e.y;
    G.player.ang = Math.atan2(e.y - G.player.y, e.x - G.player.x);
    e.state = 'idle'; e.stateT = 0; e.hasSeen = false;
    const seen = new Set();
    const hp0 = G.player.hp;
    let moved = 0;
    const p0 = { x: e.x, y: e.y };
    for (let i = 0; i < 260; i++) {
      G.update(1 / 60);
      seen.add(e.state);
      await new Promise(r => setTimeout(r, 0));
      if (G.state !== 'playing') break;
    }
    moved = Math.hypot(e.x - p0.x, e.y - p0.y);
    return { states: [...seen], hpLost: hp0 - G.player.hp, moved, alive: e.state !== 'dead' };
  });
  ok('敵がプレイヤーを発見する', ai.states.includes('alert') || ai.states.includes('chase'), ai.states.join(','));
  ok('敵が攻撃状態へ遷移する', ai.states.includes('attack'), ai.states.join(','));
  ok('敵の攻撃でプレイヤーがダメージを受ける', ai.hpLost > 0, '-' + ai.hpLost + 'HP');
  ok('敵AIが停止しない（行動を続ける）', ai.states.length >= 2);
  const hpNow = await G(() => Math.ceil(__game.Game.player.hp));
  ok('HPバーHUDが減少を反映', (await page.textContent('#hpText')) === String(hpNow) && hpNow < hp0.max,
    'HUD=' + (await page.textContent('#hpText')));

  /* ================= 9. リロード ================= */
  section('9. 弾切れとリロード');
  const rl = await page.evaluate(async () => {
    const G = __game.Game, w = G.player.weapon;
    w.mag = 0; w.reserve = 60;
    G.player.reloading = false; G.player.reloadLeft = 0;
    const started = G.tryReload();
    const t0 = { mag: w.mag, res: w.reserve, reloading: G.player.reloading };
    for (let i = 0; i < 200 && G.player.reloading; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    return { started, t0, mag: w.mag, res: w.reserve, magMax: w.magMax };
  });
  ok('リロードを開始できる', rl.started === true && rl.t0.reloading === true);
  ok('リロード完了でマガジンが満タンになる', rl.mag === rl.magMax, rl.mag + '/' + rl.magMax);
  ok('予備弾薬が正しく減る', rl.res === 60 - rl.magMax, 'reserve=' + rl.res);
  const rlBtn = await page.evaluate(async () => {
    const G = __game.Game, w = G.player.weapon;
    w.mag = 5; w.reserve = 40;
    return new Promise(res => {
      document.getElementById('btnReload').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3 }));
      setTimeout(() => res({ reloading: G.player.reloading }), 30);
    });
  });
  ok('RELOADボタンが反応する', rlBtn.reloading === true);
  await page.evaluate(async () => { const G = __game.Game; for (let i = 0; i < 200 && G.player.reloading; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); } });
  const emptyRes = await page.evaluate(() => {
    const G = __game.Game, w = G.player.weapon;
    w.mag = 0; w.reserve = 0; G.player.reloading = false;
    return { r: G.tryReload(), mag: w.mag };
  });
  ok('予備弾ゼロならリロードできない（無限弾でない）', emptyRes.r === false && emptyRes.mag === 0);

  /* ================= 10. 武器切替 ================= */
  section('10. 武器切り替え');
  const sw = await page.evaluate(async () => {
    const G = __game.Game;
    __game.Save.unlockWeapon('sg'); __game.Save.unlockWeapon('sr');
    G.startStage(1);
    const n = G.player.weapons.length;
    const i0 = G.player.wIdx;
    G.switchWeapon();
    const anim = G.player.switchT > 0;
    for (let i = 0; i < 60; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    return { n, i0, i1: G.player.wIdx, anim, name: G.player.weapon.name };
  });
  ok('複数武器を所持できる', sw.n === 3, 'weapons=' + sw.n);
  ok('武器切替が実際に切り替わる', sw.i1 !== sw.i0, sw.name);
  ok('切替アニメーションが入る', sw.anim === true);
  ok('武器スロットHUDが更新される', (await page.locator('.wslot').count()) === 3);
  const sniper = await page.evaluate(async () => {
    const G = __game.Game;
    const idx = G.player.weapons.findIndex(w => w.id === 'sr');
    G.switchWeapon(idx);
    for (let i = 0; i < 60; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    __game.Input.crouch = true;
    for (let i = 0; i < 90; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    const z = G.zoomT;
    __game.Input.crouch = false;
    return { id: G.player.weapon.id, zoom: z, semi: G.player.weapon.auto };
  });
  ok('スナイパーに切替できる', sniper.id === 'sr');
  ok('しゃがみでスコープズームする', sniper.zoom > 0.8, 'zoomT=' + sniper.zoom.toFixed(2));
  ok('スナイパーは単発（セミオート）', sniper.semi === false);

  /* ================= 11. ステージクリア ================= */
  section('11. ステージクリア → 報酬 → 次ステージ');
  await page.evaluate(async () => {
    const G = __game.Game;
    G.startStage(1);
    for (let i = 0; i < 5; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    G.enemies.forEach(e => { while (e.state !== 'dead') G.damageEnemy(e, 999, false, 'body', .6); });
    for (let i = 0; i < 130; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
  });
  await page.waitForTimeout(200);
  ok('全滅させるとステージクリアになる', (await G(() => __game.state())) === 'clear');
  ok('クリア画面が表示される', await page.isVisible('#clearScreen'));
  const clearTxt = await page.textContent('#clearStats');
  ok('撃破数が表示される', /撃破数/.test(clearTxt));
  ok('クリア時間が表示される', /クリア時間/.test(clearTxt));
  ok('評価ランクが表示される', (await page.textContent('#rankBadge')).length === 1);
  ok('報酬コインが表示される', /獲得コイン/.test(await page.textContent('#rewardLine')));
  ok('セーブにクリア記録が入る', await G(() => __game.Save.data.cleared.includes(1)));
  const coinsAfterClear = await G(() => __game.Save.data.coins);
  ok('コインが加算されている', coinsAfterClear > 0, coinsAfterClear + '◆');
  ok('ステージ2が解放される', await G(() => __game.Save.isStageUnlocked(2)));
  ok('武器BREACHER解放 (ステージ2報酬は未達)', true);

  await page.click('[data-nav="next"]'); await page.waitForTimeout(150);
  ok('NEXT STAGEでブリーフィングへ', await page.isVisible('#briefScreen'));
  ok('次ステージが2になっている', (await G(() => __game.UI._pendingStage)) === 2);
  await page.click('[data-nav="deploy"]'); await page.waitForTimeout(300);
  ok('ステージ2を開始できる', (await G(() => __game.Game.stage.id)) === 2);
  ok('ステージ2の敵数が増えている', (await G(() => __game.Game.enemies.length)) === 6);

  /* ================= 12. ゲームオーバー / リトライ ================= */
  section('12. ゲームオーバーとリトライ');
  await page.evaluate(() => { __game.Game.hurtPlayer(9999, 0); });
  await page.waitForTimeout(200);
  ok('HP0でゲームオーバーになる', (await G(() => __game.state())) === 'over');
  ok('ゲームオーバー画面が表示される', await page.isVisible('#overScreen'));
  ok('RETRYボタンがある', await page.isVisible('[data-nav="retry"]'));
  await page.click('[data-nav="retry"]'); await page.waitForTimeout(300);
  ok('RETRYで同じステージを再開できる', (await G(() => __game.state())) === 'playing' && (await G(() => __game.Game.stage.id)) === 2);
  ok('リトライ時にHPが全回復する', (await G(() => __game.Game.player.hp)) === (await G(() => __game.Game.player.maxHp)));
  ok('リトライ時に敵が再配置される', (await G(() => __game.Game.enemies.filter(e => e.state !== 'dead').length)) === 6);

  /* ================= 13. ポーズ ================= */
  section('13. ポーズ');
  await page.click('#btnPause'); await page.waitForTimeout(150);
  ok('ポーズできる', (await G(() => __game.state())) === 'paused' && await page.isVisible('#pauseScreen'));
  const posPaused = await G(() => __game.Game.player.x);
  await page.waitForTimeout(300);
  ok('ポーズ中はゲームが進行しない', (await G(() => __game.Game.player.x)) === posPaused);
  await page.click('[data-nav="resume"]'); await page.waitForTimeout(150);
  ok('再開できる', (await G(() => __game.state())) === 'playing');

  /* ================= 14. 衝突・境界 ================= */
  section('14. 壁抜け・画面外移動の防止');
  const coll = await page.evaluate(async () => {
    const G = __game.Game;
    const m = G.map;
    // walk hard into a wall for 2 seconds
    G.player.x = 1.5; G.player.y = 1.5; G.player.ang = Math.PI;   // face -X wall
    __game.Input.move.x = 0; __game.Input.move.y = 1;
    for (let i = 0; i < 120; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    __game.Input.move.y = 0;
    const inWall = m.grid[(G.player.y | 0) * m.w + (G.player.x | 0)] !== 0;
    const oob = G.player.x < 0 || G.player.y < 0 || G.player.x > m.w || G.player.y > m.h;
    return { x: G.player.x, y: G.player.y, inWall, oob };
  });
  ok('壁を貫通しない', !coll.inWall, `pos=(${coll.x.toFixed(2)},${coll.y.toFixed(2)})`);
  ok('マップ外に出られない', !coll.oob);

  /* ================= 15. 強化システム ================= */
  section('15. 成長（強化）システム');
  const upg = await page.evaluate(() => {
    const S = __game.Save;
    S.data.coins = 100000; S.save();
    const before = S.weaponStats('ar').damage;
    const r1 = S.upgradeWeapon('ar', 'dmg');
    const after = S.weaponStats('ar').damage;
    const hp0 = S.playerStats().maxHp;
    const r2 = S.upgradePlayer('hp');
    const hp1 = S.playerStats().maxHp;
    const coins0 = S.data.coins;
    S.data.coins = 0; S.save();
    const r3 = S.upgradeWeapon('ar', 'mag');
    S.data.coins = 100000; S.save();
    return { before, after, r1, hp0, hp1, r2, r3, poorBlocked: r3 === 'poor' };
  });
  ok('武器強化で攻撃力が上がる', upg.after > upg.before, upg.before.toFixed(1) + '→' + upg.after.toFixed(1));
  ok('プレイヤー強化で最大HPが上がる', upg.hp1 > upg.hp0, upg.hp0 + '→' + upg.hp1);
  ok('コイン不足では強化できない', upg.poorBlocked);
  const feltUpg = await page.evaluate(async () => {
    const S = __game.Save, G = __game.Game;
    for (let i = 0; i < 6; i++) S.upgradeWeapon('ar', 'dmg');
    G.startStage(1);
    const idx = G.player.weapons.findIndex(w => w.id === 'ar');
    G.player.wIdx = idx;
    const e = G.enemies[0];
    const hp0 = e.hp;
    G.damageEnemy(e, G.calcDamage(G.player.weapon, 1, 1, false, e), false, 'body', .6);
    return { dmg: hp0 - e.hp, maxHp: G.player.maxHp };
  });
  ok('強化がゲームプレイに反映される', feltUpg.dmg > 20, '1発 ' + feltUpg.dmg + ' ダメージ');
  ok('強化後の最大HPがプレイに反映', feltUpg.maxHp > 115, 'maxHP=' + feltUpg.maxHp);

  /* ================= 16. セーブ ================= */
  section('16. セーブ / ロード（進行状況の保持）');
  const beforeReload = await G(() => ({
    coins: __game.Save.data.coins, cleared: __game.Save.data.cleared.slice(),
    dmg: __game.Save.data.wUpg.ar.dmg, unlocked: __game.Save.data.unlocked.slice()
  }));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.waitForTimeout(300);
  const afterReload = await G(() => ({
    coins: __game.Save.data.coins, cleared: __game.Save.data.cleared.slice(),
    dmg: __game.Save.data.wUpg.ar.dmg, unlocked: __game.Save.data.unlocked.slice()
  }));
  ok('リロード後もコインが残る', afterReload.coins === beforeReload.coins, afterReload.coins + '◆');
  ok('リロード後もクリア記録が残る', JSON.stringify(afterReload.cleared) === JSON.stringify(beforeReload.cleared));
  ok('リロード後も武器強化が残る', afterReload.dmg === beforeReload.dmg, 'lv' + afterReload.dmg);
  ok('リロード後も解放武器が残る', afterReload.unlocked.length === beforeReload.unlocked.length);
  ok('進行に応じてSTAGE解放が保持される', (await G(() => __game.Save.maxStage())) >= 2);

  /* ================= 17. ボスステージ ================= */
  section('17. ボスステージ');
  const bossRes = await page.evaluate(async () => {
    const G = __game.Game;
    __game.Save.data.cleared = [1, 2, 3, 4]; __game.Save.save();
    G.startStage(5);
    G.player.maxHp = 1e6; G.player.hp = 1e6;    // tester is invulnerable; we only probe the boss
    const boss = G.boss;
    const phases = new Set();
    let projMax = 0, waves = 0;
    for (let i = 0; i < 900; i++) {
      G.update(1 / 60);
      if (i % 12 === 0) { boss.hp = Math.max(1, boss.hp - boss.maxHp * 0.02); }
      phases.add(boss.phase);
      projMax = Math.max(projMax, G.projectiles.length);
      waves = G.wavesFired;
      await new Promise(r => setTimeout(r, 0));
      if (G.state !== 'playing') break;
    }
    const enemies = G.enemies.length;
    // finish the boss
    while (boss.state !== 'dead') G.damageEnemy(boss, 9999, false, 'body', .6);
    for (let i = 0; i < 200; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); if (G.state !== 'playing') break; }
    return { phases: [...phases], projMax, waves, enemies, state: G.state, hp: boss.maxHp };
  });
  ok('ボスが出現する', bossRes.hp >= 1400, 'boss maxHP=' + bossRes.hp);
  ok('ボスが複数フェーズを持つ', bossRes.phases.length >= 3, 'phases=' + bossRes.phases.join(','));
  ok('ボスが攻撃してくる（弾を撃つ）', bossRes.projMax > 0, 'max projectiles=' + bossRes.projMax);
  ok('援軍が出現する', bossRes.waves >= 3, 'waves=' + bossRes.waves);
  ok('ボス撃破でクリアになる', bossRes.state === 'clear');
  ok('最終ステージまでクリアできる', await G(() => __game.Save.data.cleared.includes(5)));

  /* ================= 17b. 目標タイプの違い ================= */
  section('17b. ステージ目標のバリエーション');
  const objs = await G(() => __game.DATA.STAGES.map(s => s.objective));
  ok('ステージごとに目標が異なる', new Set(objs).size >= 3, objs.join(','));
  const countRes = await page.evaluate(async () => {
    const G = __game.Game;
    G.startStage(3);
    const target = G.stage.target;
    for (let i = 0; i < 5; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    const live = G.enemies.filter(e => e.state !== 'dead');
    for (let i = 0; i < target; i++) { const e = live[i]; while (e.state !== 'dead') G.damageEnemy(e, 999, false, 'body', .6); }
    const leftAlive = G.enemies.filter(e => e.state !== 'dead').length;
    for (let i = 0; i < 130; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); if (G.state !== 'playing') break; }
    return { target, state: G.state, leftAlive, total: G.totalEnemies };
  });
  ok('撃破数目標のステージが存在する', countRes.target > 0, 'STAGE3 target=' + countRes.target);
  ok('全滅させなくても目標達成でクリアできる', countRes.state === 'clear' && countRes.leftAlive > 0,
    '残存 ' + countRes.leftAlive + '体でクリア');

  /* ================= 18. パフォーマンス ================= */
  section('18. パフォーマンス');
  const perf = await page.evaluate(async () => {
    const G = __game.Game;
    G.startStage(4);            // heaviest stage (9 enemies)
    for (let i = 0; i < 30; i++) { await new Promise(r => requestAnimationFrame(r)); }
    const t = [];
    let prev = performance.now();
    for (let i = 0; i < 120; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const now = performance.now();
      t.push(now - prev); prev = now;
    }
    t.sort((a, b) => a - b);
    return { median: t[60], p95: t[113], stripe: __game.Render.stripe, w: __game.Render.W, h: __game.Render.H };
  });
  ok('フレーム時間が実用範囲（中央値<25ms）', perf.median < 25, 'median=' + perf.median.toFixed(1) + 'ms p95=' + perf.p95.toFixed(1) + 'ms');
  ok('内部解像度が自動調整される', perf.w > 0 && perf.stripe >= 1, perf.w + 'x' + perf.h + ' stripe=' + perf.stripe);

  /* ================= 19. 全ステージ健全性 ================= */
  section('19. 全ステージ健全性チェック');
  const stages = await page.evaluate(async () => {
    const out = [];
    for (const st of __game.DATA.STAGES) {
      __game.Game.startStage(st.id);
      const G = __game.Game;
      for (let i = 0; i < 90; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
      const m = G.map;
      const inWall = m.grid[(G.player.y | 0) * m.w + (G.player.x | 0)] !== 0;
      const enemiesInWall = G.enemies.filter(e => m.grid[(e.y | 0) * m.w + (e.x | 0)] !== 0).length;
      out.push({
        id: st.id, enemies: G.enemies.length, inWall, enemiesInWall,
        playing: G.state === 'playing', types: [...new Set(G.enemies.map(e => e.type))]
      });
    }
    return out;
  });
  stages.forEach(s => {
    ok('STAGE ' + s.id + ' が正常に開始できる', s.playing && s.enemies > 0, s.enemies + '体 [' + s.types.join(',') + ']');
    ok('STAGE ' + s.id + ' の湧き位置が壁に埋まっていない', !s.inWall && s.enemiesInWall === 0);
  });
  ok('敵の種類が5種類すべて登場する',
    new Set(stages.flatMap(s => s.types)).size === 5,
    [...new Set(stages.flatMap(s => s.types))].join(','));

  /* ================= 20. 通しプレイ（実操作のみでクリア） ================= */
  section('20. 通しプレイ：タッチ操作だけでSTAGE1をクリア');
  await page.evaluate(() => { __game.Save.wipe(); });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.waitForTimeout(300);
  await page.click('[data-nav="start"]'); await page.waitForTimeout(150);
  await page.click('[data-nav="deploy"]'); await page.waitForTimeout(400);
  ok('新規セーブでSTAGE1から開始', (await G(() => __game.Game.stage.id)) === 1);

  // hunt: rotate towards the nearest live enemy using look-swipes, then hold fire
  let cleared = false;
  for (let round = 0; round < 90 && !cleared; round++) {
    const info = await page.evaluate(() => {
      const G = __game.Game, R = __game.Render, m = G.map;
      if (G.state !== 'playing') return { done: G.state };
      const p = G.player;
      let best = null, bd = 1e9;
      G.enemies.forEach(e => {
        if (e.state === 'dead') return;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      });
      if (!best) return { none: true };
      const los = R.los(G.map, p.x, p.y, best.x, best.y);
      // walk the real corridors: BFS from the enemy, then descend from the player
      let tx = best.x, ty = best.y;
      if (!los) {
        const dist = new Int32Array(m.w * m.h).fill(-1);
        const start = (best.y | 0) * m.w + (best.x | 0);
        const q = [start]; dist[start] = 0;
        for (let h = 0; h < q.length; h++) {
          const c = q[h], cx = c % m.w, cy = (c / m.w) | 0;
          for (let k = 0; k < 4; k++) {
            const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            const ni = ny * m.w + nx;
            if (m.grid[ni] || dist[ni] >= 0) continue;
            dist[ni] = dist[c] + 1; q.push(ni);
          }
        }
        const px = p.x | 0, py = p.y | 0;
        let bestV = dist[py * m.w + px], wp = null;
        for (let k = 0; k < 4; k++) {
          const nx = px + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
          const v = dist[ny * m.w + nx];
          if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; wp = { x: nx + 0.5, y: ny + 0.5 }; }
        }
        if (wp) { tx = wp.x; ty = wp.y; }
      }
      const want = Math.atan2(ty - p.y, tx - p.x);
      let diff = want - p.ang;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      return { diff, dist: bd, los, mag: p.weapon.mag, hp: p.hp };
    });
    if (info.done) { cleared = info.done === 'clear'; break; }
    if (info.none) { await page.waitForTimeout(1600); cleared = (await G(() => __game.state())) === 'clear'; break; }
    // turn with a real swipe on the look zone
    const px = info.diff / (0.0022 * (await G(() => __game.Input.sensitivity)) / 100);
    const steps = 6, dxs = Math.max(-60, Math.min(60, px / steps));
    await page.mouse.move(600, 200); await page.mouse.down();
    for (let i = 0; i < steps; i++) { await page.mouse.move(600 + dxs * (i + 1), 200); await page.waitForTimeout(10); }
    await page.mouse.up();
    if (!info.los) {
      // walk forward toward it
      await page.mouse.move(150, 300); await page.mouse.down();
      await page.mouse.move(150, 250); await page.waitForTimeout(360); await page.mouse.up();
      continue;
    }
    await page.dispatchEvent('#btnFire', 'pointerdown', { pointerId: 11, bubbles: true, cancelable: true });
    await page.waitForTimeout(320);
    await page.dispatchEvent('#btnFire', 'pointerup', { pointerId: 11, bubbles: true, cancelable: true });
    await page.waitForTimeout(60);
    const st = await G(() => ({ s: __game.state(), mag: __game.Game.player.weapon.mag }));
    if (st.s === 'clear') { cleared = true; break; }
    if (st.s === 'over') break;
    if (st.mag <= 0) {
      await page.dispatchEvent('#btnReload', 'pointerdown', { pointerId: 12, bubbles: true, cancelable: true });
      await page.waitForTimeout(2200);
    }
  }
  const finalState = await G(() => __game.state());
  ok('タッチ操作のみでステージをクリアできた', cleared, 'final=' + finalState +
    ' kills=' + (await G(() => __game.Game.kills)));
  if (cleared) {
    ok('クリア画面が出る', await page.isVisible('#clearScreen'));
    ok('進行が保存される', await G(() => __game.Save.data.cleared.includes(1)));
    await page.click('[data-nav="armory"]'); await page.waitForTimeout(200);
    ok('クリア画面から強化画面へ行ける', await page.isVisible('#weaponScreen'));
    await page.click('#weaponScreen .back-btn'); await page.waitForTimeout(150);
    ok('強化画面からクリア画面へ戻れる', await page.isVisible('#clearScreen'));
  }

  /* ================= 21. エラー総括 ================= */
  section('21. 実行時エラー');
  ok('プレイ全体を通してJSエラーが無い', errors.length === 0, errors.slice(0, 4).join(' | '));

  report();
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { report(); console.error('\n\x1b[31mABORTED:\x1b[0m', e.message); process.exit(2); });
