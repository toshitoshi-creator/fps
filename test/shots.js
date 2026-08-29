/* screenshot pass — visual sanity check of every screen */
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
const OUT = process.argv[2] || require('path').join(require('os').tmpdir(), 'steel-protocol-shots');
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8931;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch(launchOpts());
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(400);
  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });

  await shot('01-title');
  await page.click('[data-nav="stage"]'); await page.waitForTimeout(200); await shot('02-stage');
  await page.click('#stageScreen .back-btn');
  await page.click('[data-nav="weapon"]'); await page.waitForTimeout(250); await shot('03-armory');
  await page.click('#weaponScreen .back-btn');
  await page.click('[data-nav="settings"]'); await page.waitForTimeout(200); await shot('04-settings');
  await page.click('#settingsScreen .back-btn');
  await page.click('[data-nav="start"]'); await page.waitForTimeout(200); await shot('05-brief');
  await page.click('[data-nav="deploy"]'); await page.waitForTimeout(700);

  // face the nearest enemy and hold fire for a combat frame
  await page.evaluate(() => {
    const G = __game.Game, R = __game.Render, p = G.player;
    let best = null, bd = 1e9;
    G.enemies.forEach(e => { const d = Math.hypot(e.x - p.x, e.y - p.y); if (R.los(G.map, p.x, p.y, e.x, e.y) && d < bd) { bd = d; best = e; } });
    if (best) __game.aimAt(best);
  });
  await page.waitForTimeout(200); await shot('06-combat');
  await page.dispatchEvent('#btnFire', 'pointerdown', { pointerId: 5, bubbles: true, cancelable: true });
  await page.waitForTimeout(90); await shot('07-firing');
  await page.dispatchEvent('#btnFire', 'pointerup', { pointerId: 5, bubbles: true, cancelable: true });

  // scoped sniper
  await page.evaluate(async () => {
    const G = __game.Game, S = __game.Save;
    S.unlockWeapon('sr'); S.data.equipped = 'sr'; S.save(); G.startStage(3);
    const i = G.player.weapons.findIndex(w => w.id === 'sr'); G.player.wIdx = i;
    __game.Input.crouch = true;
  });
  await page.waitForTimeout(700); await shot('08-scope');
  await page.evaluate(() => { __game.Input.crouch = false; });

  // boss arena
  await page.evaluate(async () => {
    const G = __game.Game; G.startStage(5);
    const p = G.player, b = G.boss;
    p.x = b.x - 5; p.y = b.y; __game.aimAt(b);
    for (let i = 0; i < 60; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    __game.aimAt(b);
  });
  await page.waitForTimeout(300); await shot('09-boss');

  // clear + gameover
  await page.evaluate(async () => {
    const G = __game.Game; G.startStage(1);
    for (let i = 0; i < 5; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    G.enemies.forEach(e => { while (e.state !== 'dead') G.damageEnemy(e, 999, true, 'head', .8); });
    for (let i = 0; i < 140; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
  });
  await page.waitForTimeout(300); await shot('10-clear');
  await page.evaluate(async () => {
    const G = __game.Game; G.startStage(2);
    for (let i = 0; i < 5; i++) { G.update(1 / 60); await new Promise(r => setTimeout(r, 0)); }
    G.hurtPlayer(9999, 0);
  });
  await page.waitForTimeout(300); await shot('11-gameover');

  // portrait warning
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400); await shot('12-portrait');

  console.log('screenshots ->', OUT);
  await b.close(); server.close();
})();
