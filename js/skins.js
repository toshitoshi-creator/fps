/* ===== skins.js — ビジュアルスキン（POP / MILITARY）の定義と切り替え ===================
 *
 * ステージ配色・敵の配色・壁テクスチャの描き方・UIのCSSをまとめて差し替える。
 * スキャンした実在の間取りは「グリッド状の抽象的な空間」になるため、
 * リアル寄りだと作りかけの3Dに見えてしまう。トイ的な表現にすると
 * 同じ形状でも「そういう世界」として成立する ―― それがPOPを既定にしている理由。
 * ================================================================================= */
(function (g) {
  'use strict';

  /* ---------------- MILITARY（初期版の配色。切り替え用に保持） ---------------- */
  const MIL = {
    id: 'MIL', label: 'MILITARY', bodyClass: '',
    spriteStyle: 'mil',
    floorGrid: false,
    stages: {
      1: { ceil: '#1c2f3d', ceil2: '#12202b', floor: '#33465a', floor2: '#1e2b38', fog: '#2a3d4d', walls: ['#5f7f94', '#4b6577', '#78896a', '#8a6350'] },
      2: { ceil: '#222c3d', ceil2: '#151d29', floor: '#3a4557', floor2: '#222932', fog: '#2b3546', walls: ['#6b7f96', '#57697f', '#8d7f56', '#9c6444'] },
      3: { ceil: '#16303a', ceil2: '#0e2129', floor: '#2c4750', floor2: '#1a2d34', fog: '#1f3d47', walls: ['#59939b', '#437078', '#7d9c72', '#8d7ba0'] },
      4: { ceil: '#2a2436', ceil2: '#171320', floor: '#3d3550', floor2: '#241e30', fog: '#241d33', walls: ['#7a6a9c', '#5a4d74', '#9c8a5a', '#8a5a6a'] },
      5: { ceil: '#2b231d', ceil2: '#1a1512', floor: '#443a32', floor2: '#26201b', fog: '#2c231c', walls: ['#8f7a5c', '#6a5a44', '#a06438', '#7a7a7a'] },
      6: { ceil: '#152622', ceil2: '#0d1815', floor: '#2a3f38', floor2: '#182722', fog: '#16261f', walls: ['#4f7a6a', '#3b5c50', '#7a8a52', '#8a6a4a'] },
      7: { ceil: '#2e1f1a', ceil2: '#1a110e', floor: '#4a3630', floor2: '#2a1e1a', fog: '#301c16', walls: ['#a06450', '#7a4a3a', '#b08040', '#6a6a7a'] },
      8: { ceil: '#1a2438', ceil2: '#101725', floor: '#2f3d55', floor2: '#1c2434', fog: '#1c2740', walls: ['#5a749c', '#43587a', '#9c8a4a', '#5a8a7a'] },
      9: { ceil: '#2a1a30', ceil2: '#180e1c', floor: '#3e2a46', floor2: '#241828', fog: '#2a1430', walls: ['#8a5a9c', '#66407a', '#9c5a6a', '#5a5a8a'] },
      10: { ceil: '#2b1a38', ceil2: '#1a0f24', floor: '#3a2c48', floor2: '#221a2c', fog: '#28143a', walls: ['#7a5aa0', '#563c74', '#a04570', '#6464a0'] },
      99: { ceil: '#1e2630', ceil2: '#131a22', floor: '#38424e', floor2: '#232a33', fog: '#2a333e', walls: ['#6f8091', '#59697a', '#7d8f6a', '#8a6a52'] }
    },
    enemies: {
      grunt: { main: '#54a06d', sec: '#356547', trim: '#b6ff8a', visor: '#9dff6a' },
      rusher: { main: '#b8484a', sec: '#7a2626', trim: '#ff9b7a', visor: '#ff6a55' },
      shooter: { main: '#4179ad', sec: '#274d75', trim: '#8ad8ff', visor: '#7de4ff' },
      heavy: { main: '#a2842c', sec: '#6a5418', trim: '#ffd76a', visor: '#ffe07a' },
      elite: { main: '#9c4a92', sec: '#68305f', trim: '#ff9be8', visor: '#ff7ae0' },
      boss: { main: '#6b45a0', sec: '#3e2360', trim: '#e39aff', visor: '#ff5fd8' }
    },
    weapons: { ar: '#7fe3ff', smg: '#9dffa8', br: '#c9a8ff', sg: '#ffb020', sr: '#ff7a7a', rl: '#ff9f4a' },
    fx: { blood: null, gib: ['#ffd24a', '#ff8a3a', '#ffffff'], impact: '#ffd9a0' }
  };

  /* ---------------- POP（既定） ---------------- */
  const POP = {
    id: 'POP', label: 'POP', bodyClass: 'pop',
    spriteStyle: 'pop',
    floorGrid: true,
    stages: {
      // ceil2 = 画面上端 / ceil = 地平線、floor2 = 地平線 / floor = 手前
      1: { ceil: '#cfefff', ceil2: '#5ec8ff', floor: '#52c98d', floor2: '#bdf0d8', fog: '#e6f7ff', walls: ['#ff9f4a', '#ffd23f', '#6ec8ff', '#ff7a9c'] },
      2: { ceil: '#ffe1ef', ceil2: '#ff9ec4', floor: '#ffab73', floor2: '#ffe0cd', fog: '#fff0f6', walls: ['#7c6bff', '#ff5f8f', '#ffd23f', '#4ad4c4'] },
      3: { ceil: '#d9d3ff', ceil2: '#7a6bff', floor: '#58b8ff', floor2: '#d3ecff', fog: '#efeaff', walls: ['#ff5fa8', '#4ad4c4', '#ffd23f', '#a06bff'] },
      4: { ceil: '#ffdcc4', ceil2: '#ff7a5c', floor: '#7c8cff', floor2: '#d5daff', fog: '#ffe9dd', walls: ['#ffd23f', '#ff5f7a', '#4ad4c4', '#7c6bff'] },
      5: { ceil: '#ffe9c2', ceil2: '#ffb84d', floor: '#f09a4a', floor2: '#ffe6c4', fog: '#fff3e0', walls: ['#e0603c', '#b5794a', '#ffd23f', '#5fb0e0'] },
      6: { ceil: '#d4fff0', ceil2: '#3fd8b0', floor: '#8ad46a', floor2: '#dcf7cd', fog: '#e4fff7', walls: ['#3f9f8a', '#ffd23f', '#ff8f6a', '#7c9fff'] },
      7: { ceil: '#ffe4d4', ceil2: '#ff8f5c', floor: '#ff9f7a', floor2: '#ffe0d0', fog: '#fff0e8', walls: ['#e04f6a', '#ffd23f', '#4ad4c4', '#a06bff'] },
      8: { ceil: '#d6ecff', ceil2: '#4fa8ff', floor: '#5fd0c0', floor2: '#cdf2ec', fog: '#e8f6ff', walls: ['#ffd23f', '#ff5f8f', '#4f8fe0', '#8ad46a'] },
      9: { ceil: '#f0d4ff', ceil2: '#b45fff', floor: '#c47aff', floor2: '#ecd8ff', fog: '#f7ebff', walls: ['#ff4fa8', '#ffd23f', '#5aa8ff', '#7a3fd0'] },
      10: { ceil: '#d5b8ff', ceil2: '#6a3fd0', floor: '#9b6bff', floor2: '#e6d4ff', fog: '#f0e4ff', walls: ['#ff4fa8', '#ffd23f', '#6ac8ff', '#9a5fe0'] },
      99: { ceil: '#d8f0ff', ceil2: '#6ec8ff', floor: '#6cc9c0', floor2: '#cdeeea', fog: '#eaf8ff', walls: ['#ff8f6a', '#ffd23f', '#7c9fff', '#69d68f'] }
    },
    enemies: {
      grunt: { main: '#4fd48a', sec: '#2fae6b', trim: '#d4ff8f', visor: '#ffffff' },
      rusher: { main: '#ff5f7a', sec: '#d63a58', trim: '#ffd23f', visor: '#ffffff' },
      shooter: { main: '#5aa8ff', sec: '#3a7ad6', trim: '#c7e9ff', visor: '#ffffff' },
      heavy: { main: '#ffa33f', sec: '#d97a1f', trim: '#ffe08f', visor: '#ffffff' },
      elite: { main: '#e05fd6', sec: '#a03a96', trim: '#ffd23f', visor: '#ffffff' },
      boss: { main: '#b45fff', sec: '#7a3fd0', trim: '#ffd23f', visor: '#ffffff' }
    },
    weapons: { ar: '#4ad4c4', smg: '#a8ff6a', br: '#c9a8ff', sg: '#ffd23f', sr: '#ff5f9e', rl: '#ff9f4a' },
    fx: { blood: null, gib: ['#ffd23f', '#ff5f9e', '#4ad4c4', '#ffffff'], impact: '#fff3b0' }
  };

  const SKINS = { POP, MIL };

  const Skin = {
    current: POP,
    list: ['POP', 'MIL'],

    get(name) { return SKINS[name] || POP; },

    /** ステージ・敵・武器の配色を一括で差し替え、キャッシュを捨てる */
    apply(name) {
      const s = this.get(name);
      this.current = s;

      DATA.STAGES.forEach(st => {
        const t = s.stages[st.id];
        if (t) st.theme = Object.assign({}, t);
      });
      Object.keys(s.enemies).forEach(k => {
        if (DATA.ENEMIES[k]) DATA.ENEMIES[k].palette = Object.assign({}, s.enemies[k]);
      });
      DATA.WEAPONS.forEach(w => { if (s.weapons[w.id]) w.color = s.weapons[w.id]; });

      if (g.Sprites) {
        Sprites.style = s.spriteStyle;
        Sprites.fx = s.fx;
        Sprites.clearCache();
      }
      if (g.Render) {
        Render.floorGrid = !!s.floorGrid;
        if (Render.theme && Game && Game.stage) Render.setStage(Game.stage.theme);
      }
      document.body.classList.toggle('pop', s.bodyClass === 'pop');
      return s;
    },

    /** カスタムステージが後から入ってきた時に配色を当てる */
    themeFor(stageId) {
      return this.current.stages[stageId] || this.current.stages[99];
    }
  };

  g.SKINS = SKINS;
  g.Skin = Skin;
})(window);
