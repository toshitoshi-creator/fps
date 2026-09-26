/* screenshot pass — LAST ISLAND の各画面を目視確認するためのキャプチャ
 *   node test/brshots.js <出力先>          … WebGL2（写実寄り3D）
 *   GL=0 node test/brshots.js <出力先>     … 従来のレイキャスト描画
 */
function loadPlaywright() {
  const cands = [process.env.PW, 'playwright', '@playwright/test'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  throw new Error('playwright が見つかりません。');
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
const OUT = process.argv[2] || require('path').join(require('os').tmpdir(), 'last-island-shots');
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8932;
const GLQ = process.env.GL === '0' ? '?gl=0' : '?gl=1';

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch(launchOpts());
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/br/index.html${GLQ}`);
  await page.waitForFunction(() => window.__br);
  await page.waitForTimeout(900);
  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
  const G = (fn, a) => page.evaluate(fn, a);
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
  await press('[data-nav="stats"]'); await page.waitForTimeout(250); await shot('02-records');
  await press('[data-nav="lobby"]');
  await press('[data-nav="settings"]'); await page.waitForTimeout(250); await shot('03-settings');
  await press('[data-nav="lobby"]');

  await press('[data-nav="play"]'); await page.waitForTimeout(900); await shot('04-plane');
  await page.click('#dropMap', { position: { x: 100, y: 110 } });
  await press('#btnDrop'); await page.waitForTimeout(1500); await shot('05-freefall');
  await until(() => __br.BR.player.chute, 15000); await page.waitForTimeout(500); await shot('06-parachute');
  await until(() => __br.BR.player.state === 'ground', 20000);
  await page.waitForTimeout(700); await shot('07-landed');

  // 以降は落ち着いて撮るため、プレイヤーを無敵にして敵を配置する
  const place = async (opt) => G(o => {
    const BR = __br.BR, p = BR.player, m = BR.map;
    __br.godMode(true);
    BR.zone.r = 200; BR.zone.nextR = 200; BR.zone.timer = 999;
    for (let t = 0; t < 2000; t++) {
      const s = m.spawnable[(Math.random() * m.spawnable.length) | 0];
      if (o.near && Math.hypot(s.x - o.near.x, s.y - o.near.y) > o.near.r) continue;
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const tx = s.x + Math.cos(ang) * o.d, ty = s.y + Math.sin(ang) * o.d;
        if (BR.solidAt(tx, ty) || !BR.los(s.x, s.y, tx, ty)) continue;
        let clear = true;
        for (let k = 0; k < 8 && clear; k++) { const bb = k / 8 * 6.283; if (!BR.los(s.x, s.y, s.x + Math.cos(bb) * 2.6, s.y + Math.sin(bb) * 2.6)) clear = false; }
        if (!clear) continue;
        p.x = s.x; p.y = s.y; p.ang = ang; p.pitch = o.pitch || 0;
        const alive = BR.bots.filter(bb => bb.alive);
        alive.forEach((bb, i) => { if (i > 2) { bb.x = 1.5; bb.y = 1.5; } });
        const e = alive[0];
        e.x = tx; e.y = ty; e.state = 'ground'; e.hp = 70; e.ang = ang + Math.PI - 0.4; e.helmet = 3; e.armorMax = 120; e.armor = 120;
        e.weapons[0] = BR.makeWeapon('raptor'); e.wIdx = 0; e.bot.state = 'COMBAT';
        const e2 = alive[1];
        if (e2) { e2.x = s.x + Math.cos(ang + 0.35) * (o.d + 5); e2.y = s.y + Math.sin(ang + 0.35) * (o.d + 5); e2.state = 'ground'; e2.helmet = 1; e2.armorMax = 45; e2.weapons[0] = BR.makeWeapon('breach'); e2.moving = true; }
        const e3 = alive[2];
        if (e3) { e3.x = s.x + Math.cos(ang - 0.3) * (o.d + 9); e3.y = s.y + Math.sin(ang - 0.3) * (o.d + 9); e3.state = 'ground'; e3.helmet = 2; e3.armorMax = 80; e3.weapons[0] = BR.makeWeapon('longview'); e3.stance = 'crouch'; }
        return true;
      }
    }
    return false;
  }, opt);
  await G(() => {
    const p = __br.BR.player;
    __br.giveWeapon('raptor', 0); __br.giveWeapon('breach', 1); p.wIdx = 0;
    p.armorMax = 80; p.armor = 80; p.helmet = 2;
    p.items.bandage = 4; p.items.medkit = 1; p.items.frag = 2;
  });
  await place({ d: 6 });
  await page.waitForTimeout(600); await shot('08-combat-tpp');
  await G(() => { __br.BRSave.data.settings.view = 'FPP'; __br.GL3D.view = 'FPP'; });
  await page.waitForTimeout(300); await shot('09-combat-fpp');
  await page.dispatchEvent('#btnFire', 'pointerdown', { pointerId: 60, bubbles: true, cancelable: true });
  await page.waitForTimeout(140); await shot('10-firing');
  await page.dispatchEvent('#btnFire', 'pointerup', { pointerId: 60, bubbles: true, cancelable: true });
  await page.dispatchEvent('#btnAds', 'pointerdown', { pointerId: 61, bubbles: true, cancelable: true });
  await page.waitForTimeout(600); await shot('11-reddot');
  await page.dispatchEvent('#btnAds', 'pointerup', { pointerId: 61, bubbles: true, cancelable: true });
  await G(() => { __br.giveWeapon('longview', 0); __br.BR.player.wIdx = 0; });
  await page.dispatchEvent('#btnAds', 'pointerdown', { pointerId: 62, bubbles: true, cancelable: true });
  await page.waitForTimeout(700); await shot('12-scope');
  await page.dispatchEvent('#btnAds', 'pointerup', { pointerId: 62, bubbles: true, cancelable: true });
  await G(() => { __br.giveWeapon('raptor', 0); __br.BRSave.data.settings.view = 'TPP'; __br.GL3D.view = 'TPP'; });

  // 屋内（一人称）
  await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map;
    const bd = m.buildings.find(b => b.bw >= 8 && b.bh >= 6) || m.buildings[0];
    p.x = bd.x + 1.5; p.y = bd.y + 1.5; p.ang = Math.atan2(bd.bh, bd.bw); p.pitch = 0;
    __br.GL3D.view = 'FPP';
  });
  await page.waitForTimeout(500); await shot('13-indoor');
  // 市街（三人称・少し見下ろす）
  await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map;
    const c = m.landmarks.find(l => l.key === 'city');
    __br.GL3D.view = 'TPP';
    for (let i = 0; i < 400; i++) {
      const x = c.x + (Math.random() - 0.5) * c.r * 2.4, y = c.y + c.r * 0.9 + Math.random() * 6;
      if (!BR.solidAt(x, y) && BR.los(x, y, c.x, c.y)) { p.x = x; p.y = y; break; }
    }
    p.ang = Math.atan2(c.y - p.y, c.x - p.x); p.pitch = 0.08;
  });
  await page.waitForTimeout(500); await shot('14-city');
  // 森
  await G(() => {
    const BR = __br.BR, p = BR.player, m = BR.map;
    const f = m.landmarks.find(l => l.key === 'forest');
    for (let i = 0; i < 400; i++) {
      const a = Math.random() * 6.28, d = f.r * (0.2 + Math.random() * 0.6);
      const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
      if (!BR.solidAt(x, y)) { p.x = x; p.y = y; break; }
    }
    p.ang = Math.random() * 6.28; p.pitch = 0.05;
  });
  await page.waitForTimeout(500); await shot('15-forest');
  // 安全地帯の外から青い壁を見る
  await G(() => {
    const BR = __br.BR, p = BR.player, z = BR.zone;
    z.cx = p.x + Math.cos(p.ang) * 14; z.cy = p.y + Math.sin(p.ang) * 14; z.r = 9;
  });
  await page.waitForTimeout(500); await shot('16-zone');
  await G(() => { const BR = __br.BR; BR.zone.r = 200; BR.zone.cx = BR.map.center.x; BR.zone.cy = BR.map.center.y; });

  // 足元のアイテム一覧
  await G(() => {
    const BR = __br.BR, p = BR.player;
    const mk = (kind, id, tier, name, dx, dy) => BR.loot.push({ kind, id, tier, name, count: kind === 'ammo' ? 30 : 1, x: p.x + dx, y: p.y + dy, t: 0, alive: true });
    mk('weapon', 'saw', 'epic', 'SAW LMG', 0.4, 0.2); mk('item', 'armor3', 'legendary', 'アーマー Lv3', -0.3, 0.4);
    mk('ammo', 'medium', 'common', 'ミディアム弾', 0.2, -0.4); mk('item', 'medkit', 'rare', 'メドキット', -0.4, -0.2);
    p.pitch = -0.5;
  });
  await page.waitForTimeout(500); await shot('17-loot');
  await press('#btnBag'); await page.waitForTimeout(300); await shot('18-inventory');
  await page.click('#bagClose');
  await press('#btnMap'); await page.waitForTimeout(400); await shot('19-map');
  await page.click('#mapClose');

  await G(() => { const BR = __br.BR; BR.bots.filter(b => b.alive).forEach(b => BR.kill(b, BR.player)); });
  await until(() => !document.getElementById('resultScreen').classList.contains('hidden'), 6000);
  await page.waitForTimeout(400); await shot('20-victory');

  await b.close();
  await new Promise(r => server.close(r));
  console.log('screenshots →', OUT);
})();
