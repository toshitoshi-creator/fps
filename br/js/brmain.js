/* ===== brmain.js — 起動とメインループ ======================================= */
(function (g) {
  'use strict';

  // Sprites は DATA.ENEMIES からパレットを引くので、BR用のアバターを渡す
  g.DATA = { ENEMIES: BRDATA.AVATARS };

  const THEME = {
    texStyle: 'br',
    ceil: '#cfefff', ceil2: '#7fd0f5',
    floor: '#5f9c56', floor2: '#9dc888',
    fog: '#d6e8f2',
    walls: ['#c9b48a', '#5a7a4a', '#b5813f', '#2f79a8']
  };

  let last = 0, frames = 0, fpsT = 0, fps = 60, portrait = false;
  let hintStep = 0, autoRunT = 0, buildPending = 0;
  const adsElOff = () => { const e = U.$id('btnAds'); if (e) e.classList.remove('toggled'); };

  function checkOrientation() {
    const p = window.innerHeight > window.innerWidth * 1.04;
    if (p !== portrait) { portrait = p; U.show(U.$id('rotate'), p); }
    return p;
  }
  function resize() {
    Render.resize();
    if (GL3D.ok) GL3D.resize();
    const o = U.$id('ovl');
    if (o) { const d = Math.min(2, window.devicePixelRatio || 1); o.width = Math.round(o.clientWidth * d) || 1; o.height = Math.round(o.clientHeight * d) || 1; }
    checkOrientation();
  }

  /* ---------------- 設定の反映 ---------------- */
  function applySettings() {
    const s = BRSave.data.settings;
    Input.sensitivity = s.sens;
    Input.setLefty(s.lefty);
    Snd.setSfx(s.sfx); Snd.setBgm(s.bgm);
    Haptics.setEnabled(s.vibrate);
    Render.setQuality(s.quality);
    if (GL3D.ok) { GL3D.setQuality(s.quality); GL3D.view = s.view === 'FPP' ? 'FPP' : 'TPP'; }
    BRPlayer.aimAssist = BRSave.aimAssist();
    BRPlayer.sens = s.sens;
    BRPlayer.adsSens = s.adsSens / 100;
    BRPlayer.gyro = s.gyro;
    BRPlayer.gyroSens = s.gyroSens / 100;
    document.documentElement.style.setProperty('--btn-scale', s.btnScale / 100);
    document.documentElement.style.setProperty('--btn-alpha', s.btnOpacity / 100);
  }

  /* ---------------- マッチ開始 ---------------- */
  function startMatch() {
    Snd.resume();
    BR.newMatch({ bots: BRSave.data.settings.bots });
    Render.setStage(THEME);
    if (GL3D.active) {
      // 島の3Dを組み立てる間（端末で0.5〜1秒）は読み込み表示を出して、止まって見えないようにする
      U.show(U.$id('loading'), true);
      buildPending = 2;
    }
    BRUI.marker = null;
    BRUI.show('dropScreen');
    Input.setEnabled(true);
    Snd.startBgm('battle');
    hintStep = BRSave.data.stats.matches === 0 ? 1 : 0;
  }

  /* ---------------- イベント配線 ---------------- */
  function wireEvents() {
    BR.on('state', s => {
      if (s === 'PLANE' || s === 'DROP') BRUI.show('dropScreen');
      if (s === 'EARLY_GAME') { BRUI.show('hud'); BRUI.bigMsg('着地'); }
      if (s === 'FINAL_ZONE') BRUI.bigMsg('FINAL ZONE');
    });
    BR.on('kill', (victim, src) => {
      Snd.play(victim.isPlayer ? 'gameover' : 'enemy_die', { vol: victim.isPlayer ? 1 : 0.5 });
      BR.bloodAt(victim.x, victim.y, 0.6, 18, victim.def.palette.trim);
      if (src && src.isPlayer) {
        const kw = src.weapons[src.wIdx];
        BRUI.killBanner(victim.name, kw ? kw.def.name : '', BR.stats.kills);
        BR.addShake(0.9);
        BR.hitstop = Math.max(BR.hitstop, 0.05);
        Haptics.tap('kill');
        if (hintStep === 4) { hintStep = 5; BRUI.tutorial('装備を整えて安全地帯の中心へ'); setTimeout(() => BRUI.tutorial(null), 4000); }
      }
    });
    BR.on('player_hurt', (dmg, src) => {
      BRUI.damageFlash(U.clamp(dmg / 30, 0.25, 1));
      Snd.play('hurt');
      Haptics.tap('hurt');
      BR.addShake(0.8);
      if (src) BRUI.dirIndicator(U.angDiff(BR.player.ang, Math.atan2(src.y - BR.player.y, src.x - BR.player.x)));
    });
    BR.on('zone_damage', () => { BRUI.damageFlash(0.35); });
    BR.on('zone_shrink', n => { BRUI.bigMsg('ZONE ' + n + ' 縮小開始'); Snd.play('warn'); BRUI.feed('安全地帯が縮小中', 'warn'); });
    BR.on('shot', (c, w) => {
      Snd.play(w.def.sfx, { vol: c.isPlayer ? 1 : U.clamp(20 / (1 + U.dist(c.x, c.y, BR.player.x, BR.player.y)), 0.05, 0.5) });
      if (!c.isPlayer) {
        BR._gunPings = (BR._gunPings || []).filter(p => p.t > 0);
        if (U.dist(c.x, c.y, BR.player.x, BR.player.y) < 55) BR._gunPings.push({ x: c.x, y: c.y, t: 2.2 });
      }
    });
    BR.on('hitmark', head => { BRUI.hitmark(head); Snd.play(head ? 'crit' : 'hit'); });
    BR.on('reload_start', c => { if (c.isPlayer) { Snd.play('reload_start'); Haptics.tap('reload'); } });
    BR.on('reload_end', c => { if (c.isPlayer) Snd.play('reload_end'); });
    BR.on('pickup', (c, l) => { if (c.isPlayer) { Snd.play('coin'); BRUI.feed('取得 ' + l.name, 'coin'); } });
    BR.on('explosion', (x, y) => { Snd.play('explosion'); if (GL3D.active) GL3D.addBlast(x, y, 0.3); });
    BR.on('dry', () => Snd.play('dry'));
    BR.on('switch', c => { if (c.isPlayer) Snd.play('switch'); });
    BR.on('chute', c => { if (c.isPlayer) { Snd.play('zone'); BRUI.bigMsg('PARACHUTE'); } });
    BR.on('land', c => { if (c.isPlayer) Snd.play('impact_wall'); });
    BR.on('finish', (won, stats) => {
      Snd.stopBgm();
      Snd.play(won ? 'clear' : 'gameover');
      Haptics.tap(won ? 'clear' : 'over');
      Input.setEnabled(false);
      const reward = BRSave.applyMatch({
        kills: stats.kills, damage: stats.damage, headshots: stats.headshots,
        survived: stats.survived, placement: stats.placement,
        total: BR.combatants.length, won: !!won, lootPicked: stats.lootPicked
      });
      setTimeout(() => { BR.setState('RESULT'); BRUI.showResult(BR, won, reward); }, 1200);
    });
  }

  /* ---------------- 操作の配線 ---------------- */
  function wireControls() {
    Input.onReload = () => BR.tryReload(BR.player);
    Input.onSwitch = () => BR.switchWeapon(BR.player);
    Input.onSelectWeapon = i => BR.switchWeapon(BR.player, i);
    // ADS: 短くタップで切り替え / 押しっぱなしなら離すと戻る（どちらの癖でも使える）
    const adsEl = U.$id('btnAds');
    let adsT0 = 0, adsWas = false;
    Input.hold('btnAds', () => {
      adsWas = !!Input._btnAds; Input._btnAds = true; adsT0 = performance.now();
    }, () => {
      const held = performance.now() - adsT0;
      if (held > 300 || adsWas) Input._btnAds = false;
      adsEl.classList.toggle('toggled', !!Input._btnAds);
    });
    // 左手側の射撃ボタン（右手で狙いながら左親指で撃てる）
    Input.hold('btnFire2', () => { Input._btnFire2 = true; }, () => { Input._btnFire2 = false; });
    // 射撃ボタンを押したまま指を動かすと、そのまま狙いを動かせる
    ['btnFire', 'btnFire2'].forEach(id => {
      const el = U.$id(id);
      let lx = 0, ly = 0, on = false;
      el.addEventListener('pointerdown', e => { on = true; lx = e.clientX; ly = e.clientY; });
      el.addEventListener('pointermove', e => {
        if (!on || !Input._enabled) return;
        Input.look.dx += (e.clientX - lx); Input.look.dy += (e.clientY - ly);
        lx = e.clientX; ly = e.clientY;
      });
      const off = () => { on = false; };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    });
    Input.tap('btnView', () => {
      const s = BRSave.data.settings;
      s.view = s.view === 'FPP' ? 'TPP' : 'FPP';
      BRSave.save(); applySettings();
      Snd.play('btn');
    });
    Input.tap('btnProne', () => BRPlayer.toggleProne(BR));
    Input.tap('btnItem', () => {
      const p = BR.player;
      const id = p.items.medkit > 0 && p.hp < p.maxHp * 0.5 ? 'medkit'
        : (p.items.bandage > 0 ? 'bandage' : (p.items.medkit > 0 ? 'medkit' : (p.items.energy > 0 ? 'energy' : null)));
      if (id && BR.useItem(p, id)) Snd.play('btn'); else Snd.play('dry');
    });
    Input.tap('btnThrow', () => { if (!BR.throwFrag(BR.player)) Snd.play('dry'); });
    Input.tap('btnBag', () => { BRUI.refreshBag(BR); BRUI.show('bagScreen'); Input.setEnabled(false); });
    Input.tap('lootPrompt', () => {
      const got = BRPlayer.interact(BR);
      if (got && hintStep === 3) { hintStep = 4; BRUI.tutorial('敵を見つけたら FIRE。ADSで狙いやすくなる'); setTimeout(() => BRUI.tutorial(null), 4500); }
    });
    Input.tap('btnMap', () => { BRUI.show('mapScreen'); Input.setEnabled(false); drawBigMap(); });
    Input.tap('btnDrop', () => { BR.startDrop(BR.player); Snd.play('btn_big'); });

    U.$id('mapClose').addEventListener('click', () => { BRUI.show('hud'); Input.setEnabled(true); });
    U.$id('bagClose').addEventListener('click', () => { BRUI.show('hud'); Input.setEnabled(true); });

    // インベントリ内のタップ操作
    U.$id('bagBody').addEventListener('click', e => {
      const use = e.target.closest('[data-use]');
      if (use) { BR.useItem(BR.player, use.getAttribute('data-use')); BRUI.refreshBag(BR); return; }
      const slot = e.target.closest('[data-wslot]');
      if (slot) { BR.switchWeapon(BR.player, +slot.getAttribute('data-wslot')); BRUI.refreshBag(BR); }
    });
    U.$id('lootMore').addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-loot]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const l = (BRUI._lootRows || [])[+b.getAttribute('data-loot')];
      if (l && l.alive && BR.player.state === 'ground') {
        const got = BR.pickup(BR.player, l);
        if (got) { BR.stats.lootPicked++; Haptics.tap('ui'); }
        else Snd.play('dry');
      }
    });
    U.$id('wpnSlots').addEventListener('pointerdown', e => {
      const s = e.target.closest('[data-slot]');
      if (s) { e.preventDefault(); e.stopPropagation(); BR.switchWeapon(BR.player, +s.getAttribute('data-slot')); }
    });

    // マップのタップでマーカー
    U.$id('bigMap').addEventListener('click', e => {
      const cv = e.currentTarget, r = cv.getBoundingClientRect();
      const xf = BRUI._bigXf;
      if (!xf) return;
      const px = (e.clientX - r.left) * (cv.width / r.width);
      const py = (e.clientY - r.top) * (cv.height / r.height);
      BRUI.marker = { x: (px - xf.ox) / xf.s, y: (py - xf.oy) / xf.s };
      drawBigMap();
      Snd.play('btn');
    });
    U.$id('dropMap').addEventListener('click', e => {
      const cv = e.currentTarget, r = cv.getBoundingClientRect();
      const xf = BRUI._dropXf;
      if (!xf) return;
      const px = (e.clientX - r.left) * (cv.width / r.width);
      const py = (e.clientY - r.top) * (cv.height / r.height);
      BRUI.marker = { x: (px - xf.ox) / xf.s, y: (py - xf.oy) / xf.s };
      Snd.play('btn');
    });

    // ナビゲーション
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-nav]');
      if (!t) return;
      const nav = t.getAttribute('data-nav');
      Snd.play(nav === 'play' || nav === 'again' ? 'btn_big' : 'btn');
      if (nav === 'play' || nav === 'again') startMatch();
      else if (nav === 'lobby') { Snd.startBgm('menu'); Input.setEnabled(false); BRUI.show('lobbyScreen'); }
      else if (nav === 'stats') BRUI.show('statsScreen');
      else if (nav === 'missions') BRUI.show('missionScreen');
      else if (nav === 'settings') BRUI.show('settingsScreen');
    });

    U.$id('missionBody').addEventListener('click', e => {
      const b = e.target.closest('[data-claim]');
      if (!b) return;
      const m = BRSave.claimMission(b.getAttribute('data-claim'));
      Snd.play(m ? 'upgrade' : 'dry');
      BRUI.refreshMissions();
    });
    wireSettings();
  }

  function wireSettings() {
    const s = () => BRSave.data.settings;
    const range = (id, key, fmt) => {
      const el = U.$id(id);
      el.addEventListener('input', () => {
        s()[key] = +el.value;
        U.$id(id + 'Val').textContent = fmt ? fmt(+el.value) : el.value;
        BRSave.save(); applySettings();
      });
    };
    range('setSens', 'sens'); range('setAdsSens', 'adsSens'); range('setGyroSens', 'gyroSens');
    range('setBtn', 'btnScale'); range('setOpacity', 'btnOpacity'); range('setBots', 'bots');
    const toggle = (id, key, after) => U.$id(id).addEventListener('click', () => {
      Snd.play('btn');
      s()[key] = s()[key] ? 0 : 1;
      BRSave.save(); applySettings(); BRUI.refreshSettings();
      if (after) after(s()[key]);
    });
    toggle('setAuto', 'autoPick'); toggle('setSfx', 'sfx'); toggle('setBgm', 'bgm');
    toggle('setVib', 'vibrate'); toggle('setLefty', 'lefty');
    U.$id('setView').addEventListener('click', () => {
      Snd.play('btn');
      s().view = s().view === 'FPP' ? 'TPP' : 'FPP';
      BRSave.save(); applySettings(); BRUI.refreshSettings();
    });
    U.$id('setAim').addEventListener('click', () => {
      Snd.play('btn');
      const order = ['OFF', 'LOW', 'MED', 'HIGH'];
      s().aim = order[(order.indexOf(s().aim) + 1) % order.length];
      BRSave.save(); applySettings(); BRUI.refreshSettings();
    });
    U.$id('setGyro').addEventListener('click', () => {
      Snd.play('btn');
      s().gyro = BRSave.GYRO[(BRSave.GYRO.indexOf(s().gyro) + 1) % BRSave.GYRO.length];
      BRSave.save(); applySettings(); BRUI.refreshSettings();
      if (s().gyro !== 'OFF') BRPlayer.initGyro();
    });
    U.$id('setQuality').addEventListener('click', () => {
      Snd.play('btn');
      const order = ['AUTO', 'LOW', 'MID', 'HIGH'];
      s().quality = order[(order.indexOf(s().quality) + 1) % order.length];
      BRSave.save(); applySettings(); BRUI.refreshSettings();
    });
    U.$id('setWipe').addEventListener('click', () => {
      if (!BRUI._wipeArm) {
        BRUI._wipeArm = true;
        U.$id('setWipe').textContent = '本当に削除？';
        Snd.play('dry');
        setTimeout(() => { BRUI._wipeArm = false; BRUI.refreshSettings(); }, 3000);
        return;
      }
      BRSave.wipe(); BRUI._wipeArm = false;
      applySettings(); BRUI.refreshSettings(); BRUI.refreshLobby();
      Snd.play('gameover');
    });
  }

  function drawBigMap() {
    const cv = U.$id('bigMap');
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(220, r.width | 0); cv.height = Math.max(220, r.height | 0);
    BRUI._bigXf = BRUI.drawWorldMap(cv, BR, { plane: BR.state === 'PLANE' });
  }

  /* ---------------- チュートリアル ---------------- */
  function updateHints() {
    if (!hintStep) return;
    const p = BR.player;
    if (hintStep === 1 && BR.state === 'PLANE') {
      BRUI.tutorial('右上のマップをタップして目的地を決め、DROP で降下');
    } else if (hintStep === 1 && p.state === 'drop') {
      hintStep = 2; BRUI.tutorial('左スティックで滑空方向を調整 / 右側をスワイプで見回す');
    } else if (hintStep >= 1 && hintStep <= 2 && p.state === 'ground') {
      hintStep = 3; BRUI.tutorial('足元のアイテムは右の一覧をタップで拾える');
      setTimeout(() => { if (hintStep === 3) BRUI.tutorial(null); }, 7000);
    }
  }

  /* ---------------- ループ ---------------- */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = (ts - last) / 1000; last = ts;
    if (dt > 0.25) dt = 0.25;
    if (g.Char3D) Char3D.resetStats();
    frames++; fpsT += dt;
    if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (GL3D.active) GL3D.autoTune(fps); else Render.autoTune(fps); }

    if (buildPending > 0) {
      // 読み込み表示を1フレーム描かせてから、島を組み立てる
      if (--buildPending === 0) { GL3D.setMap(BR.map); last = 0; U.show(U.$id('loading'), false); }
      return;
    }
    const playing = ['PLANE', 'DROP', 'EARLY_GAME', 'MID_GAME', 'LATE_GAME', 'FINAL_ZONE'].indexOf(BR.state) >= 0;
    if (playing && BRUI.cur !== 'bagScreen' && BRUI.cur !== 'mapScreen') {
      Input.pollKeys();
      if (Input._btnFire2) Input.fire = true;
      // スティックを前に倒し切ると自動でダッシュ（片手で走れる）
      const push = Input.move.y > 0.96 && Math.abs(Input.move.x) < 0.45 && Input._stickId !== null;
      autoRunT = push ? autoRunT + dt : 0;
      if (autoRunT > 0.35) Input.sprint = true;
      const sb = U.$id('stickBase');
      if (sb) sb.classList.toggle('sprint', autoRunT > 0.35);
      if (Input._btnAds && (Input.sprint || BR.player.switchT > 0 || BR.player.state !== 'ground')) {
        Input._btnAds = false; Input.ads = false; adsElOff();
      }
      BRPlayer.update(BR, Math.min(dt, 0.05));
      BR.update(dt);
      // 自動拾い
      if (BRSave.data.settings.autoPick && BR.player.state === 'ground') {
        const l = BR.lootNear(BR.player, 1.1);
        if (l && (l.kind === 'ammo' || l.kind === 'item')) BR.pickup(BR.player, l);
      }
      (BR._gunPings || []).forEach(p => p.t -= dt);
    }

    if (GL3D.active) {
      // WebGL: 輸送機・降下・地上のすべてを同じ3Dの世界で描く
      if (BRUI.cur === 'lobbyScreen' || BRUI.cur === 'statsScreen' || BRUI.cur === 'missionScreen' || BRUI.cur === 'settingsScreen') {
        GL3D.renderLobby(ts / 1000, lobbyDummy());
        BRUI.clearOverlay();
      } else if (BR.map && BR.player) {
        Render.updateCamera(BR.player, BR.shakeYaw, BR.shakePitch, BR.curZoom);
        GL3D.render(BR, dt);
        BRUI.drawOverlay(BR);
      }
    } else if (BR.map && BR.player) {
      if (BR.player.state === 'ground') Render.render(BR);
      else {
        // 降下中は3D描画を止め、上空マップを見せる
        const x = Render.ctx;
        x.fillStyle = '#0a1622'; x.fillRect(0, 0, Render.W, Render.H);
      }
    }
    if (BRUI.cur === 'dropScreen') BRUI.syncDrop(BR);
    if (BRUI.cur === 'hud' || BRUI.cur === 'dropScreen') BRUI.syncHud(BR);
    if (playing) updateHints();
  }

  /** ロビーに飾る自分のキャラクター（装備を見せるためだけのダミー） */
  let _dummy = null;
  function lobbyDummy() {
    if (_dummy) return _dummy;
    const w = { def: BRDATA.WEAPON_BY_ID.raptor, id: 'raptor', mag: 30, magMax: 30 };
    _dummy = {
      id: 'YOU#lobby', name: 'YOU', isPlayer: true, def: BRDATA.AVATARS.br_player,
      x: 12, y: 12, z: 0, ang: 0, pitch: 0, alive: true, state: 'ground', stance: 'stand',
      weapons: [w, null], wIdx: 0, helmet: 2, armorMax: 80, armor: 80, animT: 0,
      moving: false, sprinting: false, hurtT: 0, atkFlash: 0, switchT: 0, reloading: false, flashT: 0
    };
    return _dummy;
  }

  function boot() {
    BRSave.load();
    Render.init(U.$id('view'));
    // WebGL2 が使えれば写実寄りの3D描画に切り替える（使えなければ従来の描画のまま）
    GL3D.active = GL3D.init(U.$id('gl'));
    document.body.classList.toggle('gl3d', !!GL3D.active);
    // GPUのリセット等で描画コンテキストを失ったら、従来の描画で遊び続けられるようにする
    U.$id('gl').addEventListener('webglcontextlost', e => {
      e.preventDefault();
      GL3D.active = false; GL3D.ok = false;
      document.body.classList.remove('gl3d');
      BRUI.clearOverlay();
    });
    Sprites.style = 'pop';
    Render.floorGrid = true;
    Render.use3d = true;            // キャラクターを3Dモデルで描く
    Render.groundTex = true;        // 地面を世界座標から塗る（草・土のむら）
    Render.groundDirt = [124, 103, 74];
    Render.sun = Char3D.light;      // 空の光芒をキャラの光源と揃える
    Input.init();
    BRUI.init();
    applySettings();
    wireEvents();
    wireControls();

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));
    const unlock = () => {
      if (Snd.init()) { Snd.resume(); if (BRUI.cur === 'lobbyScreen') Snd.startBgm('menu'); }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    resize();
    BRUI.show('lobbyScreen');
    U.show(U.$id('loading'), false);
    requestAnimationFrame(loop);
  }

  /* --- テスト用フック --- */
  g.__br = {
    BR, BRUI, BRSave, BRPlayer, BRDATA, BRMap, BRBot, Render, Input, U, Snd, Haptics, GL3D,
    fps: () => fps,
    startMatch, lobbyDummy,
    state: () => BR.state,
    /** 指定秒ぶんシミュレーションを進める（描画なし） */
    async sim(sec, step) {
      const dt = step || 1 / 30;
      const n = Math.ceil(sec / dt);
      for (let i = 0; i < n; i++) {
        BR.update(dt);
        if (i % 60 === 0) await new Promise(r => setTimeout(r, 0));
        if (BR.state === 'VICTORY' || BR.state === 'DEFEAT' || BR.state === 'RESULT') break;
      }
      return BR.state;
    },
    giveWeapon(id, slot) {
      const p = BR.player;
      p.weapons[slot || 0] = BR.makeWeapon(id);
      p.ammo[BRDATA.WEAPON_BY_ID[id].ammo] = 200;
      return p.weapons[slot || 0];
    },
    teleport(x, y) { BR.player.x = x; BR.player.y = y; },
    /** 自分の3Dキャラクターを見るための三人称表示（確認用） */
    thirdPerson(on, dist) {
      Render.thirdPerson = on ? (dist || 2.6) : 0;
      Render.showSelf = !!on;
      return Render.thirdPerson;
    },
    char3d(on) { if (on != null) Char3D.enabled = !!on; return Char3D.enabled; },
    char3dStats: () => Char3D.stats,
    /** テスト用。プレイヤーへのダメージだけを無効化する */
    godMode(on) {
      if (on && !BR._origDamage) {
        BR._origDamage = BR.damage;
        BR.damage = function (t, a, s, h, m) {
          // プレイヤーだけ無敵にする。撃った側の与ダメージ記録は残す
          if (t.isPlayer) { if (s) s.damage += Math.round(a); return 0; }
          return BR._origDamage.call(this, t, a, s, h, m);
        };
      } else if (!on && BR._origDamage) {
        BR.damage = BR._origDamage; BR._origDamage = null;
      }
      return !!on;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
