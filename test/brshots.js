/* screenshot pass — BR の各画面を目視確認するためのキャプチャ */
function loadPlaywright() {
  const cands = [process.env.PW, 'playwright', '@playwright/test'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  throw new Error('playwright が見つかりません。');
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
const OUT = process.argv[2] || require('path').join(require('os').tmpdir(), 'island-protocol-shots');
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8932;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch(launchOpts());
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/br/index.html`);
  await page.waitForFunction(() => window.__br);
  await page.waitForTimeout(500);
  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
  const press = async (sel, id) => {
    await page.dispatchEvent(sel, 'pointerdown', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'pointerup', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'click', { bubbles: true, cancelable: true });
  };
  const until = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(80); }
    return false;
  };

  await shot('01-lobby');
  await press('[data-nav="stats"]'); await page.waitForTimeout(200); await shot('02-records');
  await press('[data-nav="lobby"]');
  await press('[data-nav="missions"]'); await page.waitForTimeout(200); await shot('03-missions');
  await press('[data-nav="lobby"]');
  await press('[data-nav="settings"]'); await page.waitForTimeout(200); await shot('04-settings');
  await press('[data-nav="lobby"]');

  await press('[data-nav="play"]'); await page.waitForTimeout(600); await shot('05-plane');
  await press('#btnDrop'); await page.waitForTimeout(1200); await shot('06-freefall');
  await until(() => __br.BR.player.chute, 9000); await page.waitForTimeout(200); await shot('07-parachute');
  await until(() => __br.BR.player.state === 'ground', 12000);
  await page.waitForTimeout(600); await shot('08-landed');

  // 装備を整えた戦闘中の絵
  await page.evaluate(() => {
    const BR = __br.BR, p = BR.player;
    __br.giveWeapon('raptor', 0); __br.giveWeapon('breach', 1);
    p.armorMax = 80; p.armor = 80; p.helmet = 2;
    p.items.bandage = 4; p.items.medkit = 1; p.items.frag = 2;
    // 見通しの良い場所へ移動して敵を正面に置く
    for (let t = 0; t < 800; t++) {
      const s = BR.map.spawnable[(Math.random() * BR.map.spawnable.length) | 0];
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const tx = s.x + Math.cos(ang) * 7, ty = s.y + Math.sin(ang) * 7;
        if (BR.solidAt(tx, ty) || !BR.los(s.x, s.y, tx, ty)) continue;
        p.x = s.x; p.y = s.y; p.ang = ang; p.pitch = 0;
        const e = BR.bots.filter(b => b.alive)[0];
        e.x = tx; e.y = ty; e.state = 'ground'; e.hp = 70;
        e.weapons[0] = BR.makeWeapon('vector');
        const e2 = BR.bots.filter(b => b.alive)[1];
        if (e2) { e2.x = s.x + Math.cos(ang + 0.25) * 11; e2.y = s.y + Math.sin(ang + 0.25) * 11; e2.state = 'ground'; }
        return;
      }
    }
  });
  await page.waitForTimeout(500); await shot('09-combat');
  await page.dispatchEvent('#btnFire', 'pointerdown', { pointerId: 60, bubbles: true, cancelable: true });
  await page.waitForTimeout(120); await shot('10-firing');
  await page.dispatchEvent('#btnFire', 'pointerup', { pointerId: 60, bubbles: true, cancelable: true });

  await page.evaluate(() => { __br.giveWeapon('longview', 0); __br.BR.player.wIdx = 0; });
  await page.dispatchEvent('#btnAds', 'pointerdown', { pointerId: 61, bubbles: true, cancelable: true });
  await page.waitForTimeout(700); await shot('11-scope');
  await page.dispatchEvent('#btnAds', 'pointerup', { pointerId: 61, bubbles: true, cancelable: true });

  await press('#btnBag'); await page.waitForTimeout(250); await shot('12-inventory');
  await page.click('#bagClose');
  await press('#btnMap'); await page.waitForTimeout(300); await shot('13-map');
  await page.click('#mapClose');

  // 決着
  await page.evaluate(() => {
    const BR = __br.BR;
    __br.godMode(true);
    BR.bots.filter(b => b.alive).forEach(b => BR.kill(b, BR.player));
  });
  await until(() => !document.getElementById('resultScreen').classList.contains('hidden'), 6000);
  await page.waitForTimeout(400); await shot('14-victory');

  await b.close();
  await new Promise(r => server.close(r));
  console.log('screenshots →', OUT);
})();
