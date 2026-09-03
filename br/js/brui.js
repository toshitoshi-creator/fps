/* ===== brui.js — 画面とHUD ==================================================
 * BR の状態を読んで描くだけ。UIからゲームロジックを直接書き換えない。
 * ========================================================================= */
(function (g) {
  'use strict';

  const SCREENS = ['hud', 'dropScreen', 'mapScreen', 'bagScreen', 'lobbyScreen',
    'statsScreen', 'missionScreen', 'settingsScreen', 'resultScreen'];

  const BRUI = {
    el: {}, marker: null, mapZoom: 1,

    init() {
      SCREENS.forEach(id => { this.el[id] = U.$id(id); });
      const ids = ['hpNum', 'hpFill', 'apFill', 'gearArmor', 'gearHelm', 'aliveNum',
        'zoneLabel', 'zoneFill', 'zoneTimer', 'minimap', 'crosshair', 'hitmark',
        'scopeOverlay', 'dirIndicators', 'bigMsg', 'killFeed', 'feed', 'lootPrompt',
        'lootName', 'wpnName', 'magText', 'resText', 'reloadBar', 'reloadFill',
        'useBar', 'useFill', 'useLabel', 'wpnSlots', 'dropMap', 'dropPhase', 'dropInfo',
        'altNum', 'btnDrop', 'chuteTag', 'bigMap', 'bagBody', 'lvNum', 'lvXp', 'lvFill',
        'lobbyFoot', 'statsBody', 'missionBody', 'placeBadge', 'resultTitle',
        'resultSub', 'resultStats', 'resultXp', 'dmgVignette', 'zoneVignette',
        'compassNeedle', 'tutorial', 'loading', 'rotate'];
      ids.forEach(id => { this.el[id] = U.$id(id); });
      this.mini = this.el.minimap.getContext('2d');
      this._feedT = [];
      return this;
    },

    show(name) {
      SCREENS.forEach(id => U.show(this.el[id], false));
      if (name === 'hud' || name === 'mapScreen' || name === 'bagScreen' || name === 'resultScreen') {
        U.show(this.el.hud, true);
      }
      if (name === 'dropScreen') U.show(this.el.hud, true);
      U.show(this.el[name], true);
      this.cur = name;
      if (name === 'lobbyScreen') this.refreshLobby();
      if (name === 'statsScreen') this.refreshStats();
      if (name === 'missionScreen') this.refreshMissions();
      if (name === 'settingsScreen') this.refreshSettings();
    },

    /* =============== HUD =============== */
    syncHud(br) {
      const p = br.player;
      if (!p) return;
      const hpR = U.clamp(p.hp / p.maxHp, 0, 1);
      this.el.hpNum.textContent = Math.ceil(Math.max(0, p.hp));
      this.el.hpFill.style.width = (hpR * 100) + '%';
      this.el.hpFill.classList.toggle('low', hpR < 0.32);
      this.el.apFill.style.width = (p.armorMax ? U.clamp(p.armor / p.armorMax, 0, 1) * 100 : 0) + '%';
      const alv = p.armorMax >= 120 ? 3 : (p.armorMax >= 80 ? 2 : (p.armorMax > 0 ? 1 : 0));
      this.el.gearArmor.textContent = 'AR ' + (alv || '—');
      this.el.gearArmor.classList.toggle('off', !alv);
      this.el.gearHelm.textContent = 'HE ' + (p.helmet || '—');
      this.el.gearHelm.classList.toggle('off', !p.helmet);
      this.el.aliveNum.textContent = br.aliveCount;

      const w = p.weapons[p.wIdx];
      this.el.wpnName.textContent = w ? w.def.name : '素手';
      this.el.magText.textContent = w ? w.mag : '—';
      this.el.magText.classList.toggle('empty', !!w && w.mag <= 0);
      this.el.resText.textContent = w ? (p.ammo[w.def.ammo] || 0) : '—';

      U.show(this.el.reloadBar, p.reloading);
      if (p.reloading) this.el.reloadFill.style.width = ((1 - p.reloadLeft / p.reloadTotal) * 100) + '%';
      U.show(this.el.useBar, p.useT > 0);
      if (p.useT > 0 && p.useItem) {
        const def = BRDATA.ITEMS[p.useItem];
        this.el.useLabel.textContent = def ? def.name : 'USING';
        this.el.useFill.style.width = ((1 - p.useT / def.useTime) * 100) + '%';
      }

      // 武器スロット
      const key = p.weapons.map(x => x ? x.def.id : '-').join(',') + ':' + p.wIdx;
      if (key !== this._slotKey) {
        this._slotKey = key;
        this.el.wpnSlots.innerHTML = p.weapons.map((x, i) =>
          '<button class="wslot' + (i === p.wIdx ? ' active' : '') + '" data-slot="' + i + '">' +
          '<span class="num">' + (i + 1) + '</span><span>' + (x ? x.def.short : '空') + '</span></button>').join('');
      }

      // Zone
      const z = br.zone;
      if (z) {
        const ph = BRDATA.ZONE_PHASES[z.phase];
        this.el.zoneLabel.textContent = z.done ? 'FINAL ZONE'
          : 'PHASE ' + (z.phase + 1) + (z.shrinking ? ' — 縮小中' : ' — 待機');
        this.el.zoneLabel.classList.toggle('warn', z.shrinking);
        this.el.zoneTimer.textContent = z.done ? '--' : U.fmtTime(Math.max(0, z.timer));
        const tot = z.shrinking ? (ph ? ph.shrink : 1) : (ph ? ph.wait : 1);
        this.el.zoneFill.style.width = U.clamp(1 - z.timer / tot, 0, 1) * 100 + '%';
        const out = !br.inZone(p);
        this.el.zoneVignette.style.opacity = out ? 0.55 : 0;
      }

      // 拾得プロンプト
      const l = p.state === 'ground' ? br.lootNear(p, 1.9) : null;
      U.show(this.el.lootPrompt, !!l);
      if (l) this.el.lootName.textContent = l.name + (l.count > 1 ? ' x' + l.count : '');

      // スコープ
      const scoped = br.zoomT > 0.7 && w && (w.def.zoom || 1) > 1.5;
      U.show(this.el.scopeOverlay, scoped);
      document.body.classList.toggle('scoped', !!scoped);
      U.show(this.el.crosshair, !scoped && p.state === 'ground');

      this.drawMinimap(br);
      this.syncKillFeed(br);
    },

    syncKillFeed(br) {
      const key = br.killFeed.map(k => k.killer + k.victim).join('|');
      if (key === this._kfKey) return;
      this._kfKey = key;
      this.el.killFeed.innerHTML = br.killFeed.map(k =>
        '<div class="' + (k.byPlayer ? 'mine' : (k.victimPlayer ? 'me' : '')) + '">' +
        '<b>' + k.killer + '</b> ▸ ' + k.victim + '</div>').join('');
    },

    feed(text, cls) {
      const d = document.createElement('div');
      d.className = cls || '';
      d.textContent = text;
      this.el.feed.appendChild(d);
      while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.firstChild);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2600);
    },

    bigMsg(t) {
      const e = this.el.bigMsg;
      e.textContent = t;
      e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
    },

    hitmark(head) {
      const h = this.el.hitmark;
      h.classList.toggle('crit', !!head);
      h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
    },

    damageFlash(k) {
      this.el.dmgVignette.style.opacity = U.clamp(k, 0, 1);
      clearTimeout(this._dmgT);
      this._dmgT = setTimeout(() => { this.el.dmgVignette.style.opacity = 0; }, 220);
    },

    dirIndicator(rel) {
      const d = document.createElement('div');
      d.className = 'dir-ind';
      d.style.transform = 'rotate(' + (rel * 180 / Math.PI) + 'deg)';
      this.el.dirIndicators.appendChild(d);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 800);
    },

    tutorial(t) {
      if (!t) { this.el.tutorial.classList.add('hidden'); return; }
      this.el.tutorial.textContent = t;
      this.el.tutorial.classList.remove('hidden');
    },

    /* =============== ミニマップ =============== */
    drawMinimap(br) {
      const cv = this.el.minimap, x = this.mini;
      const W = cv.width, H = cv.height;
      const p = br.player, m = br.map, z = br.zone;
      const view = 30;                       // 表示する半径(m)
      const s = W / (view * 2);
      x.clearRect(0, 0, W, H);
      x.fillStyle = '#0b1219'; x.fillRect(0, 0, W, H);

      x.save();
      x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 1, 0, 7); x.clip();
      // 地形
      const x0 = Math.floor(p.x - view), x1 = Math.ceil(p.x + view);
      const y0 = Math.floor(p.y - view), y1 = Math.ceil(p.y + view);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) continue;
        const t = m.grid[cy * m.w + cx];
        if (!t) continue;
        x.fillStyle = t === BRMap.WATER ? '#123049' : (t === BRMap.ROCK ? '#2f4432' : '#3b4654');
        x.fillRect(W / 2 + (cx - p.x) * s, H / 2 + (cy - p.y) * s, s + 0.6, s + 0.6);
      }
      // 安全地帯
      if (z) {
        x.strokeStyle = '#7fe3ff'; x.lineWidth = 2;
        x.beginPath(); x.arc(W / 2 + (z.cx - p.x) * s, H / 2 + (z.cy - p.y) * s, z.r * s, 0, 7); x.stroke();
        if (z.shrinking || z.nextR < z.r) {
          x.strokeStyle = '#ffffff'; x.lineWidth = 1.4; x.setLineDash([4, 4]);
          x.beginPath(); x.arc(W / 2 + (z.nextCx - p.x) * s, H / 2 + (z.nextCy - p.y) * s, z.nextR * s, 0, 7); x.stroke();
          x.setLineDash([]);
        }
      }
      // 直近の銃声（敵位置の一時表示）
      (br._gunPings || []).forEach(g2 => {
        if (g2.t <= 0) return;
        x.globalAlpha = U.clamp(g2.t, 0, 1) * 0.9;
        x.fillStyle = '#ff5f7a';
        x.beginPath(); x.arc(W / 2 + (g2.x - p.x) * s, H / 2 + (g2.y - p.y) * s, 3, 0, 7); x.fill();
        x.globalAlpha = 1;
      });
      // マーカー
      if (this.marker) {
        x.fillStyle = '#ffd23f';
        x.beginPath(); x.arc(W / 2 + (this.marker.x - p.x) * s, H / 2 + (this.marker.y - p.y) * s, 3.5, 0, 7); x.fill();
      }
      x.restore();

      // 自分
      x.save();
      x.translate(W / 2, H / 2); x.rotate(p.ang + Math.PI / 2);
      x.fillStyle = '#4dff9a';
      x.beginPath(); x.moveTo(0, -6); x.lineTo(4.5, 5); x.lineTo(0, 2.5); x.lineTo(-4.5, 5); x.closePath(); x.fill();
      x.restore();
      x.strokeStyle = 'rgba(127,227,255,.45)'; x.lineWidth = 2;
      x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 1, 0, 7); x.stroke();

      // 安全地帯の方向
      if (z) {
        const a = Math.atan2(z.cy - p.y, z.cx - p.x) - p.ang;
        this.el.compassNeedle.style.transform = 'rotate(' + (a * 180 / Math.PI + 90) + 'deg)';
        U.show(this.el.compassNeedle, !br.inZone(p));
      }
    },

    /* =============== 全体マップ / 降下マップ =============== */
    drawWorldMap(cv, br, opt) {
      opt = opt || {};
      const x = cv.getContext('2d');
      const m = br.map;
      const W = cv.width, H = cv.height;
      const s = Math.min(W, H) / m.w;
      const ox = (W - m.w * s) / 2, oy = (H - m.h * s) / 2;
      x.fillStyle = '#0a1622'; x.fillRect(0, 0, W, H);
      // 地形
      const img = this._mapCache && this._mapCache.seed === br.seed ? this._mapCache.cv : null;
      if (!img) {
        const c2 = document.createElement('canvas');
        c2.width = m.w; c2.height = m.h;
        const g2 = c2.getContext('2d');
        const id = g2.createImageData(m.w, m.h);
        for (let i = 0; i < m.grid.length; i++) {
          const t = m.grid[i];
          let r, gg, b;
          if (t === BRMap.WATER) { r = 18; gg = 48; b = 74; }
          else if (t === BRMap.BUILD) { r = 96; gg = 108; b = 124; }
          else if (t === BRMap.ROCK) { r = 46; gg = 72; b = 52; }
          else if (t === BRMap.CRATE) { r = 120; gg = 96; b = 56; }
          else { r = 44; gg = 72; b = 58; }
          id.data[i * 4] = r; id.data[i * 4 + 1] = gg; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255;
        }
        g2.putImageData(id, 0, 0);
        this._mapCache = { seed: br.seed, cv: c2 };
      }
      x.imageSmoothingEnabled = false;
      x.drawImage(this._mapCache.cv, ox, oy, m.w * s, m.h * s);

      // ランドマーク名
      x.font = 'bold ' + Math.max(8, s * 1.6) + 'px sans-serif';
      x.textAlign = 'center';
      m.landmarks.forEach(l => {
        x.fillStyle = 'rgba(255,255,255,.30)';
        x.beginPath(); x.arc(ox + l.x * s, oy + l.y * s, l.r * s, 0, 7); x.stroke();
        x.fillStyle = 'rgba(230,245,255,.85)';
        x.fillText(l.name, ox + l.x * s, oy + (l.y - l.r * 0.35) * s);
      });

      // Zone
      const z = br.zone;
      if (z) {
        x.strokeStyle = '#7fe3ff'; x.lineWidth = 2;
        x.beginPath(); x.arc(ox + z.cx * s, oy + z.cy * s, z.r * s, 0, 7); x.stroke();
        x.strokeStyle = '#ffffff'; x.lineWidth = 1.5; x.setLineDash([5, 5]);
        x.beginPath(); x.arc(ox + z.nextCx * s, oy + z.nextCy * s, z.nextR * s, 0, 7); x.stroke();
        x.setLineDash([]);
      }
      // 輸送機の航路
      if (opt.plane && br.plane) {
        const pl = br.plane;
        x.strokeStyle = 'rgba(255,210,63,.55)'; x.lineWidth = 2; x.setLineDash([8, 6]);
        x.beginPath();
        x.moveTo(ox + (pl.x - pl.dx * m.w) * s, oy + (pl.y - pl.dy * m.w) * s);
        x.lineTo(ox + (pl.x + pl.dx * m.w) * s, oy + (pl.y + pl.dy * m.w) * s);
        x.stroke(); x.setLineDash([]);
        x.save();
        x.translate(ox + pl.x * s, oy + pl.y * s);
        x.rotate(Math.atan2(pl.dy, pl.dx));
        x.fillStyle = '#ffd23f';
        x.beginPath(); x.moveTo(10, 0); x.lineTo(-7, 6); x.lineTo(-4, 0); x.lineTo(-7, -6); x.closePath(); x.fill();
        x.restore();
      }
      // マーカー
      if (this.marker) {
        x.fillStyle = '#ffd23f';
        x.beginPath(); x.arc(ox + this.marker.x * s, oy + this.marker.y * s, 5, 0, 7); x.fill();
        x.strokeStyle = '#1b2233'; x.lineWidth = 1.5; x.stroke();
      }
      // 自分
      const p = br.player;
      x.save();
      x.translate(ox + p.x * s, oy + p.y * s);
      x.rotate(p.ang + Math.PI / 2);
      x.fillStyle = '#4dff9a';
      x.beginPath(); x.moveTo(0, -8); x.lineTo(5.5, 6); x.lineTo(0, 3); x.lineTo(-5.5, 6); x.closePath(); x.fill();
      x.restore();
      return { ox, oy, s };
    },

    syncDrop(br) {
      const cv = this.el.dropMap;
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(200, r.width | 0); cv.height = Math.max(200, r.height | 0);
      this._dropXf = this.drawWorldMap(cv, br, { plane: true });
      const p = br.player;
      this.el.altNum.textContent = Math.round(p.z);
      const inPlane = p.state === 'plane';
      this.el.dropPhase.textContent = inPlane ? 'TRANSPORT' : (p.chute ? 'PARACHUTE' : 'FREEFALL');
      this.el.dropInfo.textContent = inPlane ? '降下地点を選んで DROP'
        : (p.chute ? '左スティックで滑空。着地地点を調整' : '自由落下中。パラシュートは自動展開');
      U.show(this.el.btnDrop, inPlane);
      U.show(this.el.chuteTag, !inPlane && p.chute);
    },

    /* =============== インベントリ =============== */
    refreshBag(br) {
      const p = br.player, dd = BRDATA;
      const wep = p.weapons.map((w, i) =>
        '<div class="bag-slot' + (i === p.wIdx ? ' on' : '') + '" data-wslot="' + i + '">' +
        '<div class="bs-lab">武器' + (i + 1) + '</div>' +
        (w ? '<div class="bs-name">' + w.def.name + '</div><div class="bs-sub">' + w.def.cls +
          ' · ' + w.mag + '/' + w.magMax + ' · ' + dd.AMMO[w.def.ammo].name + '</div>'
          : '<div class="bs-name dim">空きスロット</div>') + '</div>').join('');
      const ammo = Object.keys(p.ammo).map(a =>
        '<div class="bag-chip"><b>' + p.ammo[a] + '</b>' + dd.AMMO[a].name + '</div>').join('');
      const items = Object.keys(p.items).filter(k => p.items[k] > 0).map(k =>
        '<button class="bag-chip use" data-use="' + k + '"><b>' + p.items[k] + '</b>' + dd.ITEMS[k].name + '</button>').join('')
        || '<div class="bag-chip dim">所持なし</div>';
      const alv = p.armorMax >= 120 ? 3 : (p.armorMax >= 80 ? 2 : (p.armorMax > 0 ? 1 : 0));
      this.el.bagBody.innerHTML =
        '<div class="bag-grid">' + wep + '</div>' +
        '<div class="bag-h">防具</div><div class="bag-row">' +
        '<div class="bag-chip">' + (alv ? 'アーマー Lv' + alv + ' (' + Math.ceil(p.armor) + '/' + p.armorMax + ')' : 'アーマーなし') + '</div>' +
        '<div class="bag-chip">' + (p.helmet ? 'ヘルメット Lv' + p.helmet : 'ヘルメットなし') + '</div></div>' +
        '<div class="bag-h">弾薬</div><div class="bag-row">' + ammo + '</div>' +
        '<div class="bag-h">アイテム（タップで使用）</div><div class="bag-row">' + items + '</div>';
    },

    /* =============== ロビー / 戦績 / ミッション =============== */
    refreshLobby() {
      const d = BRSave.data, lv = BRSave.levelInfo();
      this.el.lvNum.textContent = 'LV ' + lv.level + (lv.max ? ' MAX' : '');
      this.el.lvXp.textContent = lv.max ? 'MAX' : (lv.xp + ' / ' + lv.need + ' XP');
      this.el.lvFill.style.width = (lv.ratio * 100) + '%';
      const s = d.stats;
      this.el.lobbyFoot.textContent =
        '試合 ' + s.matches + ' · 勝利 ' + s.wins + ' · キル ' + s.kills + ' · ◆ ' + d.coins;
    },

    refreshStats() {
      const s = BRSave.data.stats;
      const row = (k, v) => '<div class="srow"><span>' + k + '</span><b>' + v + '</b></div>';
      const kd = s.matches ? (s.kills / s.matches).toFixed(2) : '0.00';
      this.el.statsBody.innerHTML =
        row('試合数', s.matches) + row('勝利数', s.wins) +
        row('勝率', s.matches ? Math.round(s.wins / s.matches * 100) + ' %' : '0 %') +
        row('TOP10率', s.matches ? Math.round(s.top10 / s.matches * 100) + ' %' : '0 %') +
        row('合計キル', s.kills) + row('平均キル', kd) +
        row('最高キル', s.bestKills) +
        row('最高順位', s.bestPlace === 99 ? '—' : '#' + s.bestPlace) +
        row('合計ダメージ', Math.round(s.damage)) +
        row('ヘッドショット', s.headshots) +
        row('合計生存時間', U.fmtTime(s.survived));
    },

    refreshMissions() {
      const ms = BRSave.data.missions || [];
      this.el.missionBody.innerHTML = ms.map(m => {
        const pct = U.clamp(m.prog / m.goal, 0, 1) * 100;
        return '<div class="mrow">' +
          '<div class="minfo"><div class="mtext">' + m.text + '</div>' +
          '<div class="mbar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="msub">' + Math.min(m.prog, m.goal) + ' / ' + m.goal +
          '　報酬 ' + m.xp + ' XP · ' + m.coin + '◆</div></div>' +
          '<button class="mbtn2' + (m.claimed ? ' done' : (m.done ? '' : ' lock')) + '" data-claim="' + m.id + '">' +
          (m.claimed ? '受取済' : (m.done ? '受け取る' : '進行中')) + '</button></div>';
      }).join('') || '<div class="mrow">ミッションがありません</div>';
    },

    refreshSettings() {
      const s = BRSave.data.settings;
      const set = (id, v) => { const e = U.$id(id); if (e) e.value = v; };
      const txt = (id, v) => { const e = U.$id(id); if (e) e.textContent = v; };
      set('setSens', s.sens); txt('setSensVal', s.sens);
      set('setAdsSens', s.adsSens); txt('setAdsSensVal', s.adsSens);
      set('setGyroSens', s.gyroSens); txt('setGyroSensVal', s.gyroSens);
      set('setBtn', s.btnScale); txt('setBtnVal', s.btnScale);
      set('setOpacity', s.btnOpacity); txt('setOpacityVal', s.btnOpacity);
      set('setBots', s.bots); txt('setBotsVal', s.bots);
      txt('setAim', s.aim); txt('setGyro', s.gyro); txt('setQuality', s.quality);
      const tg = (id, on) => {
        const e = U.$id(id); if (!e) return;
        e.setAttribute('data-on', on ? '1' : '0');
        e.textContent = on ? 'ON' : 'OFF';
      };
      tg('setAuto', s.autoPick); tg('setSfx', s.sfx); tg('setBgm', s.bgm);
      tg('setVib', s.vibrate); tg('setLefty', s.lefty);
      if (!Haptics.supported) { const e = U.$id('setVib'); e.textContent = '非対応'; e.setAttribute('data-on', '0'); }
      U.$id('setGyro').setAttribute('data-on', s.gyro === 'OFF' ? '0' : '1');
      U.$id('setAim').setAttribute('data-on', s.aim === 'OFF' ? '0' : '1');
    },

    showResult(br, won, reward) {
      const st = br.stats;
      this.el.placeBadge.textContent = '#' + st.placement;
      this.el.placeBadge.className = 'place-badge' + (won ? ' win' : '');
      this.el.resultTitle.textContent = won ? 'VICTORY' : 'ELIMINATED';
      this.el.resultTitle.className = 'result-title' + (won ? ' win' : '');
      this.el.resultSub.textContent = won ? 'LAST ONE STANDING'
        : (st.placement + ' / ' + (br.combatants.length) + ' 位');
      const row = (k, v) => '<div class="rrow"><span>' + k + '</span><b>' + v + '</b></div>';
      this.el.resultStats.innerHTML =
        row('順位', '#' + st.placement + ' / ' + br.combatants.length) +
        row('キル', st.kills) +
        row('与ダメージ', Math.round(st.damage)) +
        row('ヘッドショット', st.headshots) +
        row('生存時間', U.fmtTime(st.survived)) +
        row('取得アイテム', st.lootPicked);
      const lv = BRSave.levelInfo();
      this.el.resultXp.innerHTML =
        '<b>+' + reward.xp + ' XP</b>　<b>+' + reward.coins + '◆</b>' +
        (reward.levelUp ? '<br><span class="lvup">LEVEL UP! → LV ' + lv.level + '</span>' : '');
      this.show('resultScreen');
    }
  };

  g.BRUI = BRUI;
})(window);
