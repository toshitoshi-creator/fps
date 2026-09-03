/* ===== mapgen.js — 島型BRマップの生成 ======================================
 * 完全ランダムではなく「固定ランドマーク + ランダムな建物配置 + ランダムLoot」。
 * 毎回同じ地形の骨格だが、建物の形・入口・戦利品は毎試合変わる。
 *
 * タイル: 0=地面 1=建物壁 2=岩/木 3=コンテナ(遮蔽) 4=水(進入不可)
 * ========================================================================= */
(function (g) {
  'use strict';

  const WATER = 4, BUILD = 1, ROCK = 2, CRATE = 3;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 島のランドマーク。位置は固定、中身は毎回変わる */
  const LANDMARKS = [
    { key: 'city', name: 'CENTRAL CITY', jp: '中央市街', area: 'city', x: 0.50, y: 0.48, r: 13, buildings: 9, crates: 16 },
    { key: 'military', name: 'MILITARY BASE', jp: '軍事基地', area: 'military', x: 0.22, y: 0.24, r: 10, buildings: 5, crates: 20 },
    { key: 'industrial', name: 'INDUSTRIAL', jp: '工業地帯', area: 'industrial', x: 0.76, y: 0.27, r: 10, buildings: 5, crates: 22 },
    { key: 'harbor', name: 'HARBOR', jp: '港湾', area: 'harbor', x: 0.78, y: 0.74, r: 10, buildings: 4, crates: 24 },
    { key: 'village', name: 'VILLAGE', jp: '集落', area: 'village', x: 0.22, y: 0.74, r: 9, buildings: 6, crates: 8 },
    { key: 'forest', name: 'FOREST', jp: '森林', area: 'forest', x: 0.58, y: 0.66, r: 12, buildings: 1, crates: 4, trees: 90 },
    { key: 'mountain', name: 'ROCK RIDGE', jp: '岩稜', area: 'forest', x: 0.34, y: 0.50, r: 9, buildings: 0, crates: 4, rocks: 60 },
    { key: 'lake', name: 'LAKE', jp: '湖', area: 'field', x: 0.64, y: 0.36, r: 7, buildings: 1, crates: 3, lake: true }
  ];

  /**
   * @param {number} size  1辺のセル数
   * @param {number} seed
   * @returns {{w,h,grid,landmarks,lootSpots,spawnable,seed}}
   */
  function generate(size, seed) {
    size = size || 96;
    seed = seed >>> 0 || 12345;
    const rnd = mulberry32(seed);
    const w = size, h = size;
    const grid = new Uint8Array(w * h);
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) grid[y * w + x] = v; };
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? WATER : grid[y * w + x];

    /* --- 島の輪郭。円 + 低周波ノイズで自然な海岸線にする --- */
    const cx = w / 2, cy = h / 2;
    const baseR = w * 0.455;
    const lobes = [];
    for (let i = 0; i < 6; i++) lobes.push({ f: 1 + i, p: rnd() * Math.PI * 2, a: (0.055 - i * 0.006) });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        let rr = baseR;
        lobes.forEach(l => { rr += baseR * l.a * Math.sin(a * l.f + l.p); });
        if (d > rr) set(x, y, WATER);
      }
    }

    const landmarks = LANDMARKS.map(l => ({
      key: l.key, name: l.name, jp: l.jp, area: l.area,
      x: Math.round(l.x * w), y: Math.round(l.y * h), r: l.r, def: l
    }));

    /* --- 湖 --- */
    landmarks.filter(l => l.def.lake).forEach(l => {
      for (let y = l.y - l.r; y <= l.y + l.r; y++)
        for (let x = l.x - l.r; x <= l.x + l.r; x++) {
          const d = Math.hypot(x - l.x, y - l.y) + (rnd() - 0.5) * 2.0;
          if (d < l.r * 0.72) set(x, y, WATER);
        }
    });

    /* --- 建物。外周を壁で囲い、必ず入口を開ける --- */
    const lootSpots = [];
    const rects = [];
    function overlaps(r) {
      return rects.some(o => !(r.x + r.bw + 2 < o.x || o.x + o.bw + 2 < r.x ||
        r.y + r.bh + 2 < o.y || o.y + o.bh + 2 < r.y));
    }
    function placeBuilding(l) {
      for (let tries = 0; tries < 40; tries++) {
        const bw = 6 + ((rnd() * 7) | 0), bh = 5 + ((rnd() * 6) | 0);
        const ang = rnd() * Math.PI * 2, dist = rnd() * l.r;
        const bx = Math.round(l.x + Math.cos(ang) * dist - bw / 2);
        const by = Math.round(l.y + Math.sin(ang) * dist - bh / 2);
        if (bx < 2 || by < 2 || bx + bw > w - 2 || by + bh > h - 2) continue;
        // 建物予定地が水にかかっていないか
        let ok = true;
        for (let y = by - 1; y <= by + bh + 1 && ok; y++)
          for (let x = bx - 1; x <= bx + bw + 1; x++)
            if (at(x, y) === WATER) { ok = false; break; }
        if (!ok) continue;
        const r = { x: bx, y: by, bw, bh };
        if (overlaps(r)) continue;
        rects.push(r);

        // 壁
        for (let x = bx; x < bx + bw; x++) { set(x, by, BUILD); set(x, by + bh - 1, BUILD); }
        for (let y = by; y < by + bh; y++) { set(bx, y, BUILD); set(bx + bw - 1, y, BUILD); }
        // 入口（各辺のどこかに2マス）
        const doors = 1 + ((rnd() * 2) | 0);
        for (let d = 0; d < doors + 1; d++) {
          const side = (rnd() * 4) | 0;
          if (side === 0) { const px = bx + 1 + ((rnd() * (bw - 3)) | 0); set(px, by, 0); set(px + 1, by, 0); }
          else if (side === 1) { const px = bx + 1 + ((rnd() * (bw - 3)) | 0); set(px, by + bh - 1, 0); set(px + 1, by + bh - 1, 0); }
          else if (side === 2) { const py = by + 1 + ((rnd() * (bh - 3)) | 0); set(bx, py, 0); set(bx, py + 1, 0); }
          else { const py = by + 1 + ((rnd() * (bh - 3)) | 0); set(bx + bw - 1, py, 0); set(bx + bw - 1, py + 1, 0); }
        }
        // 内部の間仕切り（通り抜けられる隙間を必ず残す）
        if (bw >= 9 && rnd() < 0.6) {
          const mx = bx + 3 + ((rnd() * (bw - 6)) | 0);
          for (let y = by + 1; y < by + bh - 1; y++) set(mx, y, BUILD);
          const gap = by + 1 + ((rnd() * (bh - 3)) | 0);
          set(mx, gap, 0); set(mx, gap + 1, 0);
        }
        // 屋内のLoot
        const n = 2 + ((rnd() * 4) | 0);
        for (let i = 0; i < n; i++) {
          const lx = bx + 1 + ((rnd() * (bw - 2)) | 0);
          const ly = by + 1 + ((rnd() * (bh - 2)) | 0);
          if (at(lx, ly) === 0) lootSpots.push({ x: lx + 0.5, y: ly + 0.5, area: l.area, indoor: true });
        }
        return true;
      }
      return false;
    }

    landmarks.forEach(l => {
      for (let i = 0; i < (l.def.buildings || 0); i++) placeBuilding(l);
    });

    /* --- 木・岩・コンテナ --- */
    function scatter(l, count, tile) {
      for (let i = 0; i < count; i++) {
        const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * l.r;
        const x = Math.round(l.x + Math.cos(ang) * dist);
        const y = Math.round(l.y + Math.sin(ang) * dist);
        if (at(x, y) !== 0) continue;
        set(x, y, tile);
      }
    }
    landmarks.forEach(l => {
      if (l.def.trees) scatter(l, l.def.trees, ROCK);
      if (l.def.rocks) scatter(l, l.def.rocks, ROCK);
      if (l.def.crates) scatter(l, l.def.crates, CRATE);
    });

    /* --- 屋外のLoot --- */
    landmarks.forEach(l => {
      const n = Math.round(l.r * 1.1);
      for (let i = 0; i < n; i++) {
        const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * l.r;
        const x = Math.round(l.x + Math.cos(ang) * dist);
        const y = Math.round(l.y + Math.sin(ang) * dist);
        if (at(x, y) !== 0) continue;
        lootSpots.push({ x: x + 0.5, y: y + 0.5, area: l.area, indoor: false });
      }
    });
    // 島全体に散らばる野良Loot
    for (let i = 0; i < 70; i++) {
      const x = 2 + ((rnd() * (w - 4)) | 0), y = 2 + ((rnd() * (h - 4)) | 0);
      if (at(x, y) !== 0) continue;
      lootSpots.push({ x: x + 0.5, y: y + 0.5, area: 'field', indoor: false });
    }

    /* --- 到達性の検査。孤立した地面は水に沈めて「行けない場所」を無くす --- */
    const seen = new Uint8Array(w * h);
    const start = (Math.round(cy) * w + Math.round(cx));
    const q = [start];
    if (grid[start] === 0) seen[start] = 1; else {
      // 中心が塞がっていたら最寄りの地面から探索
      let found = -1;
      for (let r = 1; r < 30 && found < 0; r++) {
        for (let a = 0; a < 40 && found < 0; a++) {
          const ang = a / 40 * Math.PI * 2;
          const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
          if (at(x, y) === 0) found = y * w + x;
        }
      }
      q[0] = found; seen[found] = 1;
    }
    for (let head = 0; head < q.length; head++) {
      const c = q[head], px = c % w, py = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = px + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (grid[ni] !== 0 || seen[ni]) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    for (let i = 0; i < grid.length; i++) if (grid[i] === 0 && !seen[i]) grid[i] = WATER;

    // 到達できないLootを捨てる
    const reachable = lootSpots.filter(s => seen[(s.y | 0) * w + (s.x | 0)]);

    // 降下・湧きに使える地面（島の内側寄り）
    const spawnable = [];
    for (let y = 3; y < h - 3; y += 2) for (let x = 3; x < w - 3; x += 2) {
      const i = y * w + x;
      if (grid[i] !== 0 || !seen[i]) continue;
      if (Math.hypot(x - cx, y - cy) > baseR * 0.92) continue;
      spawnable.push({ x: x + 0.5, y: y + 0.5 });
    }

    return {
      w, h, grid, seed, landmarks, lootSpots: reachable, spawnable,
      walkable: q.length, center: { x: cx, y: cy }, baseR
    };
  }

  g.BRMap = { generate, LANDMARKS, WATER, BUILD, ROCK, CRATE };
})(window);
