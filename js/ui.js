/* ===== ui.js — HUD, menus, armory, dialogs ===== */
(function (g) {
  'use strict';

  const SCREENS = {
    title: 'titleScreen', stage: 'stageScreen', weapon: 'weaponScreen',
    settings: 'settingsScreen', hud: 'hud', pause: 'pauseScreen',
    over: 'overScreen', clear: 'clearScreen', brief: 'briefScreen'
  };
  const OVERLAYS = ['pause', 'over', 'clear', 'brief'];

  const UI = {
    cur: 'title',
    _armoryTab: 'ar',
    _armoryReturn: 'title',
    _pendingStage: 1,
    _feedTimers: [],
    _dirTimers: [],

    init() {
      this.el = {};
      Object.keys(SCREENS).forEach(k => { this.el[k] = U.$id(SCREENS[k]); });
      this.hp = U.$id('hpFill'); this.hpLag = U.$id('hpLag'); this.hpText = U.$id('hpText');
      this.magText = U.$id('magText'); this.resText = U.$id('resText'); this.wpnName = U.$id('wpnName');
      this.killText = U.$id('killText'); this.coinText = U.$id('coinText');
      this.timerText = U.$id('timerText'); this.stageTag = U.$id('stageTag');
      this.objText = U.$id('objText'); this.objProgress = U.$id('objProgress');
      this.reloadBar = U.$id('reloadBar'); this.reloadFill = U.$id('reloadFill');
      this.crosshair = U.$id('crosshair'); this.hitmark = U.$id('hitmark');
      this.feedEl = U.$id('feed'); this.bigMsgEl = U.$id('bigMsg');
      this.tutEl = U.$id('tutorial'); this.dmgVig = U.$id('dmgVignette');
      this.lowVig = U.$id('lowhpVignette'); this.flashEl = U.$id('flash');
      this.dirEl = U.$id('dirIndicators'); this.slotsEl = U.$id('wpnSlots');
      this.compass = U.$id('compass'); this.cmpDist = U.$id('cmpDist');

      this.bindNav();
      this.bindSettings();
      U.$id('btnPause').addEventListener('click', e => { e.stopPropagation(); Snd.play('btn'); Game.pause(); });
      return this;
    },

    /* --------------------------------------------------------- */
    showScreen(name) {
      Object.keys(SCREENS).forEach(k => U.show(this.el[k], false));
      if (name === 'hud' || OVERLAYS.indexOf(name) >= 0) U.show(this.el.hud, true);
      U.show(this.el[name], true);
      this.cur = name;
      if (name === 'title') { this.refreshTitle(); Snd.startBgm('menu'); }
      if (name === 'stage') this.buildStageList();
      if (name === 'weapon') this.buildArmory();
      if (name === 'settings') this.refreshSettings();
    },

    bindNav() {
      document.addEventListener('click', e => {
        const t = e.target.closest('[data-nav]');
        if (!t) return;
        e.preventDefault();
        const nav = t.getAttribute('data-nav');
        Snd.play(nav === 'start' || nav === 'deploy' ? 'btn_big' : 'btn');
        this.nav(nav);
      });
    },

    nav(what) {
      switch (what) {
        case 'title': Game.quitToMenu(); this.showScreen('title'); break;
        case 'stage': this.showScreen('stage'); break;
        case 'weapon': this._armoryReturn = 'title'; this.showScreen('weapon'); break;
        case 'settings': this.showScreen('settings'); break;
        case 'start': this.showBrief(Save.maxStage()); break;
        case 'deploy': Snd.resume(); Game.startStage(this._pendingStage); break;
        case 'resume': Game.resume(); break;
        case 'restart': Game.startStage(Game.stage.id); break;
        case 'retry': Game.startStage(Game.stage.id); break;
        case 'tostage': Game.quitToMenu(); this.showScreen('stage'); break;
        case 'next': {
          const nx = DATA.STAGES[Game.stageIdx + 1];
          if (nx) this.showBrief(nx.id); else { Game.quitToMenu(); this.showScreen('title'); }
          break;
        }
        case 'armory': this._armoryReturn = 'clear'; this.showScreen('weapon'); break;
        case 'backArmory':
          if (this._armoryReturn === 'clear') this.showScreen('clear');
          else this.showScreen('title');
          break;
      }
    },

    /* ============================= TITLE ============================= */
    refreshTitle() {
      const d = Save.data;
      U.$id('titleProgress').textContent =
        'STAGE ' + Save.maxStage() + ' / ' + DATA.STAGES.length +
        ' · COIN ' + d.coins + ' · KILLS ' + d.totalKills;
      U.all('.coinNum').forEach(e => e.textContent = d.coins);
    },

    /* ============================= BRIEF ============================= */
    showBrief(stageId) {
      const st = DATA.STAGES.find(s => s.id === stageId) || DATA.STAGES[0];
      this._pendingStage = st.id;
      U.$id('briefStage').textContent = st.custom ? 'CUSTOM MAP' : 'STAGE ' + st.id;
      U.$id('briefName').textContent = st.name + ' / ' + st.jp;
      U.$id('briefObj').innerHTML = '<b style="color:var(--accent)">目標: ' +
        this.objectiveLabel(st) + '</b><br>' + st.brief;
      const m = DATA.parseMap(st);
      const counts = {};
      m.enemies.forEach(e => counts[e.t] = (counts[e.t] || 0) + 1);
      (st.waves || []).forEach(w => w.enemies.forEach(e => counts[e.t] = (counts[e.t] || 0) + 1));
      U.$id('briefEnemies').innerHTML = Object.keys(counts).map(k =>
        '<span class="ebadge">' + DATA.ENEMIES[k].name + ' ×' + counts[k] + '</span>').join('');
      this.showScreen('brief');
    },

    /* ============================= STAGE SELECT ============================= */
    buildStageList() {
      const wrap = U.$id('stageList');
      const d = Save.data;
      wrap.innerHTML = '';
      DATA.STAGES.forEach(st => {
        const unlocked = Save.isStageUnlocked(st.id);
        const rank = d.ranks[st.id];
        const bt = d.bestTime[st.id];
        const b = document.createElement('button');
        b.className = 'stage-card' + (unlocked ? '' : ' locked') + (st.boss ? ' boss' : '') + (st.custom ? ' custom' : '');
        b.innerHTML =
          '<div class="sc-no">' + (st.custom ? 'CUSTOM' : 'STAGE ' + st.id) + '</div>' +
          '<div class="sc-name">' + st.name + '</div>' +
          '<div class="sc-meta">' + st.jp + (st.boss ? ' · BOSS' : '') + '<br>' +
          (unlocked ? (bt ? 'BEST ' + U.fmtTime(bt) : 'NO RECORD') : '前のステージをクリアしてください') + '</div>' +
          (rank ? '<div class="sc-rank">' + rank + '</div>' : '');
        if (unlocked) b.addEventListener('click', () => { Snd.play('btn_big'); this.showBrief(st.id); });
        else b.addEventListener('click', () => Snd.play('dry'));
        wrap.appendChild(b);
      });
      U.all('.coinNum').forEach(e => e.textContent = d.coins);
    },

    /* ============================= ARMORY ============================= */
    buildArmory() {
      const d = Save.data;
      U.all('.coinNum').forEach(e => e.textContent = d.coins);
      const tabs = U.$id('wpnTabs');
      tabs.innerHTML = '';
      DATA.WEAPONS.forEach(w => {
        const owned = Save.owns(w.id);
        const b = document.createElement('button');
        b.className = 'wtab' + (this._armoryTab === w.id ? ' active' : '') + (owned ? '' : ' lock');
        b.textContent = (owned ? '' : '🔒 ') + w.short;
        b.addEventListener('click', () => { Snd.play('btn'); this._armoryTab = w.id; this.buildArmory(); });
        tabs.appendChild(b);
      });
      const back = U.$('#weaponScreen .back-btn');
      back.setAttribute('data-nav', 'backArmory');
      this.renderWeaponDetail();
      this.renderUpgrades();
    },

    renderWeaponDetail() {
      const wid = this._armoryTab;
      const base = DATA.WEAPON_BY_ID[wid];
      const owned = Save.owns(wid);
      const st = Save.weaponStats(wid);
      const cv = U.$id('wpnPreview'), x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height);
      x.save();
      x.globalAlpha = owned ? 1 : 0.35;
      Sprites.drawWeapon(x, wid, cv.width * 0.52, cv.height * 0.58, 0.44, { color: base.color, flash: 0 });
      x.restore();

      U.$id('wpnTitle').textContent = base.name;
      U.$id('wpnDesc').textContent = base.cat + ' — ' + base.desc;

      const rows = [
        ['攻撃力', st.damage * st.pellets, 220, Math.round(st.damage * st.pellets) + (st.pellets > 1 ? ' (×' + st.pellets + ')' : ''), st.damage > base.damage],
        ['連射速度', st.rpm, 950, st.rpm + ' RPM', false],
        ['装弾数', st.mag, 45, st.mag + ' 発', st.mag > base.mag],
        ['リロード', 3.2 - st.reload, 3.2, st.reload.toFixed(2) + ' 秒', st.reload < base.reload],
        ['射程', st.range, 60, Math.round(st.range) + ' m', false],
        ['精度', 6 - st.spread, 6, (6 - st.spread).toFixed(1), st.spread < base.spread],
        ['クリティカル', st.crit, 4, '×' + st.crit.toFixed(2), st.crit > base.crit]
      ];
      U.$id('wpnStats').innerHTML = rows.map(r =>
        '<div class="srow"><span class="sname">' + r[0] + '</span>' +
        '<span class="sbar"><i class="' + (r[4] ? 'up' : '') + '" style="width:' +
        U.clamp(r[1] / r[2] * 100, 2, 100).toFixed(1) + '%"></i></span>' +
        '<span class="sval">' + r[3] + '</span></div>').join('');

      const btn = U.$id('wpnAction');
      btn.className = 'mbtn small';
      if (!owned) {
        if (base.price > 0) {
          btn.textContent = '購入 ' + base.price + '◆';
          btn.classList.toggle('locked', Save.data.coins < base.price);
          btn.onclick = () => {
            if (Save.data.coins < base.price) { Snd.play('dry'); return; }
            Save.spend(base.price); Save.unlockWeapon(wid); Save.equip(wid);
            Snd.play('upgrade'); this.buildArmory(); this.refreshTitle();
          };
        } else {
          btn.textContent = base.unlockNote;
          btn.classList.add('locked');
          btn.onclick = () => Snd.play('dry');
        }
      } else if (Save.data.equipped === wid) {
        btn.textContent = '装備中';
        btn.classList.add('locked');
        btn.onclick = () => { };
      } else {
        btn.textContent = 'この武器を装備';
        btn.onclick = () => { Save.equip(wid); Snd.play('btn_big'); this.buildArmory(); };
      }
      btn.classList.remove('hidden');
    },

    renderUpgrades() {
      const wid = this._armoryTab;
      const owned = Save.owns(wid);
      const mk = (def, lv, cost, onBuy, disabled) => {
        const row = document.createElement('div');
        row.className = 'upg-row';
        const maxed = lv >= def.max;
        const afford = !maxed && Save.data.coins >= cost;
        row.innerHTML =
          '<div class="upg-info"><div class="upg-name">' + def.name + '</div>' +
          '<div class="upg-lv">' + Array.from({ length: def.max }, (_, i) =>
            '<i class="' + (i < lv ? 'on' : '') + '"></i>').join('') + '</div>' +
          '<div class="upg-eff">現在 ' + (lv ? def.eff(lv) : '—') +
          (maxed ? '' : ' → 次 ' + def.eff(lv + 1)) + '</div></div>';
        const b = document.createElement('button');
        b.className = 'upg-buy' + (maxed ? ' max' : (afford && !disabled ? '' : ' no'));
        b.textContent = maxed ? 'MAX' : (disabled ? '未所持' : cost + '◆');
        if (!maxed && !disabled) b.addEventListener('click', () => {
          if (!afford) { Snd.play('dry'); return; }
          onBuy(); Snd.play('upgrade');
          this.buildArmory(); this.refreshTitle();
        });
        else b.addEventListener('click', () => Snd.play('dry'));
        row.appendChild(b);
        return row;
      };

      const wl = U.$id('wpnUpgrades'); wl.innerHTML = '';
      DATA.WEAPON_UPGRADES.forEach(def => {
        const lv = Save.data.wUpg[wid][def.key];
        const cost = lv < def.max ? def.cost[lv] : 0;
        wl.appendChild(mk(def, lv, cost, () => Save.upgradeWeapon(wid, def.key), !owned));
      });
      const pl = U.$id('plrUpgrades'); pl.innerHTML = '';
      DATA.PLAYER_UPGRADES.forEach(def => {
        const lv = Save.data.pUpg[def.key];
        const cost = lv < def.max ? def.cost[lv] : 0;
        pl.appendChild(mk(def, lv, cost, () => Save.upgradePlayer(def.key), false));
      });
    },

    /* ============================= SETTINGS ============================= */
    bindSettings() {
      const s = Save.data ? Save.data.settings : null;
      const sens = U.$id('setSens');
      sens.addEventListener('input', () => {
        Save.data.settings.sens = +sens.value;
        U.$id('setSensVal').textContent = sens.value;
        Input.sensitivity = +sens.value;
        Save.save();
      });
      const toggle = (id, key, apply) => {
        U.$id(id).addEventListener('click', () => {
          Snd.play('btn');
          const v = Save.data.settings[key] ? 0 : 1;
          Save.data.settings[key] = v; Save.save();
          this.refreshSettings();
          if (apply) apply(v);
        });
      };
      toggle('setSfx', 'sfx', v => Snd.setSfx(v));
      toggle('setBgm', 'bgm', v => Snd.setBgm(v));
      toggle('setShake', 'shake');
      toggle('setLefty', 'lefty', v => Input.setLefty(v));
      toggle('setAim', 'aim');
      U.$id('setSkin').addEventListener('click', () => {
        Snd.play('btn');
        const cur = Save.data.settings.skin === 'MIL' ? 'MIL' : 'POP';
        const next = cur === 'POP' ? 'MIL' : 'POP';
        Save.data.settings.skin = next;
        Save.save();
        Skin.apply(next);
        this.refreshSettings();
      });
      U.$id('setQuality').addEventListener('click', () => {
        Snd.play('btn');
        const order = ['AUTO', 'LOW', 'MID', 'HIGH'];
        const i = order.indexOf(Save.data.settings.quality);
        Save.data.settings.quality = order[(i + 1) % order.length];
        Save.save();
        Render.setQuality(Save.data.settings.quality);
        this.refreshSettings();
      });
      U.$id('setWipe').addEventListener('click', () => {
        if (!this._wipeArm) {
          this._wipeArm = true;
          U.$id('setWipe').textContent = '本当に削除？';
          Snd.play('dry');
          setTimeout(() => { this._wipeArm = false; U.$id('setWipe').textContent = 'DELETE'; }, 3000);
          return;
        }
        Save.wipe();
        this._wipeArm = false;
        this.applySettings();
        this.refreshSettings();
        this.refreshTitle();
        Snd.play('gameover');
      });
    },

    refreshSettings() {
      const s = Save.data.settings;
      U.$id('setSens').value = s.sens;
      U.$id('setSensVal').textContent = s.sens;
      const set = (id, on) => {
        const e = U.$id(id);
        e.setAttribute('data-on', on ? '1' : '0');
        e.textContent = on ? 'ON' : 'OFF';
      };
      set('setSfx', s.sfx); set('setBgm', s.bgm); set('setShake', s.shake);
      set('setLefty', s.lefty); set('setAim', s.aim);
      U.$id('setQuality').textContent = s.quality;
      U.$id('setSkin').textContent = Skin.get(s.skin).label;
      U.$id('setWipe').textContent = this._wipeArm ? '本当に削除？' : 'DELETE';
    },

    applySettings() {
      const s = Save.data.settings;
      Skin.apply(s.skin);
      Input.sensitivity = s.sens;
      Input.setLefty(s.lefty);
      Snd.setSfx(s.sfx); Snd.setBgm(s.bgm);
      Render.setQuality(s.quality);
    },

    /* ============================= IN-GAME HUD ============================= */
    enterGame(game) {
      this.showScreen('hud');
      this.feedEl.innerHTML = '';
      this.tutorial(null);
      this.setReload(null);
      this.dmgVig.style.opacity = 0;
      this.lowVig.classList.add('hidden');
      this.dirEl.innerHTML = '';
      this.setCompass(null);
      this.stageTag.textContent = (game.stage.custom ? 'CUSTOM' : 'STAGE ' + game.stage.id) + ' · ' + game.stage.name;
      this.bigMsg(game.stage.custom ? game.stage.name : 'STAGE ' + game.stage.id);
    },

    setHP(hp, max) {
      const r = U.clamp(hp / max, 0, 1);
      this.hp.style.width = (r * 100) + '%';
      this.hpLag.style.width = (r * 100) + '%';
      this.hpText.textContent = Math.ceil(hp);
      this.hp.classList.toggle('low', r < 0.3);
      this.lowVig.classList.toggle('hidden', r > 0.28);
    },
    setAmmo(mag, res, name) {
      this.magText.textContent = mag;
      this.resText.textContent = res;
      this.wpnName.textContent = name;
      this.magText.classList.toggle('empty', mag <= 0);
    },
    setKills(n) { this.killText.textContent = n; },
    setCoins(n) { this.coinText.textContent = n; },
    setTimer(t) { this.timerText.textContent = U.fmtTime(t); },
    setObjective(stage, remaining, total) {
      if (stage.objective === 'boss') {
        this.objText.textContent = 'TITAN-01 を撃破せよ';
        const b = Game.boss;
        this.objProgress.textContent = b
          ? 'BOSS HP ' + Math.max(0, Math.ceil(b.hp)) + ' / ' + b.maxHp
          : '';
      } else if (stage.objective === 'count') {
        this.objText.textContent = '敵を ' + stage.target + ' 体撃破せよ';
        this.objProgress.textContent = Math.min(Game.kills, stage.target) + ' / ' + stage.target;
      } else {
        this.objText.textContent = '敵を全滅させろ';
        this.objProgress.textContent = (total - remaining) + ' / ' + total;
      }
    },
    objectiveLabel(stage) {
      if (stage.objective === 'boss') return 'ボス「TITAN-01」を撃破';
      if (stage.objective === 'count') return '敵を ' + stage.target + ' 体撃破';
      return '敵を全滅させる';
    },
    setReload(p) {
      if (p == null) { this.reloadBar.classList.add('hidden'); return; }
      this.reloadBar.classList.remove('hidden');
      this.reloadFill.style.width = (U.clamp(p, 0, 1) * 100) + '%';
    },
    updateWeaponSlots(player) {
      this.slotsEl.innerHTML = '';
      player.weapons.forEach((w, i) => {
        const b = document.createElement('button');
        b.className = 'wslot' + (i === player.wIdx ? ' active' : '');
        b.innerHTML = '<span class="num">' + (i + 1) + '</span><span>' + w.base.short + '</span>';
        b.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          Game.switchWeapon(i);
        });
        this.slotsEl.appendChild(b);
      });
    },

    hitmarker(crit) {
      const h = this.hitmark;
      h.classList.toggle('crit', !!crit);
      h.classList.remove('show');
      void h.offsetWidth;
      h.classList.add('show');
    },
    critFx() {
      this.flashEl.style.transition = 'none';
      this.flashEl.style.opacity = 0.16;
      requestAnimationFrame(() => {
        this.flashEl.style.transition = 'opacity .2s';
        this.flashEl.style.opacity = 0;
      });
    },
    damageFlash(k) {
      this.dmgVig.style.opacity = U.clamp(k, 0, 1);
      clearTimeout(this._dmgT);
      this._dmgT = setTimeout(() => { this.dmgVig.style.opacity = 0; }, 220);
    },
    dirIndicator(relAng) {
      const d = document.createElement('div');
      d.className = 'dir-ind';
      d.style.transform = 'rotate(' + (relAng * 180 / Math.PI) + 'deg)';
      this.dirEl.appendChild(d);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 750);
    },
    feed(text, cls) {
      const d = document.createElement('div');
      d.className = cls || '';
      d.textContent = text;
      this.feedEl.appendChild(d);
      while (this.feedEl.children.length > 5) this.feedEl.removeChild(this.feedEl.firstChild);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2600);
    },
    bigMsg(text) {
      const e = this.bigMsgEl;
      e.textContent = text;
      e.classList.remove('show');
      void e.offsetWidth;
      e.classList.add('show');
    },
    tutorial(text) {
      if (!text) { this.tutEl.classList.add('hidden'); return; }
      this.tutEl.textContent = text;
      this.tutEl.classList.remove('hidden');
    },
    setCrosshairEnemy(on) { this.crosshair.classList.toggle('enemy', !!on); },
    setCompass(relAng, dist) {
      if (relAng == null) { this.compass.classList.add('hidden'); return; }
      this.compass.classList.remove('hidden');
      this.compass.style.transform = 'rotate(' + (relAng * 180 / Math.PI) + 'deg)';
      this.cmpDist.textContent = Math.round(dist) + 'm';
      this.cmpDist.style.transform = 'rotate(' + (-relAng * 180 / Math.PI) + 'deg)';
    },

    /* ============================= RESULT SCREENS ============================= */
    showClear(r) {
      const acc = Math.round(r.acc * 100);
      U.$id('rankBadge').textContent = r.rank;
      U.$id('rankBadge').className = 'rank-badge r' + r.rank;
      U.$id('clearStats').innerHTML =
        row('撃破数', r.kills + ' 体') +
        row('クリア時間', U.fmtTime(r.time)) +
        row('命中率', acc + ' %') +
        row('評価', '<b>' + r.rank + '</b>');
      U.$id('rewardLine').innerHTML =
        '獲得コイン <b>' + r.coins + '</b> + クリアボーナス <b>' + r.bonus + '</b> = <b>' + r.total + '◆</b>' +
        (r.newWeapon ? '<br><span style="color:#7fe3ff">新武器解放: ' + r.newWeapon.name + '</span>' : '');
      U.show(U.$id('btnNextStage'), r.hasNext);
      this.showScreen('clear');
      this.refreshTitle();
    },

    showOver(r) {
      U.$id('overStats').innerHTML =
        row('到達ステージ', r.stage.custom ? r.stage.name : 'STAGE ' + r.stage.id) +
        row('撃破数', r.kills + ' 体') +
        row('残存敵', r.remaining + ' 体') +
        row('生存時間', U.fmtTime(r.time));
      this.showScreen('over');
    }
  };

  function row(k, v) { return '<div class="rrow"><span>' + k + '</span><span>' + v + '</span></div>'; }

  g.UI = UI;
})(window);
