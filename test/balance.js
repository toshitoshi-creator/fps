/* =========================================================================
 * balance.js — plays the whole campaign with a deliberately mediocre bot
 * (slow turning, imperfect aim, human-ish reaction delay) to check that the
 * difficulty curve is fair and every stage is actually completable.
 *   node test/balance.js [runsPerStage]
 * ======================================================================= */
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
const PORT = 8944;
const RUNS = +(process.argv[2] || 3);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch(launchOpts());
  const page = await (await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(300);

  const out = await page.evaluate(async (RUNS) => {
    const { Game, Save, Render, Input, U, DATA } = __game;

    async function bot(stageId, skill) {
      Game.startStage(stageId);
      const p = Game.player;
      let t = 0, reaction = 0, strafeT = 0, strafeDir = 1;
      const TURN = 2.6 * skill;                 // rad/s — deliberately slow
      const AIM_ERR = 0.055 / skill;
      const dt = 1 / 60;
      let hpMin = p.hp;
      while (Game.state === 'playing' && t < 240) {
        t += dt;
        // pick the nearest enemy we can actually see
        let tgt = null, bd = 1e9, tgtVis = false;
        for (const e of Game.enemies) {
          if (e.state === 'dead') continue;
          const d = U.dist(p.x, p.y, e.x, e.y);
          const vis = Render.los(Game.map, p.x, p.y, e.x, e.y);
          if (vis && !tgtVis) { tgt = e; bd = d; tgtVis = true; }
          else if (vis === tgtVis && d < bd) { tgt = e; bd = d; }
        }
        Input._keys = {}; Input._btnFire = false;

        // 拠点確保 / 脱出は「目標地点へ歩く」のが正解なので、そちらを優先する
        let goal = null;
        const obj = Game.stage.objective;
        if (obj === 'capture') goal = (Game.zones || []).find(z => !z.done);
        else if (obj === 'reach') {
          const need = Game.stage.reachKills || 0;
          goal = Game.kills >= need ? (Game.zones || [])[0] : null;   // 解放前は敵を倒す
        }
        const goalDist = goal ? U.dist(p.x, p.y, goal.x, goal.y) : Infinity;

        if (goal && goalDist > 0.9) {
          // 目標へ向かいつつ、視界に敵がいれば撃つ
          const m = Game.map;
          const dist = new Int32Array(m.w * m.h).fill(-1);
          const start = (goal.y | 0) * m.w + (goal.x | 0);
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
          let bestV = dist[py * m.w + px], wp = { x: goal.x, y: goal.y };
          for (let k = 0; k < 4; k++) {
            const nx = px + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            const v = dist[ny * m.w + nx];
            if (v >= 0 && (bestV < 0 || v < bestV)) { bestV = v; wp = { x: nx + 0.5, y: ny + 0.5 }; }
          }
          const want = Math.atan2(wp.y - p.y, wp.x - p.x);
          p.ang = U.approachAngle(p.ang, want, TURN * 1.5 * dt);
          Input._keys.KeyW = true;
          if (tgt && tgtVis && bd < p.weapon.range && Math.abs(U.angDiff(p.ang, Math.atan2(tgt.y - p.y, tgt.x - p.x))) < 0.25) {
            Input._btnFire = true;
          }
          if (p.weapon.mag === 0 && !p.reloading) Game.tryReload();
          Game.update(dt);
          hpMin = Math.min(hpMin, p.hp);
          if (t % 1 < dt) await new Promise(r => setTimeout(r, 0));
          continue;
        }

        // 拠点の上に立っている間は動かない（動くと確保ゲージが戻るため）
        const holding = !!(goal && goalDist <= 0.9);

        if (tgt) {
          const want = Math.atan2(tgt.y - p.y, tgt.x - p.x) + Math.sin(t * 5.3) * AIM_ERR;
          p.ang = U.approachAngle(p.ang, want, TURN * dt);
          const err = Math.abs(U.angDiff(p.ang, want));
          if (tgtVis) {
            reaction -= dt;
            if (err < 0.05 && reaction <= 0 && p.weapon.mag > 0 && !p.reloading) Input._btnFire = true;
            if (!holding) {
              if (bd > p.weapon.range * 0.55) Input._keys.KeyW = true;
              else if (bd < 2.4) Input._keys.KeyS = true;
              strafeT -= dt;
              if (strafeT <= 0) { strafeT = 0.8; strafeDir *= -1; reaction = 0.18 / skill; }
              if (strafeDir > 0) Input._keys.KeyD = true; else Input._keys.KeyA = true;
            }
          } else if (!holding) {
            // no line of sight: follow the corridors toward it, like a player using the compass
            const m = Game.map;
            const dist = new Int32Array(m.w * m.h).fill(-1);
            const start = (tgt.y | 0) * m.w + (tgt.x | 0);
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
            if (wp) p.ang = U.approachAngle(p.ang, Math.atan2(wp.y - p.y, wp.x - p.x), TURN * 1.6 * dt);
            Input._keys.KeyW = true;
          }
        }
        if (p.weapon.mag === 0 && !p.reloading) Game.tryReload();
        Game.update(dt);
        hpMin = Math.min(hpMin, p.hp);
        if (t % 1 < dt) await new Promise(r => setTimeout(r, 0));
      }
      Input._keys = {}; Input._btnFire = false;
      return {
        result: Game.state, time: +t.toFixed(1), kills: Game.kills,
        hp: Math.round(p.hp), hpMin: Math.round(hpMin),
        maxHp: p.maxHp, acc: p.shots ? +(p.hits / p.shots).toFixed(2) : 0
      };
    }

    const report = [];
    for (const st of DATA.STAGES) {
      // simulate a player who has upgraded roughly in step with progression
      Save.wipe();
      Save.data.coins = [0, 250, 600, 1000, 1500, 1900, 2400, 2900, 3400, 4000][st.id - 1];
      Save.data.cleared = DATA.STAGES.filter(s => s.id < st.id).map(s => s.id);
      if (st.id >= 3) Save.unlockWeapon('sg');
      if (st.id >= 5) Save.unlockWeapon('br');
      if (st.id >= 7) Save.unlockWeapon('sr');
      const budget = Save.data.coins;
      // spend roughly half on the rifle and half on the soldier, like a normal player
      const wKeys = ['dmg', 'mag', 'rld', 'ctl'], pKeys = ['hp', 'spd', 'arm', 'amo', 'crt'];
      let guard = 0, wi = 0, pi = 0, stall = 0;
      while (Save.data.coins > 90 && guard++ < 60 && stall < 12) {
        const r = (guard % 2)
          ? Save.upgradeWeapon('ar', wKeys[(wi++) % wKeys.length])
          : Save.upgradePlayer(pKeys[(pi++) % pKeys.length]);
        stall = r === 'ok' ? 0 : stall + 1;
      }
      Save.save();
      const runs = [];
      for (let i = 0; i < RUNS; i++) runs.push(await bot(st.id, 1));
      const wins = runs.filter(r => r.result === 'clear').length;
      report.push({
        stage: st.id, name: st.name, budget,
        wins: wins + '/' + RUNS,
        time: +(runs.reduce((a, r) => a + r.time, 0) / RUNS).toFixed(1),
        hpLeft: Math.round(runs.reduce((a, r) => a + r.hp, 0) / RUNS),
        maxHp: runs[0].maxHp,
        acc: +(runs.reduce((a, r) => a + r.acc, 0) / RUNS).toFixed(2),
        results: runs.map(r => r.result).join(',')
      });
    }
    Save.wipe();
    return report;
  }, RUNS);

  console.log('\n  凡庸なボットによる難易度チェック (' + RUNS + ' runs / stage)\n');
  console.log('  ST  NAME              予算   勝率   平均時間  残HP/最大  命中率');
  out.forEach(r => console.log(
    '  ' + String(r.stage).padEnd(3) + r.name.padEnd(18) +
    String(r.budget).padStart(5) + '  ' + r.wins.padStart(5) + '  ' +
    (r.time + 's').padStart(7) + '  ' + (r.hpLeft + '/' + r.maxHp).padStart(9) + '  ' +
    String(Math.round(r.acc * 100) + '%').padStart(5)));
  // early stages must be reliably clearable; the finale is allowed to be a real fight
  const need = { 1: 1, 2: 1, 3: 1, 4: 0.8, 5: 0.8, 6: 0.6, 7: 0.6, 8: 0.6, 9: 0.5, 10: 0.3 };
  const bad = out.filter(r => {
    const [w, n] = r.wins.split('/').map(Number);
    return w / n < need[r.stage];
  });
  const tooEasy = out.every(r => r.hpLeft > r.maxHp * 0.95);
  console.log('  ' + (bad.length
    ? '\x1b[31m難易度が不適切: STAGE ' + bad.map(b => b.stage).join(', ') + '\x1b[0m'
    : '\x1b[32m難易度カーブは適正（序盤は確実にクリア可能・終盤は歯応えあり）\x1b[0m') +
    (tooEasy ? '  \x1b[33m(緊張感が不足)\x1b[0m' : '') + '\n');
  const allWin = bad.length === 0;
  await b.close(); server.close();
  process.exit(allWin ? 0 : 1);
})();
