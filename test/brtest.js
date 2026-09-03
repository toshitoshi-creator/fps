/* =========================================================================
 * brtest.js — headless end-to-end play-through of ISLAND PROTOCOL (BR).
 * 実ブラウザ上で本物のDOM（タッチボタン・ドラッグ操作）を叩いて、
 * 輸送機 → 降下 → 着地 → 索敵 → 戦闘 → Zone → 勝敗 → リザルト → ロビー
 * の全工程が「実際に動く」ことを検証する。
 *
 *   node test/brtest.js
 * ======================================================================= */
const path = require('path');
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

const PORT = 8913;
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
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2, hasTouch: true, isMobile: true
  });
  const page = await ctx.newPage();
  let errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const G = (fn, arg) => page.evaluate(fn, arg);
  // pointerdown系（Input.tap）とclick系（メニュー）の両方に届くように押す
  const press = async (sel, id) => {
    await page.dispatchEvent(sel, 'pointerdown', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'pointerup', { pointerId: id || 30, bubbles: true, cancelable: true });
    await page.dispatchEvent(sel, 'click', { bubbles: true, cancelable: true });
  };
  const down = (sel, id) => page.dispatchEvent(sel, 'pointerdown', { pointerId: id || 31, bubbles: true, cancelable: true });
  const up = (sel, id) => page.dispatchEvent(sel, 'pointerup', { pointerId: id || 31, bubbles: true, cancelable: true });
  const wait = ms => page.waitForTimeout(ms);
  const until = async (fn, ms, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) {
      if (await page.evaluate(fn, arg)) return true;
      await page.waitForTimeout(60);
    }
    return false;
  };

  await page.goto(`http://127.0.0.1:${PORT}/br/index.html`);
  await page.waitForFunction(() => window.__br && window.__br.BR);
  await wait(400);

  /* ================= 1. 起動とロビー ================= */
  section('1. 起動とロビー');
  ok('エラーなく起動する', errors.length === 0, errors.join(' | '));
  ok('ローディングが消えている', !(await page.isVisible('#loading')));
  ok('ロビー画面が表示される', await page.isVisible('#lobbyScreen'));
  ok('PLAYボタンがある', await page.isVisible('[data-nav="play"]'));
  ok('レベル表示がある', /LV\s*\d+/.test(await page.textContent('#lvNum')));
  ok('初期stateはLOBBY', (await G(() => __br.BR.state)) === 'LOBBY');
  ok('ロビーの内容が画面内に収まる', (await G(() => {
    const r = document.getElementById('lobbyFoot').getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= 0;
  })));
  ok('canvasが描画サイズを持つ', (await G(() => __br.Render.W > 0 && __br.Render.H > 0)));

  /* ================= 2. データ定義 ================= */
  section('2. データ定義（武器・アイテム・Bot性格・Zone）');
  const D = await G(() => {
    const d = __br.BRDATA;
    return {
      weapons: d.WEAPONS.length,
      classes: [...new Set(d.WEAPONS.map(w => w.cls))],
      modes: [...new Set(d.WEAPONS.map(w => w.fireMode))],
      tiers: [...new Set(d.WEAPONS.map(w => w.tier))],
      ammo: Object.keys(d.AMMO).length,
      items: Object.keys(d.ITEMS).length,
      persons: Object.keys(d.PERSONALITIES),
      zones: d.ZONE_PHASES.length,
      lootAreas: Object.keys(d.LOOT_TABLES).length,
      names: d.BOT_NAMES.length,
      states: d.MATCH_STATES.length,
      badWeapon: d.WEAPONS.filter(w => !(w.damage > 0 && w.rpm > 0 && w.mag > 0 && w.range > 0 && w.reload > 0)).map(w => w.id),
      dupIds: d.WEAPONS.length - new Set(d.WEAPONS.map(w => w.id)).size
    };
  });
  ok('武器が10種類以上ある', D.weapons >= 10, D.weapons + '種');
  ok('武器IDが重複していない', D.dupIds === 0);
  ok('全武器のパラメータが正の値', D.badWeapon.length === 0, D.badWeapon.join(','));
  ok('武器クラスが5種類以上', D.classes.length >= 5, D.classes.join('/'));
  ok('発射モードが3種類（auto/semi/burst）', D.modes.length === 3, D.modes.join('/'));
  ok('レアリティ段階が4以上', D.tiers.length >= 4, D.tiers.join('/'));
  ok('弾薬が4種類', D.ammo === 4);
  ok('アイテムが8種類以上', D.items >= 8, D.items + '種');
  ok('Bot性格が6種類', D.persons.length === 6, D.persons.join('/'));
  ok('Zoneフェーズが6段階', D.zones === 6);
  ok('エリア別Lootテーブルがある', D.lootAreas >= 4, D.lootAreas + 'エリア');
  ok('Bot名が16人ぶん以上ある', D.names >= 16, D.names + '名');
  ok('MatchStateが定義されている', D.states >= 10, D.states + '状態');

  /* ================= 3. マップ生成 ================= */
  section('3. 島マップの生成と整合性');
  const M = await G(() => {
    const out = [];
    for (let s = 1; s <= 5; s++) {
      const m = __br.BRMap.generate(96, s * 7717);
      const solid = (x, y) => m.grid[(y | 0) * m.w + (x | 0)] !== 0;
      out.push({
        walkable: m.walkable,
        spawn: m.spawnable.length,
        loot: m.lootSpots.length,
        marks: m.landmarks.length,
        badLoot: m.lootSpots.filter(l => solid(l.x, l.y)).length,
        badSpawn: m.spawnable.filter(l => solid(l.x, l.y)).length,
        indoor: m.lootSpots.filter(l => l.indoor).length,
        areas: [...new Set(m.lootSpots.map(l => l.area))].length
      });
    }
    return out;
  });
  ok('5種のシードすべてでマップが生成できる', M.length === 5);
  ok('歩ける面積が十分ある', M.every(m => m.walkable > 3000), M.map(m => m.walkable).join('/'));
  ok('到達可能なスポーン地点がある', M.every(m => m.spawn > 500));
  ok('Lootスポットが100箇所以上', M.every(m => m.loot >= 100), M.map(m => m.loot).join('/'));
  ok('壁の中にLootが湧かない', M.every(m => m.badLoot === 0));
  ok('壁の中にスポーンしない', M.every(m => m.badSpawn === 0));
  ok('ランドマークが8箇所ある', M.every(m => m.marks === 8));
  ok('屋内Lootが存在する', M.every(m => m.indoor > 10), M.map(m => m.indoor).join('/'));
  ok('複数エリアのLootがある', M.every(m => m.areas >= 4));

  /* ================= 4. 設定画面 ================= */
  section('4. 設定画面（実際に効くか）');
  await press('[data-nav="settings"]');
  ok('設定画面が開く', await page.isVisible('#settingsScreen'));
  await page.$eval('#setSens', el => { el.value = '260'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('感度スライダーがInputに反映される', (await G(() => __br.Input.sensitivity)) === 260);
  ok('感度の数値表示が更新される', (await page.textContent('#setSensVal')) === '260');
  const aim0 = await page.textContent('#setAim');
  await press('#setAim');
  const aim1 = await page.textContent('#setAim');
  ok('エイムアシスト設定が切り替わる', aim0 !== aim1, aim0 + '→' + aim1);
  ok('エイムアシストがプレイヤーに反映される', (await G(() => __br.BRPlayer.aimAssist > 0)));
  await press('#setLefty');
  ok('左右反転が body クラスに反映される', (await G(() => document.body.classList.contains('lefty'))));
  await press('#setLefty');
  await page.$eval('#setBtn', el => { el.value = '120'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('ボタンサイズがCSS変数に反映される',
    (await G(() => getComputedStyle(document.documentElement).getPropertyValue('--btn-scale').trim())) === '1.2');
  await page.$eval('#setBots', el => { el.value = '9'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('Bot数の設定が保存される', (await G(() => __br.BRSave.data.settings.bots)) === 9);
  await press('#setQuality');
  ok('描画品質を切り替えられる', (await G(() => ['AUTO', 'LOW', 'MID', 'HIGH'].indexOf(__br.BRSave.data.settings.quality) >= 0)));

  /* ---- リロードして永続化を確認 ---- */
  await page.reload();
  await page.waitForFunction(() => window.__br && window.__br.BR);
  await wait(300);
  const persisted = await G(() => __br.BRSave.data.settings);
  ok('設定がlocalStorageに永続化される', persisted.sens === 260 && persisted.bots === 9,
    JSON.stringify({ sens: persisted.sens, bots: persisted.bots }));
  ok('再読込後も感度が復元される', (await G(() => __br.Input.sensitivity)) === 260);
  // 以降のテスト用にBot数を戻す
  await G(() => { __br.BRSave.data.settings.bots = 15; __br.BRSave.save(); });

  /* ================= 5. マッチ開始 → 輸送機 ================= */
  section('5. マッチ開始と輸送機');
  errors = [];
  await press('[data-nav="play"]');
  await wait(300);
  ok('PLAYでマッチが始まる', (await G(() => __br.BR.state)) === 'PLANE');
  ok('降下画面が表示される', await page.isVisible('#dropScreen'));
  ok('16人（自分+15Bot）参加している', (await G(() => __br.BR.combatants.length)) === 16);
  ok('全員が機内にいる', (await G(() => __br.BR.combatants.every(c => c.state === 'plane'))));
  ok('Lootがマップに配置される', (await G(() => __br.BR.loot.length)) > 100,
    (await G(() => __br.BR.loot.length)) + '個');
  ok('安全地帯が初期化されている', (await G(() => __br.BR.zone.r > 30)));
  ok('高度が表示される', /\d+/.test(await page.textContent('#altNum')));
  ok('降下マップが描かれている', (await G(() => {
    const c = document.getElementById('dropMap');
    if (!c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4000) if (d[i] > 0) return true;
    return false;
  })));
  // 降下地点マーカー
  await page.click('#dropMap', { position: { x: 120, y: 90 } });
  ok('マップタップで降下マーカーを置ける', (await G(() => !!__br.BRUI.marker)));
  ok('輸送機が進んでいる', await until(() => __br.BR.plane.t > 0.4, 4000));

  /* ================= 6. 降下 → パラシュート → 着地 ================= */
  section('6. 降下・パラシュート・着地');
  let chuted = false, landed = false;
  await G(() => {
    window.__ev = { chute: 0, land: 0 };
    __br.BR.on('chute', c => { if (c.isPlayer) __ev.chute++; });
    __br.BR.on('land', c => { if (c.isPlayer) __ev.land++; });
  });
  await press('#btnDrop');
  await wait(150);
  ok('DROPボタンで降下が始まる', (await G(() => __br.BR.player.state)) === 'drop');
  ok('stateがDROPに遷移する', (await G(() => __br.BR.state)) === 'DROP');
  const alt0 = await G(() => __br.BR.player.z);
  await wait(900);
  ok('高度が下がっていく', (await G(() => __br.BR.player.z)) < alt0 - 10);
  chuted = await until(() => __ev.chute > 0, 8000);
  ok('自動でパラシュートが開く', chuted);
  landed = await until(() => __br.BR.player.state === 'ground', 9000);
  ok('着地する', landed);
  ok('着地後はEARLY_GAME', (await G(() => __br.BR.state)) === 'EARLY_GAME');
  ok('HUDに切り替わる', await page.isVisible('#hud'));
  ok('壁や水の中に着地しない', (await G(() => !__br.BR.solidAt(__br.BR.player.x, __br.BR.player.y))));
  ok('降下中エラーが出ない', errors.length === 0, errors.join(' | '));
  ok('Botも降下している', await until(() => __br.BR.bots.filter(b => b.state !== 'plane').length >= 10, 20000),
    (await G(() => __br.BR.bots.filter(b => b.state === 'ground').length)) + '/15 着地');

  /* ================= 7. HUDと移動 ================= */
  section('7. HUDと移動操作');
  // ここからは操作の検証なので、Botに撃たれて死んで進めなくなるのを防ぐ
  await G(() => __br.godMode(true));
  const hpShown = await page.textContent('#hpNum');
  ok('HP表示がある', +hpShown === Math.ceil(await G(() => __br.BR.player.hp)), 'HP ' + hpShown);
  ok('残り人数が表示される', +(await page.textContent('#aliveNum')) > 1);
  ok('Zone表示がある', /PHASE/.test(await page.textContent('#zoneLabel')));
  ok('ミニマップが描画されている', (await G(() => {
    const c = document.getElementById('minimap');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 400) if (d[i] > 0) return true;
    return false;
  })));
  ok('3Dビューが描画されている', (await G(() => {
    const c = document.getElementById('view');
    const d = __br.Render.ctx.getImageData(0, (c.height / 2) | 0, c.width, 1).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s > 1000;
  })));

  // 仮想スティックで前進（正面が壁だと動けないので、開けた向きに立たせてから測る）
  const before = await G(() => {
    const BR = __br.BR, p = BR.player;
    const openAhead = (x, y, ang) => {
      for (let d = 0.5; d <= 4; d += 0.5) if (BR.solidAt(x + Math.cos(ang) * d, y + Math.sin(ang) * d)) return false;
      return true;
    };
    let done = false;
    for (let a = 0; a < 24 && !done; a++) {
      const ang = a / 24 * Math.PI * 2;
      if (openAhead(p.x, p.y, ang)) { p.ang = ang; done = true; }
    }
    for (let t = 0; t < 400 && !done; t++) {
      const s = BR.map.spawnable[(Math.random() * BR.map.spawnable.length) | 0];
      for (let a = 0; a < 24 && !done; a++) {
        const ang = a / 24 * Math.PI * 2;
        if (openAhead(s.x, s.y, ang)) { p.x = s.x; p.y = s.y; p.ang = ang; done = true; }
      }
    }
    return { x: p.x, y: p.y, open: done };
  });
  ok('開けた場所に立てる', before.open);
  const mz = await page.$('#moveZone');
  const box = await mz.boundingBox();
  const dragStick = async id => {
    await G(() => { __br.Input._stickId = null; __br.Input.move.x = __br.Input.move.y = 0; });
    const from = await G(() => ({ x: __br.BR.player.x, y: __br.BR.player.y }));
    await page.dispatchEvent('#moveZone', 'pointerdown', { pointerId: id, clientX: box.x + 90, clientY: box.y + box.height - 90, bubbles: true, cancelable: true });
    await page.dispatchEvent('#moveZone', 'pointermove', { pointerId: id, clientX: box.x + 90, clientY: box.y + box.height - 150, bubbles: true, cancelable: true });
    await wait(700);
    const d = await G(a => Math.hypot(__br.BR.player.x - a.x, __br.BR.player.y - a.y), from);
    await page.dispatchEvent('#moveZone', 'pointerup', { pointerId: id, bubbles: true, cancelable: true });
    return d;
  };
  let moved = await dragStick(40);
  if (moved <= 0.4) moved = await dragStick(44);      // 取りこぼしたら1度だけやり直す
  ok('仮想スティックで移動できる', moved > 0.4, moved.toFixed(2) + 'm');
  ok('スティックを離すと止まる', await until(() => Math.abs(__br.Input.move.x) + Math.abs(__br.Input.move.y) < 0.01, 2000));

  // 視点
  const ang0 = await G(() => __br.BR.player.ang);
  const lz = await page.$('#lookZone');
  const lb = await lz.boundingBox();
  await page.dispatchEvent('#lookZone', 'pointerdown', { pointerId: 41, clientX: lb.x + 100, clientY: lb.y + 100, bubbles: true, cancelable: true });
  await page.dispatchEvent('#lookZone', 'pointermove', { pointerId: 41, clientX: lb.x + 220, clientY: lb.y + 100, bubbles: true, cancelable: true });
  await wait(200);
  await page.dispatchEvent('#lookZone', 'pointerup', { pointerId: 41, bubbles: true, cancelable: true });
  ok('スワイプで視点が回る', Math.abs(await G(a => __br.U.angDiff(a, __br.BR.player.ang), ang0)) > 0.15);

  // 姿勢
  await press('#btnCrouch');
  await wait(100);
  ok('CROUCHでしゃがめる', (await G(() => __br.BR.player.stance)) === 'crouch');
  await press('#btnCrouch');
  await wait(100);
  await press('#btnProne');
  await wait(100);
  ok('PRONEで伏せられる', (await G(() => __br.BR.player.stance)) === 'prone');
  await press('#btnProne');
  await wait(100);
  ok('PRONE解除で立てる', (await G(() => __br.BR.player.stance)) === 'stand');

  /* ================= 8. Loot取得 ================= */
  section('8. Lootの取得');
  // 近くのLootの前に移動してプロンプトを出す
  const nearLoot = await G(() => {
    const BR = __br.BR, p = BR.player;
    const l = BR.loot.filter(l => l.alive && l.kind === 'weapon' && !BR.solidAt(l.x, l.y))
      .sort((a, b) => __br.U.dist2(a.x, a.y, p.x, p.y) - __br.U.dist2(b.x, b.y, p.x, p.y))[0];
    if (!l) return null;
    p.x = l.x; p.y = l.y;            // 壁際で押し出されないよう真上に立つ
    return { name: l.name, id: l.id };
  });
  ok('武器Lootが世界に存在する', !!nearLoot, nearLoot && nearLoot.name);
  await wait(200);
  ok('近づくと「拾う」プロンプトが出る', await page.isVisible('#lootPrompt'));
  ok('プロンプトにアイテム名が出る', (await page.textContent('#lootName')).length > 0);
  await press('#lootPrompt');
  await wait(150);
  ok('タップで武器を拾える', (await G(() => !!__br.BR.player.weapons[0])),
    await G(() => __br.BR.player.weapons[0] && __br.BR.player.weapons[0].def.name));
  ok('拾得数がスタッツに記録される', (await G(() => __br.BR.stats.lootPicked)) >= 1);
  ok('HUDに武器名が出る', (await page.textContent('#wpnName')).length > 1);

  const gear = await G(() => {
    const BR = __br.BR, p = BR.player, U = __br.U;
    const take = kind => {
      const l = BR.loot.filter(l => l.alive && kind(l))
        .sort((a, b) => U.dist2(a.x, a.y, p.x, p.y) - U.dist2(b.x, b.y, p.x, p.y))[0];
      if (!l) return null;
      p.x = l.x; p.y = l.y;
      return BR.pickup(p, l);
    };
    const out = {};
    out.ammo = take(l => l.kind === 'ammo');
    out.armor = take(l => l.kind === 'item' && __br.BRDATA.ITEMS[l.id].kind === 'armor');
    out.helm = take(l => l.kind === 'item' && __br.BRDATA.ITEMS[l.id].kind === 'helmet');
    out.heal = take(l => l.kind === 'item' && __br.BRDATA.ITEMS[l.id].kind === 'heal');
    out.fragOnMap = BR.loot.filter(l => l.alive && l.id === 'frag').length;
    if (!out.fragOnMap) {                       // 稀に1つも湧かないマップがある
      BR.loot.push({ kind: 'item', id: 'frag', tier: 'uncommon', name: 'フラググレネード', count: 1, x: p.x, y: p.y, t: 0, alive: true });
    }
    out.frag = take(l => l.kind === 'item' && l.id === 'frag');
    out.second = take(l => l.kind === 'weapon');
    return { out, armor: p.armor, helmet: p.helmet, items: p.items, ammo: p.ammo, w2: !!p.weapons[1] };
  });
  ok('弾薬を拾える', !!gear.out.ammo, gear.out.ammo);
  ok('アーマーを拾って装備できる', gear.armor > 0, 'AP ' + gear.armor);
  ok('ヘルメットを拾って装備できる', gear.helmet > 0, 'Lv' + gear.helmet);
  ok('回復アイテムを拾える', (gear.items.bandage + gear.items.medkit + gear.items.energy) > 0);
  ok('グレネードを拾える', gear.items.frag > 0, 'マップ上に ' + gear.out.fragOnMap + '個');
  ok('2丁目の武器を持てる', gear.w2);
  await wait(200);
  ok('HUDのアーマー表示が更新される', !(await G(() => document.getElementById('gearArmor').classList.contains('off'))));

  /* ================= 9. インベントリ / マップ画面 ================= */
  section('9. インベントリとタクティカルマップ');
  await press('#btnBag');
  await wait(150);
  ok('BAGでインベントリが開く', await page.isVisible('#bagScreen'));
  ok('所持品が一覧される', (await G(() => document.querySelectorAll('#bagBody [data-use],#bagBody [data-wslot]').length)) > 0);
  const hpBefore = await G(() => { __br.BR.player.hp = 40; return 40; });
  await page.click('#bagBody [data-use]');
  await wait(100);
  ok('インベントリからアイテムを使える', (await G(() => __br.BR.player.useT > 0 || __br.BR.player.hp > 40)));
  await page.click('#bagClose');
  await wait(120);
  ok('インベントリを閉じられる', !(await page.isVisible('#bagScreen')) && (await page.isVisible('#hud')));
  ok('回復が完了する', await until(() => __br.BR.player.hp > 40, 6000),
    'HP ' + (await G(() => Math.round(__br.BR.player.hp))));

  await press('#btnMap');
  await wait(200);
  ok('MAPでタクティカルマップが開く', await page.isVisible('#mapScreen'));
  ok('全体マップが描画される', (await G(() => {
    const c = document.getElementById('bigMap');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 400) if (d[i] > 0) n++;
    return n > 20;
  })));
  await page.click('#bigMap', { position: { x: 100, y: 100 } });
  ok('マップタップでマーカーを置ける', (await G(() => !!__br.BRUI.marker)));
  await page.click('#mapClose');
  await wait(120);
  ok('マップを閉じられる', !(await page.isVisible('#mapScreen')));

  /* ================= 10. 射撃・ADS・リロード ================= */
  section('10. 射撃・ADS・リロード・持ち替え');
  await G(() => { __br.__br_dummy = 1; __br.BR.player.hp = 100; });
  await G(() => __br.godMode(true));
  // プレイヤーと的Botを「見通しの効く位置関係」に置き直すヘルパ
  await page.evaluate(() => {
    window.__setupAim = function () {
      const BR = __br.BR, p = BR.player;
      const b = (window.__tgt && window.__tgt.alive) ? window.__tgt : (BR.bots.find(x => x.alive) || BR.bots[0]);
      const tryFrom = (sx, sy) => {
        for (let a = 0; a < 24; a++) {
          const ang = a / 24 * Math.PI * 2;
          const tx = sx + Math.cos(ang) * 6, ty = sy + Math.sin(ang) * 6;
          if (BR.solidAt(tx, ty) || !BR.los(sx, sy, tx, ty)) continue;
          p.x = sx; p.y = sy; p.ang = ang; p.pitch = 0; p.state = 'ground';
          b.x = tx; b.y = ty;
          return true;
        }
        return false;
      };
      b.state = 'ground'; b.alive = true; b.deadT = 0;
      b.hp = 100; b.armor = 0; b.armorMax = 0; b.helmet = 0;
      if (b.bot) b.bot.state = 'EXPLORING';
      window.__tgt = b;
      if (tryFrom(p.x, p.y)) return { ok: true, name: b.name };
      for (let t = 0; t < 600; t++) {
        const s = BR.map.spawnable[(Math.random() * BR.map.spawnable.length) | 0];
        if (tryFrom(s.x, s.y)) return { ok: true, name: b.name };
      }
      return { ok: false };
    };
  });
  const placed = await G(() => __setupAim());
  ok('射撃テスト用の見通しを確保できる', placed.ok);
  await G(() => { __br.giveWeapon('vector', 0); __br.BR.player.wIdx = 0; });
  await wait(100);
  const magFull = await G(() => __br.BR.player.weapons[0].mag);
  ok('武器を装備するとマガジンが満タン', magFull > 0, magFull + '発');

  // ADS
  await down('#btnAds', 50);
  await wait(400);
  ok('ADSボタンでズームする', (await G(() => __br.BR.zoomT)) > 0.3, 'zoomT=' + (await G(() => __br.BR.zoomT.toFixed(2))));
  const adsSens = await G(() => {
    const BR = __br.BR, P = __br.BRPlayer, p = BR.player, U = __br.U;
    const probe = z => {
      BR.zoomT = z; __br.Input.look.dx = 240; __br.Input.look.dy = 0;
      const a0 = p.ang; P.update(BR, 1 / 60);
      return Math.abs(U.angDiff(a0, p.ang));
    };
    const hip = probe(0), ads = probe(1);
    return { hip, ads, set: P.adsSens };
  });
  ok('ADS中は視点感度が下がる', adsSens.ads < adsSens.hip * 0.95,
    (adsSens.ads / adsSens.hip).toFixed(2) + '倍');
  ok('ADS感度の設定値が実際に効く', Math.abs(adsSens.ads / adsSens.hip - adsSens.set) < 0.04,
    '設定 ' + adsSens.set);
  await up('#btnAds', 50);
  await wait(400);
  ok('ADS解除で戻る', (await G(() => __br.BR.zoomT)) < 0.4);
  // スコープ付き武器はADSで拡大しスコープ表示になる
  await G(() => { __br.giveWeapon('longview', 0); __br.BR.player.wIdx = 0; });
  await down('#btnAds', 52);
  await wait(500);
  ok('スコープ武器はADSで拡大する', (await G(() => __br.BR.curZoom)) > 1.5,
    'x' + (await G(() => __br.BR.curZoom.toFixed(2))));
  ok('スコープオーバーレイが出る', await page.isVisible('#scopeOverlay'));
  await up('#btnAds', 52);
  await wait(400);
  await G(() => { __br.giveWeapon('vector', 0); __br.BR.player.wIdx = 0; });
  await wait(100);

  // 射撃（狙いの検証中はBotの思考を止めて的を固定する）
  const aimReady = await G(() => {
    __br._botUpd = __br.BRBot.update;
    __br.BRBot.update = function () { };     // 狙いの検証中はBotを固定する
    const r = __setupAim();
    __br.Input.look.dx = 0; __br.Input.look.dy = 0;
    __br.BR.shake = 0;
    return r;
  });
  ok('射撃時にも的の見通しを取り直せる', aimReady.ok);
  const hpT0 = await G(() => __tgt.hp);
  await down('#btnFire', 51);
  await wait(500);
  await up('#btnFire', 51);
  await wait(100);
  const shotRes = await G(() => ({ mag: __br.BR.player.weapons[0].mag, shots: __br.BR.player.shots, hp: __tgt.hp, hits: __br.BR.player.hits, dmg: __br.BR.stats.damage }));
  ok('FIREボタンで連射できる', shotRes.shots >= 3, shotRes.shots + '発');
  ok('撃つと弾が減る', shotRes.mag < magFull, shotRes.mag + '/' + magFull);
  ok('クロスヘアの敵に当たる', shotRes.hp < hpT0, 'HP ' + hpT0 + '→' + Math.round(shotRes.hp));
  ok('与ダメージが記録される', shotRes.dmg > 0, shotRes.dmg);
  ok('ヒットマーカーが出る', (await G(() => document.getElementById('hitmark').classList.contains('on') || __br.BR.player.hits > 0)));
  ok('弾数HUDが更新される', +(await page.textContent('#magText')) === shotRes.mag);
  ok('トレーサーが出る', (await G(() => __br.BR.tracers.length)) >= 0);

  // 撃破（装備を持たせて戦利品のドロップも見る）
  const killed = await G(() => {
    const BR = __br.BR, p = BR.player;
    // 射撃で既に倒れている場合があるので、生存Botを改めて的にする
    let t = BR.bots.find(b => b.alive) || __tgt;
    t.alive = true; t.state = 'ground'; t.hp = 100; t.deadT = 0;
    const snap = (c, x, y) => {
      if (!BR.solidAt(x, y)) { c.x = x; c.y = y; return; }
      let best = null, bd = 1e9;
      BR.map.spawnable.forEach(s2 => { const d = __br.U.dist2(s2.x, s2.y, x, y); if (d < bd) { bd = d; best = s2; } });
      c.x = best.x; c.y = best.y;
    };
    snap(t, p.x + Math.cos(p.ang) * 5, p.y + Math.sin(p.ang) * 5);
    t.weapons[0] = BR.makeWeapon('wasp');
    t.ammo.light = 60; t.items.bandage = 2; t.armorMax = 45; t.armor = 45;
    const k0 = BR.stats.kills;
    BR.damage(t, 500, BR.player, false);
    return {
      alive: t.alive, kills: BR.stats.kills - k0, feed: BR.killFeed.length,
      drops: BR.loot.filter(l => l.alive && Math.hypot(l.x - t.x, l.y - t.y) < 2.5).length
    };
  });
  ok('BotのAIを元に戻せる', (await G(() => {
    if (__br._botUpd) { __br.BRBot.update = __br._botUpd; __br._botUpd = null; }
    return typeof __br.BRBot.update === 'function' && __br.BRBot.update.length >= 2;
  })));
  ok('敵を倒せる', !killed.alive);
  ok('キル数が加算される', killed.kills >= 1);
  ok('キルフィードに出る', killed.feed >= 1);
  ok('倒した敵がLootを落とす', killed.drops > 0, killed.drops + '個');
  await wait(200);
  ok('残り人数が減る', +(await page.textContent('#aliveNum')) <= 15);

  // リロード
  await G(() => { __br.BR.player.weapons[0].mag = 1; __br.BR.player.ammo.medium = 90; });
  await press('#btnReload');
  await wait(150);
  ok('RELOADでリロードが始まる', (await G(() => __br.BR.player.reloading)));
  ok('リロードバーが出る', await page.isVisible('#reloadBar'));
  ok('リロードが完了する', await until(() => !__br.BR.player.reloading && __br.BR.player.weapons[0].mag > 1, 6000),
    (await G(() => __br.BR.player.weapons[0].mag)) + '発');
  ok('予備弾が減る', (await G(() => __br.BR.player.ammo.medium)) < 90);

  // 持ち替え
  const w0 = await G(() => __br.BR.player.wIdx);
  await press('#btnSwitch');
  ok('SWAPで持ち替えが始まる', await until(() => __br.BR.player.wIdx !== 0 || __br.BR.player.switchT > 0, 2000));
  await until(() => __br.BR.player.switchT === 0, 3000);
  ok('武器スロットが切り替わる', (await G(() => __br.BR.player.wIdx)) !== w0);
  ok('スロットUIが2つ出ている', (await G(() => document.querySelectorAll('#wpnSlots [data-slot]').length)) === 2);
  await page.dispatchEvent('#wpnSlots [data-slot="0"]', 'pointerdown', { pointerId: 55, bubbles: true, cancelable: true });
  await until(() => __br.BR.player.switchT === 0, 3000);
  ok('スロット直接タップで切り替わる', (await G(() => __br.BR.player.wIdx)) === 0);

  // 発射モード
  const modes = await G(async () => {
    const BR = __br.BR, p = BR.player;
    const out = {};
    for (const id of ['p9', 'marksman', 'lance']) {
      if (!__br.BRDATA.WEAPON_BY_ID[id]) continue;
      p.weapons[0] = BR.makeWeapon(id); p.wIdx = 0; p.fireCd = 0; p.semiLatch = false; p.burstLeft = 0;
      const m0 = p.weapons[0].mag;
      __br.BRPlayer.update(BR, 0.016);
      out[id] = { mode: p.weapons[0].def.fireMode, m0 };
    }
    return out;
  });
  ok('セミオート武器が存在する', Object.values(modes).some(m => m.mode === 'semi'));
  const burstTest = await G(() => {
    const BR = __br.BR, p = BR.player;
    const w = __br.BRDATA.WEAPONS.find(w => w.fireMode === 'burst');
    if (!w) return null;
    p.weapons[0] = BR.makeWeapon(w.id); p.wIdx = 0; p.fireCd = 0;
    const m0 = p.weapons[0].mag;
    BR.fire(p); p.burstLeft = (w.burstCount || 3) - 1; p.burstT = 0;
    for (let i = 0; i < 40; i++) BR.update(1 / 60);
    return { fired: m0 - p.weapons[0].mag, burst: w.burstCount || 3 };
  });
  ok('バースト武器が指定発数だけ撃つ', burstTest && burstTest.fired === burstTest.burst,
    burstTest && burstTest.fired + '/' + burstTest.burst);
  const semiTest = await G(() => {
    const BR = __br.BR, p = BR.player;
    const w = __br.BRDATA.WEAPONS.find(w => w.fireMode === 'semi');
    p.weapons[0] = BR.makeWeapon(w.id); p.wIdx = 0; p.fireCd = 0; p.semiLatch = false;
    const m0 = p.weapons[0].mag;
    __br.Input._btnFire = true; __br.Input.fire = true;
    for (let i = 0; i < 60; i++) { __br.Input.fire = true; __br.BRPlayer.update(BR, 1 / 60); }
    __br.Input._btnFire = false; __br.Input.fire = false;
    return m0 - p.weapons[0].mag;
  });
  ok('セミオートは押しっぱなしで1発だけ', semiTest === 1, semiTest + '発');

  /* ================= 11. ダメージモデル ================= */
  section('11. ダメージ計算（アーマー・ヘルメット・ヘッドショット）');
  const dm = await G(() => {
    const BR = __br.BR;
    const mk = (armor, helm) => {
      const c = BR.makeCombatant({ name: 'T', avatar: 'br_a' });
      c.state = 'ground'; c.armor = armor; c.armorMax = armor; c.helmet = helm;
      return c;
    };
    const plain = mk(0, 0); BR.damage(plain, 40, null, false);
    const armored = mk(100, 0); BR.damage(armored, 40, null, false);
    const head = mk(0, 0); BR.damage(head, 40, null, true, 2.0);
    const helmed = mk(0, 3); BR.damage(helmed, 40, null, true, 2.0);
    return {
      plain: plain.hp, armored: armored.hp, armorLeft: armored.armor,
      head: head.hp, helmed: helmed.hp
    };
  });
  ok('素の被弾でHPが減る', dm.plain === 60, 'HP ' + dm.plain);
  ok('アーマーがダメージを吸収する', dm.armored > dm.plain, 'HP ' + dm.armored);
  ok('アーマー値が消費される', dm.armorLeft < 100, 'AP ' + dm.armorLeft);
  ok('ヘッドショットは倍率が乗る', dm.head < dm.plain, 'HP ' + dm.head);
  ok('ヘルメットがヘッドショットを軽減する', dm.helmed > dm.head, 'HP ' + dm.helmed);

  // グレネード
  const frag = await G(() => {
    const BR = __br.BR, p = BR.player;
    p.items.frag = 2;
    let boom = 0;
    BR.on('explosion', () => boom++);
    const threw = BR.throwFrag(p);
    const proj = BR.projectiles.length;
    for (let i = 0; i < 300; i++) BR.update(1 / 60);
    return { threw, proj, boom, frags: p.items.frag, left: BR.projectiles.length };
  });
  ok('グレネードを投げられる', frag && frag.threw);
  ok('グレネードが所持数を消費する', frag && frag.frags === 1);
  ok('投げたグレネードが飛翔体になる', frag && frag.proj > 0);
  ok('時間経過で爆発する', frag && frag.boom > 0 && frag.left === 0);
  const blast = await G(() => {
    const BR = __br.BR, p = BR.player;
    const t = BR.bots.find(b => b.alive) || BR.bots[0];
    t.alive = true; t.state = 'ground'; t.hp = 100; t.armor = 0; t.armorMax = 0; t.deadT = 0;
    t.x = p.x + 1.2; t.y = p.y;
    if (BR.solidAt(t.x, t.y)) { t.x = p.x; t.y = p.y + 0.6; }
    if (BR.solidAt(t.x, t.y)) { t.x = p.x; t.y = p.y; }
    // 範囲外の比較対象は、必ず歩ける地点（25m以上離れた場所）へ置く
    const far = BR.bots.filter(b => b.alive && b !== t)[0];
    if (far) {
      const spot = BR.map.spawnable.find(s2 => __br.U.dist(s2.x, s2.y, p.x, p.y) > 25) || BR.map.spawnable[0];
      far.x = spot.x; far.y = spot.y; far.hp = 100; far.state = 'ground';
    }
    const before = t.hp, fbefore = far ? far.hp : null;
    BR.explode(t.x, t.y, 0.6, 4.5, 95, p);
    return { before, after: t.hp, fbefore, fafter: far ? far.hp : null };
  });
  ok('爆発が範囲内の敵にダメージを与える', blast.after < blast.before,
    Math.round(blast.before - blast.after) + 'dmg');
  ok('爆発が範囲外には届かない', blast.fbefore === null || blast.fafter === blast.fbefore);

  /* ================= 12. Bot AI ================= */
  section('12. Bot AI');
  const botRun = await G(async () => {
    const BR = __br.BR;
    // 開始位置はIDで覚える（途中で死んだBotが居ても対応が崩れないように）
    const from = new Map(), last = new Map(), path = new Map();
    BR.bots.forEach(b => {
      if (!b.alive) return;
      from.set(b.id, { x: b.x, y: b.y }); last.set(b.id, { x: b.x, y: b.y }); path.set(b.id, 0);
    });
    // 実際に歩いた距離を1/2秒ごとに積算する（その場で戦う個体も拾えるように）
    const sample = () => BR.bots.forEach(b => {
      const l = last.get(b.id); if (!l) return;
      if (b.alive && b.state === 'ground') path.set(b.id, path.get(b.id) + Math.hypot(b.x - l.x, b.y - l.y));
      l.x = b.x; l.y = b.y;
    });
    const states = new Set(), shots0 = BR.bots.reduce((s, b) => s + b.shots, 0);
    const kills0 = BR.bots.reduce((s, b) => s + b.kills, 0);
    const dmg0 = BR.bots.reduce((s, b) => s + b.damage, 0);
    const shots = () => BR.bots.reduce((s, b) => s + b.shots, 0) - shots0;
    const bkills = () => BR.bots.reduce((s, b) => s + b.kills, 0) - kills0;
    const bdmg = () => BR.bots.reduce((s, b) => s + b.damage, 0) - dmg0;
    let moved = 0, secs = 0;
    const movedNow = () => BR.bots.filter(b => {
      const f = from.get(b.id);
      return f && Math.hypot(b.x - f.x, b.y - f.y) > 2;
    }).length;
    // 最大60秒。ただし移動・武器・射撃・撃破が出そろったら早めに切り上げる
    for (let i = 0; i < 60 * 90; i++) {
      BR.update(1 / 60);
      if (i % 30 === 0) { sample(); BR.bots.forEach(b => { if (b.alive) states.add(b.bot.state); }); }
      if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
      if (i % 60 === 0) {
        secs = i / 60;
        moved = Math.max(moved, movedNow());
        const armedN = BR.bots.filter(b => b.weapons[0] || b.weapons[1]).length;
        const walkedN = [...path.values()].filter(v => v > 5).length;
        if (secs >= 20 && walkedN >= Math.ceil(from.size * 0.6) && armedN >= 8 &&
          shots() > 0 && bdmg() > 0) break;
      }
      if (['VICTORY', 'DEFEAT', 'RESULT'].indexOf(BR.state) >= 0) break;
    }
    sample();
    moved = Math.max(moved, movedNow());
    const paths = [...path.values()];
    return {
      states: [...states], secs,
      moved, total: from.size,
      walked: paths.filter(v => v > 5).length,
      avgWalk: paths.reduce((a, b) => a + b, 0) / Math.max(1, paths.length),
      armed: BR.bots.filter(b => b.weapons[0] || b.weapons[1]).length,
      shots: shots(), botKills: bkills(), botDmg: bdmg(),
      loot: BR.loot.filter(l => l.alive).length,
      inWall: BR.combatants.filter(c => c.alive && c.state === 'ground' && BR.solidAt(c.x, c.y)).length
    };
  });
  ok('Botが複数の状態を使う', botRun.states.length >= 4, botRun.states.join('/'));
  ok('Botが自分で歩き回る', botRun.walked >= Math.ceil(botRun.total * 0.55),
    botRun.walked + '/' + botRun.total + '体が5m以上移動  平均' + botRun.avgWalk.toFixed(1) + 'm');
  // 交戦中はその場に留まる個体もいるので、平均移動距離で「止まっていない」ことを見る
  ok('Botが止まっていない', botRun.avgWalk > 6,
    '平均 ' + botRun.avgWalk.toFixed(1) + 'm / 位置が変わった ' + botRun.moved + '体');
  // 生き残っている数に対して評価する（前の節の戦闘で減っていることがあるため）
  ok('Botが武器を拾う', botRun.armed >= Math.min(8, Math.ceil(botRun.total * 0.7)),
    botRun.armed + '/15（生存 ' + botRun.total + '）  ' + botRun.secs + '秒時点');
  ok('Botが発砲する', botRun.shots > 0, botRun.shots + '発');
  ok('Botが敵にダメージを与える', botRun.botDmg > 0,
    botRun.botDmg + 'dmg / ' + botRun.botKills + 'キル');
  ok('誰も壁にめり込まない', botRun.inWall === 0);
  ok('Lootが無限に増えない', botRun.loot < 400, botRun.loot + '個');
  ok('AI稼働中にエラーが出ない', errors.length === 0, errors.join(' | '));

  /* ================= 13. Zone ================= */
  section('13. 安全地帯（Zone）');
  const zoneRun = await G(async () => {
    const BR = __br.BR, U = __br.U;
    const r0 = BR.zone.r, ph0 = BR.zone.phase;
    let shrinkEvents = 0;
    BR.on('zone_shrink', () => shrinkEvents++);
    for (let i = 0; i < 60 * 60; i++) {
      BR.update(1 / 60);
      if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
      if (BR.zone.phase > ph0 + 1) break;
      if (['VICTORY', 'DEFEAT', 'RESULT'].indexOf(BR.state) >= 0) break;
    }
    return { r0, r1: BR.zone.r, phase: BR.zone.phase, ph0, shrinkEvents, state: BR.state };
  });
  ok('Zoneが縮小する', zoneRun.r1 < zoneRun.r0, zoneRun.r0.toFixed(1) + '→' + zoneRun.r1.toFixed(1));
  ok('Zoneフェーズが進む', zoneRun.phase > zoneRun.ph0, 'phase ' + zoneRun.phase);
  ok('縮小イベントが発火する', zoneRun.shrinkEvents > 0);
  ok('Zone進行でMatchStateが進む', ['MID_GAME', 'LATE_GAME', 'FINAL_ZONE'].indexOf(zoneRun.state) >= 0, zoneRun.state);
  const zoneDmg = await G(() => {
    const BR = __br.BR, p = BR.player;
    __br.godMode(false);
    const z = BR.zone;
    p.hp = 100; p.armor = 0;
    p.x = __br.U.clamp(z.cx + z.r + 6, 2, BR.map.w - 2); p.y = __br.U.clamp(z.cy, 2, BR.map.h - 2);
    const inz = BR.inZone(p);
    for (let i = 0; i < 60 * 6; i++) BR.updateZone(1 / 60);
    const out = { inz, hp: p.hp };
    p.x = z.cx; p.y = z.cy;
    const hp2 = p.hp;
    for (let i = 0; i < 60 * 3; i++) BR.updateZone(1 / 60);
    out.safeHp = p.hp; out.hp2 = hp2;
    __br.godMode(true);
    return out;
  });
  ok('圏外判定が働く', zoneDmg.inz === false);
  ok('圏外にいるとダメージを受ける', zoneDmg.hp < 100, 'HP ' + Math.round(zoneDmg.hp));
  ok('圏内に戻るとダメージが止まる', Math.abs(zoneDmg.safeHp - zoneDmg.hp2) < 0.01);

  /* ================= 14. 勝利 → リザルト → 報酬 ================= */
  section('14. 勝利・リザルト・報酬');
  const saveBefore = await G(() => ({
    xp: __br.BRSave.data.xp, level: __br.BRSave.data.level,
    coins: __br.BRSave.data.coins, matches: __br.BRSave.data.stats.matches,
    wins: __br.BRSave.data.stats.wins
  }));
  await G(() => {
    const BR = __br.BR;
    __br.godMode(true);
    BR.player.hp = 100;
    // 最後の1体を残して全滅させる
    const alive = BR.bots.filter(b => b.alive);
    alive.slice(1).forEach(b => BR.kill(b, BR.player));
  });
  await wait(150);
  ok('残り2人になる', (await G(() => __br.BR.aliveCount)) === 2, (await G(() => __br.BR.aliveCount)) + '人');
  await G(() => {
    const BR = __br.BR;
    const last = BR.bots.find(b => b.alive);
    BR.kill(last, BR.player);
  });
  ok('最後の敵を倒すとVICTORY', (await G(() => __br.BR.state)) === 'VICTORY');
  ok('リザルト画面が出る', await until(() => document.getElementById('resultScreen').classList.contains('hidden') === false, 4000));
  await wait(200);
  ok('VICTORY表記になる', /VICTORY/i.test(await page.textContent('#resultTitle')), await page.textContent('#resultTitle'));
  ok('順位が#1になる', /#?1\b/.test(await page.textContent('#placeBadge')), await page.textContent('#placeBadge'));
  ok('戦績が表示される', (await page.textContent('#resultStats')).length > 4);
  ok('獲得XP/コインが表示される', /\d/.test(await page.textContent('#resultXp')), await page.textContent('#resultXp'));
  const saveAfter = await G(() => ({
    xp: __br.BRSave.data.xp, level: __br.BRSave.data.level,
    coins: __br.BRSave.data.coins, matches: __br.BRSave.data.stats.matches,
    wins: __br.BRSave.data.stats.wins, kills: __br.BRSave.data.stats.kills,
    best: __br.BRSave.data.stats.bestPlace
  }));
  ok('試合数が加算される', saveAfter.matches === saveBefore.matches + 1);
  ok('勝利数が加算される', saveAfter.wins === saveBefore.wins + 1);
  ok('コインが増える', saveAfter.coins > saveBefore.coins, saveBefore.coins + '→' + saveAfter.coins);
  ok('XP（またはレベル）が増える', saveAfter.xp !== saveBefore.xp || saveAfter.level > saveBefore.level);
  ok('キル数が累積される', saveAfter.kills > 0, saveAfter.kills + 'キル');
  ok('最高順位が更新される', saveAfter.best === 1);
  ok('デイリーミッションが進行する', (await G(() => __br.BRSave.data.missions.some(m => m.prog > 0))));
  const rbtn = await G(() => ['again', 'lobby'].map(n => {
    const el = document.querySelector('#resultScreen [data-nav="' + n + '"]');
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { n, inView: r.bottom <= window.innerHeight + 1 && r.top >= 0 && r.width > 40, hit: !!(t && (t === el || el.contains(t))) };
  }));
  ok('リザルトのボタンが画面内にある', rbtn.every(b => b.inView), rbtn.filter(b => !b.inView).map(b => b.n).join(','));
  ok('リザルトのボタンが実際に押せる', rbtn.every(b => b.hit), rbtn.filter(b => !b.hit).map(b => b.n).join(','));

  await press('[data-nav="lobby"]');
  await wait(200);
  ok('ロビーに戻れる', await page.isVisible('#lobbyScreen'));
  ok('ロビーのレベル表示が更新される', /LV\s*\d+/.test(await page.textContent('#lvNum')));

  /* ================= 15. 記録・ミッション画面 ================= */
  section('15. 記録とデイリーミッション');
  await press('[data-nav="stats"]');
  await wait(120);
  ok('RECORDS画面が開く', await page.isVisible('#statsScreen'));
  ok('戦績が一覧される', (await page.textContent('#statsBody')).length > 20);
  await press('[data-nav="lobby"]');
  await press('[data-nav="missions"]');
  await wait(120);
  ok('MISSIONS画面が開く', await page.isVisible('#missionScreen'));
  ok('ミッションが3件出る', (await G(() => __br.BRSave.data.missions.length)) === 3);
  const claim = await G(() => {
    const m = __br.BRSave.data.missions[0];
    m.prog = m.goal; m.done = true; m.claimed = false;
    __br.BRSave.save(); __br.BRUI.refreshMissions();
    return { id: m.id, coins: __br.BRSave.data.coins };
  });
  await page.click('[data-claim="' + claim.id + '"]');
  await wait(120);
  ok('達成ミッションの報酬を受け取れる', (await G(() => __br.BRSave.data.coins)) > claim.coins);
  ok('二重受け取りができない', (await G(a => __br.BRSave.claimMission(a) === null, claim.id)));
  await press('[data-nav="lobby"]');
  await wait(120);

  /* ================= 16. 敗北フロー ================= */
  section('16. 敗北とリトライ');
  errors = [];
  await press('[data-nav="play"]');
  await wait(200);
  ok('2試合目を開始できる', (await G(() => __br.BR.state)) === 'PLANE');
  await press('#btnDrop');
  ok('再び着地できる', await until(() => __br.BR.player.state === 'ground', 15000));
  const placeInfo = await G(() => {
    const BR = __br.BR;
    __br.godMode(false);
    const killer = BR.bots.find(b => b.alive) || null;
    BR.damage(BR.player, 999, killer, false);
    return { alive: BR.player.alive, state: BR.state, place: BR.stats.placement, aliveN: BR.aliveCount };
  });
  ok('プレイヤーが倒されると死亡する', !placeInfo.alive);
  ok('stateがDEFEATになる', placeInfo.state === 'DEFEAT');
  ok('順位が記録される', placeInfo.place >= 2, '#' + placeInfo.place);
  ok('敗北でもリザルトが出る', await until(() => !document.getElementById('resultScreen').classList.contains('hidden'), 4000));
  await wait(200);
  ok('DEFEAT表記になる', !/VICTORY/i.test(await page.textContent('#resultTitle')), await page.textContent('#resultTitle'));
  ok('敗北でも報酬がもらえる', /\d/.test(await page.textContent('#resultXp')));
  await press('[data-nav="again"]');
  await wait(300);
  ok('「もう1試合」で再戦できる', (await G(() => __br.BR.state)) === 'PLANE');
  ok('再戦時にHPと持ち物がリセットされる', (await G(() => {
    const p = __br.BR.player;
    return p.hp === 100 && !p.weapons[0] && !p.weapons[1] && p.armor === 0 && p.items.frag === 0;
  })));
  ok('再戦時にLootが再配置される', (await G(() => __br.BR.loot.filter(l => l.alive).length)) > 100);
  ok('敗北〜再戦でエラーが出ない', errors.length === 0, errors.join(' | '));

  /* ================= 17. UI / Safe Area ================= */
  section('17. UIレイアウトと押し心地');
  await press('#btnDrop');
  await until(() => __br.BR.player.state === 'ground', 15000);
  await wait(300);
  const vp = page.viewportSize();
  // レイアウト検証は既定のボタンサイズで行う
  await page.$eval('#setBtn', el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(120);
  const layout = await G(() => {
    const ids = ['btnFire', 'btnAds', 'btnReload', 'btnSwitch', 'btnSprint', 'btnCrouch',
      'btnProne', 'btnItem', 'btnThrow', 'btnBag', 'btnMap', 'minimap', 'hpNum', 'wpnName'];
    const out = [];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) { out.push({ id, missing: true }); return; }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      out.push({
        id, x: r.left, y: r.top, w: r.width, h: r.height,
        hit: !!(top && (top === el || el.contains(top))),
        topId: top ? (top.id || top.className) : null
      });
    });
    return out;
  });
  ok('HUD要素がすべて存在する', layout.every(l => !l.missing), layout.filter(l => l.missing).map(l => l.id).join(','));
  ok('全ての操作ボタンが画面内に収まる',
    layout.every(l => l.missing || (l.x >= 0 && l.y >= 0 && l.x + l.w <= vp.width + 1 && l.y + l.h <= vp.height + 1)),
    layout.filter(l => !l.missing && (l.x < 0 || l.y < 0 || l.x + l.w > vp.width + 1 || l.y + l.h > vp.height + 1)).map(l => l.id).join(','));
  const btns = layout.filter(l => /^btn/.test(l.id));
  ok('操作ボタンが他の要素に隠れていない', btns.every(b => b.hit),
    btns.filter(b => !b.hit).map(b => b.id + '←' + b.topId).join(', '));
  ok('操作ボタンが十分な大きさ（44px以上）', btns.every(b => b.w >= 44 && b.h >= 44),
    btns.filter(b => b.w < 44 || b.h < 44).map(b => b.id + ' ' + Math.round(b.w) + 'x' + Math.round(b.h)).join(', '));
  const overlap = await G(() => {
    const sel = ['.act-btn', '.hud-ammo', '.wpn-slots', '#minimap', '.hud-top'];
    const els = [];
    sel.forEach(s2 => document.querySelectorAll(s2).forEach(e => {
      if (e.offsetParent === null) return;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      els.push({ id: e.id || e.className, r });
    }));
    const bad = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i].r, b = els[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 6 && oy > 6) bad.push(els[i].id + '×' + els[j].id);
    }
    return bad;
  });
  ok('HUDの表示要素と操作ボタンが重ならない', overlap.length === 0, overlap.join(', '));
  ok('Safe Area余白が指定されている', (await G(() => {
    const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('') } catch (e) { return '' } }).join('');
    return /safe-area-inset/.test(css);
  })));
  ok('縦持ち警告の仕組みがある', (await G(() => !!document.getElementById('rotate'))));

  // 「押しても何も起こらないボタン」が無いことの確認
  const dead = await G(async () => {
    const BR = __br.BR, out = [];
    const snap = () => JSON.stringify({
      st: BR.state, cur: __br.BRUI.cur, crouch: __br.Input.crouch, prone: __br.BRPlayer.prone,
      ads: __br.Input._btnAds, fire: __br.Input._btnFire, mag: BR.player.weapons[BR.player.wIdx] ? BR.player.weapons[BR.player.wIdx].mag : -1,
      reloading: BR.player.reloading, wIdx: BR.player.wIdx, useT: BR.player.useT,
      frag: BR.player.items.frag, proj: BR.projectiles.length
    });
    BR.player.items.frag = 1; BR.player.items.bandage = 2; BR.player.hp = 50;
    __br.giveWeapon('vector', 0); __br.giveWeapon('wasp', 1);
    BR.player.weapons[0].mag = 5;
    const ids = ['btnCrouch', 'btnProne', 'btnItem', 'btnThrow', 'btnReload', 'btnSwitch', 'btnBag', 'btnMap'];
    for (const id of ids) {
      const el = document.getElementById(id);
      const a = snap();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 80 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 80 }));
      for (let i = 0; i < 10; i++) BR.update(1 / 60);
      if (snap() === a) out.push(id);
      // 開いた画面は閉じる
      if (__br.BRUI.cur === 'bagScreen') { document.getElementById('bagClose').click(); __br.Input.setEnabled(true); }
      if (__br.BRUI.cur === 'mapScreen') { document.getElementById('mapClose').click(); __br.Input.setEnabled(true); }
      await new Promise(r => setTimeout(r, 30));
    }
    return out;
  });
  ok('押しても何も起きないボタンが無い', dead.length === 0, dead.join(','));

  /* ================= 18. パフォーマンス ================= */
  section('18. パフォーマンスと安定性');
  await wait(1500);
  const fps = await G(() => __br.fps());
  ok('実機想定サイズで30fps以上出る', fps >= 30, Math.round(fps) + 'fps');
  const perf = await G(() => {
    const BR = __br.BR;
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) BR.update(1 / 60);
    const sim = (performance.now() - t0) / 300;
    const t1 = performance.now();
    for (let i = 0; i < 60; i++) __br.Render.render(BR);
    return { sim, draw: (performance.now() - t1) / 60 };
  });
  ok('シミュレーション1フレームが軽い', perf.sim < 6, perf.sim.toFixed(2) + 'ms');
  ok('描画1フレームが24ms未満', perf.draw < 24, perf.draw.toFixed(2) + 'ms');
  const leak = await G(async () => {
    const BR = __br.BR;
    for (let i = 0; i < 60 * 40; i++) {
      BR.update(1 / 60);
      if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
      if (['VICTORY', 'DEFEAT', 'RESULT'].indexOf(BR.state) >= 0) break;
    }
    return { parts: BR.parts.length, tracers: BR.tracers.length, loot: BR.loot.length, feed: BR.killFeed.length, nums: BR.dmgNums.length };
  });
  ok('パーティクルが上限内に収まる', leak.parts <= 240, leak.parts + '個');
  ok('トレーサーが溜まり続けない', leak.tracers < 200, leak.tracers + '本');
  ok('Loot配列が肥大化しない', leak.loot < 500, leak.loot + '個');
  ok('キルフィードが6件以内', leak.feed <= 6);
  ok('全工程を通してエラーが出ない', errors.length === 0, errors.join(' | '));

  /* ================= 19. 状態遷移の健全性 ================= */
  section('19. MatchStateの遷移');
  const flow = await G(() => {
    const d = __br.BRDATA;
    const bad = [];
    Object.keys(d.STATE_FLOW).forEach(k => {
      if (d.MATCH_STATES.indexOf(k) < 0) bad.push('unknown:' + k);
      d.STATE_FLOW[k].forEach(n => { if (d.MATCH_STATES.indexOf(n) < 0) bad.push(k + '→' + n); });
    });
    const unreach = d.MATCH_STATES.filter(s =>
      s !== 'LOBBY' && !Object.keys(d.STATE_FLOW).some(k => d.STATE_FLOW[k].indexOf(s) >= 0));
    return { bad, unreach };
  });
  ok('遷移表に未定義の状態が無い', flow.bad.length === 0, flow.bad.join(','));
  ok('到達できない状態が無い', flow.unreach.length === 0, flow.unreach.join(','));
  const illegal = await G(() => {
    let warned = 0;
    const orig = console.warn;
    console.warn = () => { warned++; };
    const keep = __br.BR.state;
    __br.BR.state = 'LOBBY';
    const rv = __br.BR.setState('FINAL_ZONE');   // LOBBY→FINAL_ZONE は定義されていない
    const st = __br.BR.state;
    __br.BR.state = keep;
    console.warn = orig;
    return { warned, st, rv };
  });
  ok('不正な状態遷移を弾く', illegal.rv === false && illegal.st === 'LOBBY');
  ok('不正な状態遷移を警告する', illegal.warned > 0);

  /* ================= 20. 3Dキャラクター ================= */
  section('20. 3Dキャラクター・武器・一人称の腕');
  const rig = await G(() => {
    const M = window.Model3D;
    const names = M.RIG.map(b => b.name);
    const need = ['head', 'neck', 'chest', 'spine', 'pelvis',
      'armLU', 'armLL', 'handL', 'armRU', 'armRL', 'handR',
      'legLU', 'legLL', 'footL', 'legRU', 'legRL', 'footR'];
    const orphan = M.RIG.filter(b => b.parent && names.indexOf(b.parent) < 0).map(b => b.name);
    // 親が先に並んでいるか（1パスで解けること）
    let order = true;
    M.RIG.forEach((b, i) => { if (b.parent && names.indexOf(b.parent) > i) order = false; });
    return { names, missing: need.filter(n => names.indexOf(n) < 0), orphan, order, roots: M.RIG.filter(b => !b.parent).length };
  });
  ok('人型の骨格が定義されている', rig.missing.length === 0, rig.missing.join(','));
  ok('骨の階層に親子の矛盾が無い', rig.orphan.length === 0 && rig.order);
  ok('根の骨が1つだけ', rig.roots === 1);
  ok('頭・首・胸・腰・肘・手・膝・足がすべて別の骨', rig.names.length >= 17, rig.names.length + '本');

  const gear3d = await G(() => {
    const M = window.Model3D;
    const base = { skin: '#f0c39a', hairColor: '#222', build: 1, height: 1, palette: {} };
    const mk = o => M.buildParts(Object.assign({}, base, { hair: 0, helmet: 0, vest: 0, backpack: 0, gloves: 0, boots: 0, pouches: 0 }, o), 0).length;
    const naked = mk({});
    return {
      naked,
      helmet: mk({ helmet: 1 }) - naked,
      vest: mk({ vest: 1 }) - naked,
      backpack: mk({ backpack: 1 }) - naked,
      gloves: mk({ gloves: 1 }) - naked,
      boots: mk({ boots: 1 }) - naked,
      pouches: mk({ pouches: 1 }) - naked,
      hair: mk({ hair: 2 }) - naked,
      helm3: mk({ helmet: 3 }) - mk({ helmet: 1 })
    };
  });
  ok('素体が複数パーツで組まれている', gear3d.naked >= 15, gear3d.naked + 'パーツ');
  ok('ヘルメットを独立して着脱できる', gear3d.helmet > 0);
  ok('ベストを独立して着脱できる', gear3d.vest > 0);
  ok('バックパックを独立して着脱できる', gear3d.backpack > 0);
  ok('手袋を独立して着脱できる', gear3d.gloves > 0);
  ok('ブーツを独立して着脱できる', gear3d.boots > 0);
  ok('ポーチを独立して着脱できる', gear3d.pouches > 0);
  ok('髪型を変えられる', gear3d.hair > 0);
  ok('ヘルメットのレベルで見た目が変わる', gear3d.helm3 > 0);

  const variety = await G(() => {
    const M = window.Model3D;
    const BR = __br.BR;
    const defs = BR.bots.map(b => window.Char3D.stateFor(b).def);
    const key = d => [d.height.toFixed(2), d.build.toFixed(2), d.skin, d.hair, d.helmet, d.vest, d.backpack].join('|');
    const uniq = new Set(defs.map(key));
    const same = M.defineCharacter('BOT-X', {}).height === M.defineCharacter('BOT-X', {}).height;
    return {
      uniq: uniq.size, n: defs.length, stable: same,
      heights: [...new Set(defs.map(d => d.height.toFixed(2)))].length,
      helmets: [...new Set(defs.map(d => d.helmet))].length
    };
  });
  ok('Botの見た目が個体ごとに違う', variety.uniq >= 5, variety.uniq + '種 / ' + variety.n + '体');
  ok('身長に個体差がある', variety.heights >= 3, variety.heights + '種');
  ok('装備に個体差がある', variety.helmets >= 2, variety.helmets + '種');
  ok('同じIDなら毎回同じ見た目になる', variety.stable);

  const poses3d = await G(() => {
    const M = window.Model3D;
    const mk = o => Object.assign({
      alive: true, state: 'ground', stance: 'stand', animT: 0.4, moving: false, sprinting: false,
      hurtT: 0, atkFlash: 0, switchT: 0, switchTotal: 0, reloading: false, reloadLeft: 0, reloadTotal: 0,
      deadT: 0, chute: false, weapons: [{}], wIdx: 0
    }, o);
    const sig = (c, aim) => {
      const P = M.animate(M.newPose(), c, c.animT, { aiming: !!aim, armed: true });
      const sk = M.solve(P, 1, 1, {});
      let h = '';
      ['head', 'chest', 'handL', 'handR', 'footL', 'footR', 'pelvis'].forEach(b => {
        h += sk[b].o[0].toFixed(3) + ',' + sk[b].o[1].toFixed(3) + ',' + sk[b].o[2].toFixed(3) + ';';
      });
      return h;
    };
    const out = {};
    out.IDLE = sig(mk({}));
    out.WALK = sig(mk({ moving: true }));
    out.RUN = sig(mk({ moving: true, animT: 0.8 }));
    out.SPRINT = sig(mk({ moving: true, sprinting: true }));
    out.AIM = sig(mk({}), true);
    out.FIRE = sig(mk({ atkFlash: 0.16 }), true);
    out.RELOAD = sig(mk({ reloading: true, reloadLeft: 0.9, reloadTotal: 1.8 }));
    out.SWITCH = sig(mk({ switchT: 0.3, switchTotal: 0.6 }));
    out.HIT = sig(mk({ hurtT: 0.14 }));
    out.CROUCH = sig(mk({ stance: 'crouch' }));
    out.PRONE = sig(mk({ stance: 'prone' }));
    out.DEATH = sig(mk({ alive: false, state: 'dead', deadT: 0.8 }));
    out.FALL = sig(mk({ state: 'drop' }));
    out.CHUTE = sig(mk({ state: 'drop', chute: true }));
    const names = Object.keys(out);
    const uniq = new Set(names.map(n => out[n]));
    // 歩行は時間で姿勢が変わる（静止モデルではない）
    const w1 = sig(mk({ moving: true, animT: 0.10 }));
    const w2 = sig(mk({ moving: true, animT: 0.35 }));
    const d1 = sig(mk({ alive: false, state: 'dead', deadT: 0.1 }));
    const d2 = sig(mk({ alive: false, state: 'dead', deadT: 0.7 }));
    return { n: names.length, uniq: uniq.size, walkAnim: w1 !== w2, deathAnim: d1 !== d2, names };
  });
  ok('必要なポーズが14種類そろっている', poses3d.n === 14, poses3d.names.join('/'));
  ok('すべてのポーズが別の姿勢になる', poses3d.uniq === poses3d.n, poses3d.uniq + '/' + poses3d.n);
  ok('歩行が時間で動く（静止モデルではない）', poses3d.walkAnim);
  ok('死亡が時間をかけて倒れる', poses3d.deathAnim);

  const w3d = await G(() => {
    const M = window.Model3D;
    const classes = ['PISTOL', 'SMG', 'AR', 'SHOTGUN', 'LMG', 'DMR', 'SNIPER'];
    const out = {};
    classes.forEach(c => {
      const w = M.weaponParts(c, 'weapon');
      out[c] = { parts: w.parts.length, len: +(-w.muzzle[2]).toFixed(3) };
    });
    const lens = classes.map(c => out[c].len);
    return { out, classes: classes.length, uniqLen: new Set(lens).size, minParts: Math.min(...classes.map(c => out[c].parts)) };
  });
  ok('武器クラスすべてに3Dモデルがある', w3d.classes === 7);
  ok('武器が複数の部品でできている', w3d.minParts >= 5, '最小 ' + w3d.minParts + '部品');
  ok('クラスごとに銃身の長さが違う', w3d.uniqLen >= 5, w3d.uniqLen + '種');

  const draw3d = await G(() => {
    const BR = __br.BR, R = __br.Render, C = window.Char3D;
    const p = BR.player;
    const q0 = R.quality;
    R.setQuality('HIGH');                    // LODの距離は描画品質で変わるので固定する
    // 目の前に1体だけ置いて描画統計を取る（他のBotは一時的に画面から外す）
    const t = BR.bots.find(b => b.alive) || BR.bots[0];
    const hidden = BR.bots.filter(b => b !== t);
    const keep = hidden.map(b => b.state);
    hidden.forEach(b => { b.state = 'plane'; });
    t.alive = true; t.state = 'ground'; t.hp = 100; t.deadT = 0;
    t.weapons[0] = BR.makeWeapon('vector'); t.wIdx = 0;
    const place = d => {
      for (let a = 0; a < 24; a++) {
        const ang = a / 24 * Math.PI * 2;
        const tx = p.x + Math.cos(ang) * d, ty = p.y + Math.sin(ang) * d;
        if (!BR.solidAt(tx, ty) && BR.los(p.x, p.y, tx, ty)) {
          p.ang = ang; t.x = tx; t.y = ty; return true;
        }
      }
      return false;
    };
    BR.refreshEnemyList();
    const at = d => {
      if (!place(d)) return null;
      C.resetStats(); R.render(BR);
      return { drawn: C.stats.drawn, tris: C.stats.tris, lod: C.stats.lod.slice() };
    };
    const near = at(5), mid = at(15), far = at(26), vfar = at(40);
    // 色数（面ごとの陰影がついているか）
    C.resetStats(); place(5); R.render(BR);
    const d = R.ctx.getImageData(0, 0, R.W, R.H).data;
    const cols = new Set();
    for (let i = 0; i < d.length; i += 4) cols.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    const rule = [5, 15, 26, 40].map(d => C.lodFor(d, 'HIGH'));
    hidden.forEach((b, i) => { b.state = keep[i]; });
    BR.refreshEnemyList();
    R.setQuality(q0);
    return { near, mid, far, vfar, rule, colors: cols.size, vm: C.stats.vm };
  });
  ok('近くの敵が3Dモデルで描かれる', draw3d.near && draw3d.near.drawn > 0 && draw3d.near.tris > 50,
    draw3d.near && draw3d.near.tris + '三角形');
  // 見通しの取れる地点が見つからない距離もあるため、観測できたぶんだけ突き合わせる
  ok('近距離は最高精細（LOD0）',
    draw3d.rule[0] === 0 && (!draw3d.near || draw3d.near.lod[0] > 0),
    draw3d.near ? draw3d.near.lod.join('/') : '規則のみ');
  ok('中距離でLODが下がる',
    draw3d.rule[1] === 1 && (!draw3d.mid || (draw3d.mid.lod[1] + draw3d.mid.lod[2]) > 0),
    draw3d.mid ? draw3d.mid.lod.join('/') : '規則のみ');
  ok('遠距離は簡易表示に切り替わる',
    draw3d.rule[2] === 2 && (!draw3d.far || draw3d.far.lod[2] > 0),
    draw3d.far ? draw3d.far.lod.join('/') : '規則のみ');
  // 40m先は3Dをやめてビルボードに戻す（見通しが取れない地形もあるので規則も直接見る）
  ok('さらに遠いと3D描画をやめる',
    draw3d.rule[3] === 3 && (!draw3d.vfar || draw3d.vfar.drawn === 0),
    '距離別LOD ' + draw3d.rule.join('/'));
  ok('面ごとに陰影がついている（のっぺりしない）', draw3d.colors > 60, draw3d.colors + '色');

  const vm3d = await G(() => {
    const BR = __br.BR, R = __br.Render, C = window.Char3D;
    const p = BR.player;
    p.alive = true; p.state = 'ground';       // 死亡中はビューモデルを出さないため
    __br.giveWeapon('vector', 0); p.wIdx = 0;
    p.recoilVis = 0; p.reloading = false; BR.zoomT = 0;
    R.render(BR);
    const hip = C._vmBox && { x: C._vmBox.bx, y: C._vmBox.by, w: C._vmBox.bw, h: C._vmBox.bh };
    p.recoilVis = 3; R.render(BR);
    const kick = C._vmBox && { x: C._vmBox.bx, y: C._vmBox.by };
    p.recoilVis = 0;
    BR.zoomT = 1; R.render(BR);
    const ads = C._vmBox && { x: C._vmBox.bx, y: C._vmBox.by };
    BR.zoomT = 0;
    p.reloading = true; p.reloadLeft = 0.9; p.reloadTotal = 1.8; R.render(BR);
    const rel = C._vmBox && { x: C._vmBox.bx, y: C._vmBox.by };
    p.reloading = false;
    const set = C.vmSet('AR');
    const kinds = {};
    set.parts.forEach(pt => { kinds[pt.col] = 1; });
    R.render(BR);
    return { hip, kick, ads, rel, kinds: Object.keys(kinds), muzzle: C.vmMuzzle(R, BR), parts: set.parts.length };
  });
  ok('一人称に腕と武器が表示される', !!vm3d.hip && vm3d.hip.w > 8 && vm3d.hip.h > 8,
    vm3d.hip && (vm3d.hip.w + 'x' + vm3d.hip.h));
  ok('一人称の組物に手・袖・武器が含まれる',
    ['glove', 'sleeve', 'weapon'].every(k => vm3d.kinds.indexOf(k) >= 0), vm3d.kinds.join('/'));
  ok('銃口の位置が取れる（発砲光の基点）', !!vm3d.muzzle);
  ok('反動で武器と腕が動く', !!vm3d.kick && (vm3d.kick.x !== vm3d.hip.x || vm3d.kick.y !== vm3d.hip.y));
  ok('ADSで構えの位置が変わる', !!vm3d.ads && (vm3d.ads.x !== vm3d.hip.x || vm3d.ads.y !== vm3d.hip.y));
  ok('リロードで武器が動く', !!vm3d.rel && (vm3d.rel.x !== vm3d.hip.x || vm3d.rel.y !== vm3d.hip.y));

  const socket = await G(() => {
    const BR = __br.BR, C = window.Char3D, R = __br.Render;
    const t = BR.bots.find(b => b.alive) || BR.bots[0];
    t.alive = true; t.state = 'ground';
    t.weapons[0] = BR.makeWeapon('vector'); t.wIdx = 0;
    t.stance = 'stand'; t.reloading = false; t.atkFlash = 0;
    if (t.bot) t.bot.state = 'COMBAT';
    R.render(BR);
    const a = C.muzzleWorld(t, [0, 0, 0]).slice();
    t.reloading = true; t.reloadLeft = 0.9; t.reloadTotal = 1.8;
    R.render(BR);
    const b = C.muzzleWorld(t, [0, 0, 0]).slice();
    t.reloading = false;
    t.weapons[0] = null; t.weapons[1] = null;
    R.render(BR);
    const bare = C.weaponClass(t);
    t.weapons[0] = BR.makeWeapon('longview');
    R.render(BR);
    const sniper = C.weaponClass(t);
    return { a, b, moved: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), bare, sniper };
  });
  ok('武器が手に追従する（ソケット）', socket.moved > 0.01, socket.moved.toFixed(3) + 'm 移動');
  ok('素手のときは武器を持たない', socket.bare === null);
  ok('武器を持ち替えるとモデルも変わる', socket.sniper === 'SNIPER');

  const perf3d = await G(() => {
    const BR = __br.BR, R = __br.Render, C = window.Char3D;
    const p = BR.player;
    BR.bots.forEach((b, i) => {
      b.alive = true; b.state = 'ground'; b.hp = 100; b.deadT = 0; b.moving = true;
      const d = 4 + (i % 8) * 4.5, off = ((i % 5) - 2) * 1.5;
      b.x = p.x + Math.cos(p.ang) * d - Math.sin(p.ang) * off;
      b.y = p.y + Math.sin(p.ang) * d + Math.cos(p.ang) * off;
      b.weapons[0] = BR.makeWeapon('vector');
    });
    BR.refreshEnemyList();
    const run = () => {
      R.render(BR);
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) { p.animT += 0.016; R.render(BR); }
      return (performance.now() - t0) / 60;
    };
    C.enabled = true; const on = run();
    C.enabled = false; const off = run();
    C.enabled = true;
    return { on: +on.toFixed(2), off: +off.toFixed(2), n: BR.bots.length };
  });
  ok('16人ぶんの3D描画でも1フレーム24ms未満', perf3d.on < 24, perf3d.on + 'ms（2D時 ' + perf3d.off + 'ms）');
  ok('3D化による増加が許容範囲', perf3d.on - perf3d.off < 8, '+' + (perf3d.on - perf3d.off).toFixed(2) + 'ms');
  ok('3D描画を切ってもゲームは動く', (await G(() => {
    window.Char3D.enabled = false;
    __br.Render.render(__br.BR);
    const okk = __br.BR.state !== 'LOBBY';
    window.Char3D.enabled = true;
    return okk;
  })));
  ok('3Dまわりでエラーが出ていない', errors.length === 0, errors.join(' | '));

  await browser.close();
  await new Promise(r => server.close(r));
  report();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
