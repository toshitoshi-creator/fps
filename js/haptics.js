/* ===== haptics.js — 触覚フィードバック =========================================
 * Vibration API (navigator.vibrate) を使う。
 * 注意: iOS Safari は Vibration API を実装していないため iPhone では鳴らない。
 * Android Chrome / ホーム画面に追加した PWA では動作する。
 * 未対応環境でもゲームの進行には一切影響しない設計にしてある。
 * ========================================================================== */
(function (g) {
  'use strict';

  const PATTERNS = {
    hit: 8,
    crit: [10, 18, 14],
    shoot: 6,
    shootHeavy: 16,
    reload: [6, 40, 6],
    hurt: 28,
    kill: [12, 24, 18],
    boss: [40, 60, 40, 60, 90],
    ui: 4,
    clear: [20, 60, 20, 60, 40],
    over: [60, 80, 120]
  };

  const Haptics = {
    enabled: true,
    supported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
    _last: 0,

    setEnabled(on) { this.enabled = !!on; },

    /** 短い触覚。連射時に鳴らしすぎないよう最小間隔を設ける */
    tap(kind) {
      if (!this.enabled || !this.supported) return false;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const light = kind === 'hit' || kind === 'shoot' || kind === 'ui';
      if (light && now - this._last < 45) return false;
      this._last = now;
      const p = PATTERNS[kind];
      if (p == null) return false;
      try { navigator.vibrate(p); return true; } catch (e) { return false; }
    },

    stop() { if (this.supported) { try { navigator.vibrate(0); } catch (e) { } } }
  };

  g.Haptics = Haptics;
})(window);
