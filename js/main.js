/* ===== main.js — bootstrap & main loop ===== */
(function (g) {
  'use strict';

  let last = 0, acc = 0, frames = 0, fpsT = 0, fps = 60;
  let portrait = false;

  function checkOrientation() {
    const p = window.innerHeight > window.innerWidth * 1.04;
    if (p !== portrait) {
      portrait = p;
      U.show(U.$id('rotate'), p);
      if (p && Game.state === 'playing') Game.pause();
    }
    return p;
  }

  function resize() {
    Render.resize();
    checkOrientation();
  }

  function updateTargeting() {
    if (Game.state !== 'playing') return;
    const W = Render.W, H = Render.H, p = Game.player;
    let on = false, nearest = null, nd = 1e9, onScreen = false;
    for (let i = 0; i < Game.enemies.length; i++) {
      const e = Game.enemies[i];
      if (e.state === 'dead') continue;
      const d = U.dist(p.x, p.y, e.x, e.y);
      if (d < nd) { nd = d; nearest = e; }
      if (!e.scr) continue;
      const s = e.scr;
      const halfW = (s.x1 - s.x0) * 0.3;
      if (W / 2 >= s.sx - halfW && W / 2 <= s.sx + halfW &&
        H / 2 >= s.yTop && H / 2 <= s.yBottom) on = true;
      if (s.sx > W * 0.06 && s.sx < W * 0.94) onScreen = true;
    }
    UI.setCrosshairEnemy(on);
    // point at the nearest remaining enemy whenever none is visible on screen
    if (nearest && !onScreen) {
      const bearing = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      UI.setCompass(U.angDiff(p.ang, bearing), nd);
    } else UI.setCompass(null);
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.25) dt = 0.25;          // tab was hidden / long stall

    frames++; fpsT += dt;
    if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; Render.autoTune(fps); }

    if (Game.state === 'playing') Game.update(dt);
    if (Game.map && Game.player) {
      Game.render();
      updateTargeting();
    }
  }

  function boot() {
    Save.load();
    Render.init(U.$id('view'));
    Input.init();
    UI.init();
    UI.applySettings();
    UI.refreshSettings();

    Input.onReload = () => Game.tryReload();
    Input.onSwitch = () => Game.switchWeapon();
    Input.onSelectWeapon = i => Game.switchWeapon(i);

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && Game.state === 'playing') Game.pause();
    });

    // audio needs a user gesture on mobile
    const unlock = () => {
      if (Snd.init()) { Snd.resume(); if (UI.cur === 'title') Snd.startBgm('menu'); }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    resize();
    UI.showScreen('title');
    U.show(U.$id('loading'), false);
    requestAnimationFrame(loop);
  }

  /* --- debug / automated-test hook --- */
  g.__game = {
    Game, Save, Render, Input, UI, Snd, DATA, U,
    fps: () => fps,
    state: () => Game.state,
    // deterministic helpers used by the headless test-suite
    aimAt(e) {
      const p = Game.player;
      Game.shake = 0; Game.shakeYaw = 0; Game.shakePitch = 0;
      p.ang = Math.atan2(e.y - p.y, e.x - p.x);
      p.pitch = 0; p.recoilPitch = 0; p.recoilYaw = 0;
      Render.updateCamera(p, 0, 0, Game.curZoom);
    },
    shootOnce() { Game.player.fireCd = 0; Game.player.semiLatch = false; Game.fire(); },
    teleport(x, y) { Game.player.x = x; Game.player.y = y; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
