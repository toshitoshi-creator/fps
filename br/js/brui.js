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
      const ids = ['hpNum', 'hpFill', 'apFill', 'gearArmor', 'gearHelm', 'aliveNum', 'killNum',
        'zoneLabel', 'zoneFill', 'zoneTimer', 'zoneRunner', 'minimap', 'compass', 'crosshair', 'redDot', 'hitmark',
        'scopeOverlay', 'dirIndicators', 'bigMsg', 'killFeed', 'feed', 'lootPrompt', 'lootIco', 'lootMore',
        'lootName', 'wpnName', 'magText', 'resText', 'reloadBar', 'reloadFill',
        'useBar', 'useFill', 'useLabel', 'wpnSlots', 'dropMap', 'dropPhase', 'dropInfo',
        'altNum', 'altFill', 'btnDrop', 'chuteTag', 'bigMap', 'bagBody', 'lvNum', 'lvXp', 'lvFill',
        'lobbyFoot', 'lobbyCoins', 'lobbyView', 'statsBody', 'missionBody', 'placeBadge', 'resultTitle',
        'resultSub', 'resultStats', 'resultXp', 'dmgVignette', 'zoneVignette',
        'compassNeedle', 'tutorial', 'loading', 'rotate', 'itemCnt', 'fragCnt', 'viewLbl', 'btnItem', 'btnThrow'];
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
      document.body.classList.toggle('dropping', name === 'dropScreen');
      U.show(this.el[name], true);
      this.cur = name;
      if (name === 'lobbyScreen') this.refreshLobby();
      if (name === 'statsScreen') this.refreshStats();
      if (name === 'missionScreen') this.refreshMissions();
      if (name === 'settingsScreen') this.refreshSettings();
    },

    /* =============== HUD =============== */
    _set(el, key, v) {
      // 同じ値なら DOM を触らない（毎フレームの再描画を抑える）
      if (el['_' + key] === v) return;
      el['_' + key] = v;
      if (key === 'text') el.textContent = v;
      else if (key === 'w') el.style.width = v;
      else if (key === 'html') el.innerHTML = v;
    },
    armorLevel(p) { return p.armorMax >= 120 ? 3 : (p.armorMax >= 80 ? 2 : (p.armorMax > 0 ? 1 : 0)); },

    syncHud(br) {
      const p = br.player;
      if (!p) return;
      const E = this.el;
      const hpR = U.clamp(p.hp / p.maxHp, 0, 1);
      this._set(E.hpNum, 'text', '' + Math.ceil(Math.max(0, p.hp)));
      this._set(E.hpFill, 'w', (hpR * 100).toFixed(1) + '%');
      E.hpFill.classList.toggle('low', hpR < 0.32);
      document.body.classList.toggle('lowhp', hpR < 0.3 && p.alive && p.state === 'ground');
      this._set(E.apFill, 'w', (p.armorMax ? U.clamp(p.armor / p.armorMax, 0, 1) * 100 : 0).toFixed(1) + '%');
      const alv = this.armorLevel(p);
      this._set(E.gearArmor.querySelector('b'), 'text', alv ? 'Lv' + alv : '—');
      E.gearArmor.className = 'gear-pill' + (alv ? ' l' + alv : ' off');
      this._set(E.gearHelm.querySelector('b'), 'text', p.helmet ? 'Lv' + p.helmet : '—');
      E.gearHelm.className = 'gear-pill' + (p.helmet ? ' l' + p.helmet : ' off');
      this._set(E.aliveNum, 'text', '' + br.aliveCount);
      this._set(E.killNum, 'text', '' + (br.stats ? br.stats.kills : 0));

      const w = p.weapons[p.wIdx];
      this._set(E.wpnName, 'text', w ? w.def.name + ' · ' + ({ auto: 'AUTO', semi: 'SINGLE', burst: 'BURST' }[w.def.fireMode] || '') : '素手');
      this._set(E.magText, 'text', w ? '' + w.mag : '—');
      E.magText.classList.toggle('empty', !!w && w.mag <= 0);
      this._set(E.resText, 'text', w ? '' + (p.ammo[w.def.ammo] || 0) : '—');
      Input.setNeedReload(!!w && w.mag <= Math.ceil(w.magMax * 0.2) && (p.ammo[w.def.ammo] || 0) > 0 && !p.reloading);

      U.show(E.reloadBar, p.reloading);
      if (p.reloading) E.reloadFill.style.width = ((1 - p.reloadLeft / p.reloadTotal) * 100) + '%';
      U.show(E.useBar, p.useT > 0);
      if (p.useT > 0 && p.useItem) {
        const def = BRDATA.ITEMS[p.useItem];
        this._set(E.useLabel, 'text', def ? def.name : 'USING');
        E.useFill.style.width = ((1 - p.useT / def.useTime) * 100) + '%';
      }
      // 回復・投擲の所持数
      const heals = (p.items.bandage || 0) + (p.items.medkit || 0) + (p.items.energy || 0);
      this._set(E.itemCnt, 'text', '' + heals);
      E.btnItem.classList.toggle('empty', heals <= 0);
      this._set(E.fragCnt, 'text', '' + (p.items.frag || 0));
      E.btnThrow.classList.toggle('empty', !(p.items.frag > 0));
      if (E.viewLbl) this._set(E.viewLbl, 'text', (g.GL3D && GL3D.view) || 'FPP');

      // 武器スロット
      const key = p.weapons.map(x => x ? x.def.id + x.mag : '-').join(',') + ':' + p.wIdx;
      if (key !== this._slotKey) {
        this._slotKey = key;
        E.wpnSlots.innerHTML = p.weapons.map((x, i) =>
          '<button class="wslot' + (i === p.wIdx ? ' active' : '') + '" data-slot="' + i + '">' +
          '<span class="num">' + (i + 1) + '</span><span class="wn">' + (x ? x.def.short : '—') + '</span>' +
          '<span class="wa">' + (x ? x.mag : '') + '</span></button>').join('');
      }

      // Zone
      const z = br.zone;
      if (z) {
        const ph = BRDATA.ZONE_PHASES[z.phase];
        this._set(E.zoneLabel, 'text', z.done ? 'FINAL ZONE'
          : 'PHASE ' + (z.phase + 1) + (z.shrinking ? ' 縮小中' : ' 待機'));
        E.zoneLabel.classList.toggle('warn', z.shrinking);
        this._set(E.zoneTimer, 'text', z.done ? '--' : U.fmtTime(Math.max(0, z.timer)));
        const tot = z.shrinking ? (ph ? ph.shrink : 1) : (ph ? ph.wait : 1);
        E.zoneFill.style.width = U.clamp(1 - z.timer / tot, 0, 1) * 100 + '%';
        // 走る人の目印: 安全地帯の端までの近さ（中なら右端）
        const d = U.dist(p.x, p.y, z.nextCx, z.nextCy) - z.nextR;
        E.zoneRunner.style.left = (U.clamp(1 - d / 60, 0, 1) * 96) + '%';
        const out = !br.inZone(p);
        E.zoneVignette.style.opacity = out && p.state === 'ground' ? 0.55 : 0;
      }

      // 拾えるもの（近い順に最大4つ）
      this.syncLoot(br);

      // スコープ / ドットサイト
      const ads = br.zoomT > 0.7 && !!w;
      const scoped = ads && (w.def.zoom || 1) > 1.5;
      U.show(E.scopeOverlay, scoped);
      document.body.classList.toggle('scoped', !!scoped);
      const glOn = g.GL3D && GL3D.active;
      U.show(E.redDot, ads && !scoped && glOn && p.state === 'ground');
      U.show(E.crosshair, !scoped && !(ads && glOn) && p.state === 'ground');
      // 移動・連射でクロスヘアが広がる
      const spread = (p.moving ? 1.35 : 1) * (1 + Math.min(1, (p.recoilVis || 0) * 0.25));
      const ck = spread.toFixed(2);
      if (E.crosshair._k !== ck) { E.crosshair._k = ck; E.crosshair.style.transform = 'scale(' + ck + ')'; }

      this.drawMinimap(br);
      this.drawCompass(br);
      this.syncKillFeed(br);
    },

    syncLoot(br) {
      const p = br.player, E = this.el;
      const list = [];
      if (p.state === 'ground') {
        const r2 = 1.9 * 1.9;
        for (let i = 0; i < br.loot.length; i++) {
          const l = br.loot[i];
          if (!l.alive) continue;
          const d = U.dist2(l.x, l.y, p.x, p.y);
          if (d < r2) list.push({ l, d });
        }
        list.sort((a, b) => a.d - b.d);
      }
      const first = list.length ? list[0].l : null;
      U.show(E.lootPrompt, !!first);
      const rar = t => (BRDATA.RARITY[t] || BRDATA.RARITY.common).color;
      const ico = l => {
        const it = BRDATA.ITEMS[l.id];
        const k = l.kind === 'weapon' || l.kind === 'ammo' ? 'bullet'
          : (it && it.kind === 'armor' ? 'vest' : (it && it.kind === 'helmet' ? 'helm' : (l.id === 'frag' ? 'frag' : 'heal')));
        return '<svg><use href="#i-' + k + '"/></svg>';
      };
      if (first) {
        this._set(E.lootName, 'text', first.name + (first.count > 1 ? ' ×' + first.count : ''));
        this._set(E.lootIco, 'html', ico(first));
        E.lootPrompt.style.setProperty('--rar', rar(first.tier));
      }
      const more = list.slice(1, 4);
      const key = more.map(o => o.l.name + o.l.count).join('|');
      if (key !== this._lootKey) {
        this._lootKey = key;
        this._lootRows = more.map(o => o.l);
        E.lootMore.innerHTML = more.map((o, i) =>
          '<button class="loot-row" data-loot="' + i + '" style="--rar:' + rar(o.l.tier) + '">' +
          '<span class="lp-ico">' + ico(o.l) + '</span><span class="lp-name">' + o.l.name + (o.l.count > 1 ? ' ×' + o.l.count : '') +
          '</span><span class="lp-key">拾う</span></button>').join('');
      }
    },

    syncKillFeed(br) {
      const key = br.killFeed.map(k => k.killer + k.victim).join('|');
      if (key === this._kfKey) return;
      this._kfKey = key;
      this.el.killFeed.innerHTML = br.killFeed.map(k =>
        '<div class="' + (k.byPlayer ? 'mine' : (k.victimPlayer ? 'me' : '')) + '">' +
        '<b>' + k.killer + '</b> <span class="kw">' + (k.weapon || '✚') + '</span> ' + k.victim + '</div>').join('');
    },

    feed(text, cls) {
      const d = document.createElement('div');
      d.className = cls || '';
      d.textContent = text;
      this.el.feed.appendChild(d);
      while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.firstChild);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2600);
    },

    /** 撃破のお知らせ（画面中央の下）。何人目か・相手・武器 */
    killBanner(name, weapon, kills) {
      const e = this.el.killBanner || (this.el.killBanner = U.$id('killBanner'));
      if (!e) return;
      e.innerHTML = '<span class="kb-n">' + kills + '</span><span class="kb-t">KILL</span>' +
        '<span class="kb-v"><b>' + name + '</b> を倒した' + (weapon ? '<small>' + weapon + '</small>' : '') + '</span>';
      e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
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

    /* =============== 3D描画の上に重ねる文字（ダメージ数値） =============== */
    clearOverlay() {
      const o = this._ovl || (this._ovl = U.$id('ovl'));
      if (!o || !this._ovlDirty) return;
      o.getContext('2d').clearRect(0, 0, o.width, o.height);
      this._ovlDirty = false;
    },
    drawOverlay(br) {
      const o = this._ovl || (this._ovl = U.$id('ovl'));
      if (!o) return;
      // 描く物が無いフレームは、前に描いた物を1度消すだけにする
      const markerOn = this.marker && br.player && br.player.state === 'ground';
      if (!br.dmgNums.length && !markerOn) { this.clearOverlay(); return; }
      const x = o.getContext('2d');
      x.clearRect(0, 0, o.width, o.height);
      this._ovlDirty = true;
      const k = o.width / (o.clientWidth || 1);
      x.save();
      x.scale(k, k);
      x.textAlign = 'center';
      x.lineJoin = 'round';
      br.dmgNums.forEach(d => {
        const p = GL3D.project(d.x, d.y, d.z + d.rise * 0.35);
        if (!p) return;
        const a = U.clamp(d.life / d.maxLife, 0, 1);
        const size = U.clamp(34 / Math.max(1, p.w * 0.35), 13, 24) * (d.crit ? 1.15 : 1);
        x.globalAlpha = Math.min(1, a * 1.6);
        x.font = '700 ' + size.toFixed(0) + 'px "Roboto Condensed","Bahnschrift",system-ui,sans-serif';
        x.lineWidth = 3;
        x.strokeStyle = 'rgba(0,0,0,.7)';
        x.strokeText(d.text, p.x, p.y);
        x.fillStyle = d.crit ? '#ffd24a' : '#ffffff';
        x.fillText(d.text, p.x, p.y);
      });
      // 目的地マーカー（世界の中に黄色い印）
      if (this.marker && br.player && br.player.state === 'ground') {
        const m = GL3D.project(this.marker.x, this.marker.y, 1.2);
        if (m) {
          const dist = Math.round(U.dist(br.player.x, br.player.y, this.marker.x, this.marker.y) * 1.85);
          x.globalAlpha = 0.9;
          x.fillStyle = '#f2a900';
          x.beginPath(); x.moveTo(m.x, m.y); x.lineTo(m.x - 6, m.y - 10); x.lineTo(m.x + 6, m.y - 10); x.closePath(); x.fill();
          x.font = '700 10px "Roboto Condensed",system-ui,sans-serif';
          x.fillStyle = '#fff';
          x.fillText(dist + 'm', m.x, m.y - 14);
        }
      }
      x.restore();
    },

    tutorial(t) {
      if (!t) { this.el.tutorial.classList.add('hidden'); return; }
      this.el.tutorial.textContent = t;
      this.el.tutorial.classList.remove('hidden');
    },

    /* =============== 方位計 =============== */
    drawCompass(br) {
      const cv = this.el.compass;
      if (!cv) return;
      const p = br.player;
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(60, Math.round(r.width * dpr)), H = Math.max(20, Math.round(r.height * dpr));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const x = cv.getContext('2d');
      x.clearRect(0, 0, W, H);
      // 方位（北=0、時計回り）。画面上の北はマップの -y 方向
      const head = ((p.ang + Math.PI / 2) * 180 / Math.PI % 360 + 360) % 360;
      const span = 110;                     // 画面に見せる角度
      const pxPerDeg = W / span;
      const grad = x.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.15, 'rgba(0,0,0,.28)');
      grad.addColorStop(0.85, 'rgba(0,0,0,.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grad; x.fillRect(0, 0, W, H * 0.62);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      for (let d = Math.floor((head - span / 2) / 5) * 5; d <= head + span / 2; d += 5) {
        const px = W / 2 + (d - head) * pxPerDeg;
        const dd = ((d % 360) + 360) % 360;
        const edge = 1 - Math.abs(px - W / 2) / (W / 2);
        x.globalAlpha = U.clamp(edge * 1.6, 0, 1);
        x.fillStyle = '#fff';
        if (dd % 15 === 0) {
          const nm = NAMES[dd];
          x.font = (nm ? '700 ' : '400 ') + Math.round((nm ? 12 : 10) * dpr) + 'px "Roboto Condensed",system-ui,sans-serif';
          x.fillStyle = nm === 'N' ? '#f2a900' : '#fff';
          x.fillText(nm || String(dd), px, H * 0.30);
          x.fillRect(px - 0.5 * dpr, H * 0.52, 1 * dpr, H * 0.12);
        } else {
          x.fillRect(px - 0.5 * dpr, H * 0.54, 1 * dpr, H * 0.07);
        }
      }
      x.globalAlpha = 1;
      // 中央の現在方位
      x.fillStyle = '#fff';
      x.beginPath(); x.moveTo(W / 2, H * 0.66); x.lineTo(W / 2 - 4 * dpr, H * 0.78); x.lineTo(W / 2 + 4 * dpr, H * 0.78); x.closePath(); x.fill();
      x.font = '700 ' + Math.round(11 * dpr) + 'px "Roboto Condensed",system-ui,sans-serif';
      x.fillText(String(Math.round(head) % 360), W / 2, H * 0.90);
      // 目印（マーカー: 黄 / 銃声: 赤 / 安全地帯の中心: 青）
      const mark = (wx, wy, col, size) => {
        const b = ((Math.atan2(wy - p.y, wx - p.x) + Math.PI / 2) * 180 / Math.PI % 360 + 360) % 360;
        let dd = b - head; if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
        if (Math.abs(dd) > span / 2) return;
        const px = W / 2 + dd * pxPerDeg;
        x.fillStyle = col;
        x.beginPath(); x.arc(px, H * 0.60, size * dpr, 0, 7); x.fill();
      };
      if (this.marker) mark(this.marker.x, this.marker.y, '#f2a900', 3.5);
      (br._gunPings || []).forEach(g2 => { if (g2.t > 0) mark(g2.x, g2.y, 'rgba(255,60,50,' + U.clamp(g2.t, 0, 1) + ')', 3); });
      if (br.zone && !br.inZone(p)) mark(br.zone.nextCx, br.zone.nextCy, '#6fb4ff', 3);
    },

    /* =============== ミニマップ（北が上・正方形） =============== */
    _mapImg(br) {
      if (g.GL3D && GL3D.active && GL3D.mapCanvas && GL3D.mapSeed === br.seed) return GL3D.mapCanvas;
      if (this._mapCache && this._mapCache.seed === br.seed) return this._mapCache.cv;
      const m = br.map;
      const c2 = document.createElement('canvas');
      c2.width = m.w; c2.height = m.h;
      const g2 = c2.getContext('2d');
      const id = g2.createImageData(m.w, m.h);
      for (let i = 0; i < m.grid.length; i++) {
        const t = m.grid[i];
        let r, gg, b;
        if (t === BRMap.WATER) { r = 40; gg = 88; b = 110; }
        else if (t === BRMap.BUILD) { r = 150; gg = 150; b = 146; }
        else if (t === BRMap.ROCK) { r = 46; gg = 72; b = 44; }
        else if (t === BRMap.CRATE) { r = 140; gg = 110; b = 70; }
        else { r = 92; gg = 118; b = 64; }
        id.data[i * 4] = r; id.data[i * 4 + 1] = gg; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255;
      }
      g2.putImageData(id, 0, 0);
      this._mapCache = { seed: br.seed, cv: c2 };
      return c2;
    },

    drawMinimap(br) {
      const cv = this.el.minimap, x = this.mini;
      const W = cv.width, H = cv.height;
      const p = br.player, m = br.map, z = br.zone;
      if (!m) return;
      const view = 26;                       // 表示する半径（セル）
      const s = W / (view * 2);
      const img = this._mapImg(br);
      x.save();
      x.fillStyle = '#2a4450'; x.fillRect(0, 0, W, H);
      const k = img.width / m.w;
      const sx = (p.x - view) * k, sy = (p.y - view) * k;
      x.imageSmoothingEnabled = true;
      x.drawImage(img, sx, sy, view * 2 * k, view * 2 * k, 0, 0, W, H);
      const X = wx => W / 2 + (wx - p.x) * s, Y = wy => H / 2 + (wy - p.y) * s;
      // 安全地帯（外側を青く塗る）
      if (z) {
        x.fillStyle = 'rgba(40,80,200,.28)';
        x.beginPath(); x.rect(0, 0, W, H); x.arc(X(z.cx), Y(z.cy), z.r * s, 0, 7, true); x.fill();
        x.strokeStyle = '#4aa3ff'; x.lineWidth = 2;
        x.beginPath(); x.arc(X(z.cx), Y(z.cy), z.r * s, 0, 7); x.stroke();
        x.strokeStyle = '#ffffff'; x.lineWidth = 1.6;
        x.beginPath(); x.arc(X(z.nextCx), Y(z.nextCy), z.nextR * s, 0, 7); x.stroke();
        if (!br.inZone(p)) {
          // 安全地帯までの道筋（白い点線）
          const a = Math.atan2(z.nextCy - p.y, z.nextCx - p.x);
          const d = Math.max(0, U.dist(p.x, p.y, z.nextCx, z.nextCy) - z.nextR);
          x.setLineDash([4, 4]); x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 1.4;
          x.beginPath(); x.moveTo(W / 2, H / 2); x.lineTo(W / 2 + Math.cos(a) * d * s, H / 2 + Math.sin(a) * d * s); x.stroke();
          x.setLineDash([]);
        }
      }
      // 銃声
      (br._gunPings || []).forEach(g2 => {
        if (g2.t <= 0) return;
        x.globalAlpha = U.clamp(g2.t, 0, 1);
        x.fillStyle = '#ff3b30';
        x.beginPath(); x.arc(X(g2.x), Y(g2.y), 4, 0, 7); x.fill();
        x.globalAlpha = 1;
      });
      // マーカー
      if (this.marker) {
        const mx = U.clamp(X(this.marker.x), 6, W - 6), my = U.clamp(Y(this.marker.y), 10, H - 2);
        x.fillStyle = '#f2a900';
        x.beginPath(); x.moveTo(mx, my); x.lineTo(mx - 5, my - 9); x.lineTo(mx + 5, my - 9); x.closePath(); x.fill();
      }
      // 自分（視野の扇 + 矢印）
      x.translate(W / 2, H / 2);
      x.rotate(p.ang);
      const fan = x.createRadialGradient(0, 0, 0, 0, 0, W * 0.42);
      fan.addColorStop(0, 'rgba(255,255,255,.35)'); fan.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = fan;
      x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, W * 0.42, -0.55, 0.55); x.closePath(); x.fill();
      x.rotate(Math.PI / 2);
      x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, -8); x.lineTo(6, 6); x.lineTo(0, 3); x.lineTo(-6, 6); x.closePath(); x.fill(); x.stroke();
      x.restore();

      // 安全地帯の方向
      if (z) {
        const a = Math.atan2(z.nextCy - p.y, z.nextCx - p.x);
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
      x.fillStyle = '#2a4450'; x.fillRect(0, 0, W, H);
      x.imageSmoothingEnabled = true;
      x.drawImage(this._mapImg(br), ox, oy, m.w * s, m.h * s);

      // グリッド（A〜H / 1〜8）
      if (!opt.small) {
        x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1;
        x.fillStyle = 'rgba(255,255,255,.7)';
        x.font = '700 ' + Math.max(9, s * 1.5) + 'px "Roboto Condensed",system-ui,sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const N = 8, step = m.w / N;
        for (let i = 0; i <= N; i++) {
          x.beginPath(); x.moveTo(ox + i * step * s, oy); x.lineTo(ox + i * step * s, oy + m.h * s); x.stroke();
          x.beginPath(); x.moveTo(ox, oy + i * step * s); x.lineTo(ox + m.w * s, oy + i * step * s); x.stroke();
          if (i < N) {
            x.fillText('ABCDEFGH'[i], ox + (i + 0.5) * step * s, oy + 8);
            x.fillText(String(i + 1), ox + 7, oy + (i + 0.5) * step * s);
          }
        }
      }
      // 地名
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '700 ' + Math.max(8, s * (opt.small ? 1.2 : 1.6)) + 'px "Roboto Condensed",system-ui,sans-serif';
      m.landmarks.forEach(l => {
        x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.55)';
        x.strokeText(l.name, ox + l.x * s, oy + (l.y - l.r * 0.2) * s);
        x.fillStyle = 'rgba(255,255,255,.95)';
        x.fillText(l.name, ox + l.x * s, oy + (l.y - l.r * 0.2) * s);
      });

      // Zone
      const z = br.zone;
      if (z) {
        x.fillStyle = 'rgba(40,80,200,.25)';
        x.beginPath(); x.rect(ox, oy, m.w * s, m.h * s); x.arc(ox + z.cx * s, oy + z.cy * s, z.r * s, 0, 7, true); x.fill();
        x.strokeStyle = '#4aa3ff'; x.lineWidth = 2;
        x.beginPath(); x.arc(ox + z.cx * s, oy + z.cy * s, z.r * s, 0, 7); x.stroke();
        x.strokeStyle = '#ffffff'; x.lineWidth = 1.6;
        x.beginPath(); x.arc(ox + z.nextCx * s, oy + z.nextCy * s, z.nextR * s, 0, 7); x.stroke();
      }
      // 輸送機の航路
      if (opt.plane && br.plane) {
        const pl = br.plane;
        x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1.5; x.setLineDash([6, 5]);
        x.beginPath();
        x.moveTo(ox + (pl.x - pl.dx * m.w * 1.5) * s, oy + (pl.y - pl.dy * m.w * 1.5) * s);
        x.lineTo(ox + (pl.x + pl.dx * m.w * 1.5) * s, oy + (pl.y + pl.dy * m.w * 1.5) * s);
        x.stroke(); x.setLineDash([]);
        if (!pl.done) {
          x.save();
          x.translate(ox + pl.x * s, oy + pl.y * s);
          x.rotate(Math.atan2(pl.dy, pl.dx) + Math.PI / 2);
          x.fillStyle = '#f2a900';
          x.beginPath(); x.moveTo(0, -9); x.lineTo(7, 5); x.lineTo(0, 2); x.lineTo(-7, 5); x.closePath(); x.fill();
          x.restore();
        }
      }
      // マーカー
      if (this.marker) {
        const mx = ox + this.marker.x * s, my = oy + this.marker.y * s;
        x.fillStyle = '#f2a900'; x.strokeStyle = '#111'; x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(mx, my); x.lineTo(mx - 6, my - 11); x.lineTo(mx + 6, my - 11); x.closePath(); x.fill(); x.stroke();
      }
      // 自分
      const p = br.player;
      if (p.state !== 'plane') {
        x.save();
        x.translate(ox + p.x * s, oy + p.y * s);
        x.rotate(p.ang + Math.PI / 2);
        x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(0, -8); x.lineTo(6, 6); x.lineTo(0, 3); x.lineTo(-6, 6); x.closePath(); x.fill(); x.stroke();
        x.restore();
      }
      return { ox, oy, s };
    },

    syncDrop(br) {
      const cv = this.el.dropMap;
      const r = cv.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(120, (r.width * d) | 0), h = Math.max(120, (r.height * d) | 0);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      this._dropXf = this.drawWorldMap(cv, br, { plane: true, small: true });
      const p = br.player;
      this.el.altNum.textContent = Math.round(p.z);
      if (this.el.altFill) this.el.altFill.style.height = U.clamp(p.z / BRDATA.MATCH.planeAlt, 0, 1) * 100 + '%';
      const inPlane = p.state === 'plane';
      const env = g.GL3D && GL3D.active && GL3D.env ? ' · ' + GL3D.env.name : '';
      this.el.dropPhase.textContent = (inPlane ? 'TRANSPORT' : (p.chute ? 'PARACHUTE' : 'FREEFALL')) + env;
      this.el.dropInfo.textContent = inPlane ? (this.marker ? '目的地の近くで DROP' : 'マップをタップして目的地を決め、DROP')
        : (p.chute ? '左スティックで滑空。着地地点を調整' : '自由落下中 — パラシュートは自動で開きます');
      U.show(this.el.btnDrop, inPlane);
      U.show(this.el.chuteTag, !inPlane && p.chute);
    },

    /* =============== インベントリ =============== */
    refreshBag(br) {
      const p = br.player, dd = BRDATA;
      const rar = t => (dd.RARITY[t] || dd.RARITY.common).color;
      const wep = p.weapons.map((w, i) =>
        '<div class="bag-slot' + (i === p.wIdx ? ' on' : '') + '" data-wslot="' + i + '" style="--rar:' + (w ? rar(w.def.tier) : '#555') + '">' +
        '<div class="bs-lab">SLOT ' + (i + 1) + (w ? ' · ' + dd.RARITY[w.def.tier].name : '') + '</div>' +
        (w ? '<div class="bs-name">' + w.def.name + '</div><div class="bs-sub">' + w.def.cls +
          ' · ' + w.mag + '/' + w.magMax + ' · ' + dd.AMMO[w.def.ammo].name + ' · DMG ' + w.def.damage + '</div>'
          : '<div class="bs-name dim">空きスロット</div>') + '</div>').join('');
      const ammo = Object.keys(p.ammo).map(a =>
        '<div class="bag-chip"><b>' + p.ammo[a] + '</b>' + dd.AMMO[a].name + '</div>').join('');
      const items = Object.keys(p.items).filter(k => p.items[k] > 0).map(k =>
        '<button class="bag-chip use" data-use="' + k + '"><b>' + p.items[k] + '</b>' + dd.ITEMS[k].name + '</button>').join('')
        || '<div class="bag-chip dim">所持なし</div>';
      const alv = this.armorLevel(p);
      this.el.bagBody.innerHTML =
        '<div class="bag-grid">' + wep + '</div>' +
        '<div class="bag-h">EQUIPMENT</div><div class="bag-row">' +
        '<div class="bag-chip">' + (alv ? 'ベスト Lv' + alv + ' (' + Math.ceil(p.armor) + '/' + p.armorMax + ')' : 'ベストなし') + '</div>' +
        '<div class="bag-chip">' + (p.helmet ? 'ヘルメット Lv' + p.helmet : 'ヘルメットなし') + '</div></div>' +
        '<div class="bag-h">AMMO</div><div class="bag-row">' + ammo + '</div>' +
        '<div class="bag-h">ITEMS（タップで使用）</div><div class="bag-row">' + items + '</div>';
    },

    /* =============== ロビー / 戦績 / ミッション =============== */
    refreshLobby() {
      const d = BRSave.data, lv = BRSave.levelInfo();
      this.el.lvNum.textContent = 'LV ' + lv.level + (lv.max ? ' MAX' : '');
      this.el.lvXp.textContent = lv.max ? 'MAX' : (lv.xp + ' / ' + lv.need + ' XP');
      this.el.lvFill.style.width = (lv.ratio * 100) + '%';
      const s = d.stats;
      this.el.lobbyFoot.textContent =
        '試合 ' + s.matches + ' · 勝利 ' + s.wins + ' · キル ' + s.kills;
      if (this.el.lobbyCoins) this.el.lobbyCoins.textContent = '◆ ' + d.coins;
      if (this.el.lobbyView) this.el.lobbyView.textContent = d.settings.view === 'FPP' ? 'FPP' : 'TPP';
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
      txt('setView', s.view === 'FPP' ? 'FPP（一人称）' : 'TPP（三人称）');
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
