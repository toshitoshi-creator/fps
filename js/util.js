/* ===== util.js — math / helpers ===== */
(function (g) {
  'use strict';

  const U = {
    TAU: Math.PI * 2,
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp(a, b, t) { return a + (b - a) * t; },
    rand(a, b) { return a + Math.random() * (b - a); },
    randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick(arr) { return arr[(Math.random() * arr.length) | 0]; },
    dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
    dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    // shortest signed angle difference a->b, result in (-PI, PI]
    angDiff(a, b) {
      let d = (b - a) % U.TAU;
      if (d > Math.PI) d -= U.TAU;
      if (d < -Math.PI) d += U.TAU;
      return d;
    },
    approachAngle(a, target, step) {
      const d = U.angDiff(a, target);
      if (Math.abs(d) <= step) return target;
      return a + Math.sign(d) * step;
    },
    fmtTime(sec) {
      sec = Math.max(0, sec | 0);
      const m = (sec / 60) | 0, s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    // gaussian-ish spread in [-1,1], centre weighted
    spreadRand() { return (Math.random() + Math.random() - 1); },
    $(sel) { return document.querySelector(sel); },
    $id(id) { return document.getElementById(id); },
    all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); },
    show(el, on) { if (el) el.classList.toggle('hidden', !on); },
    // simple object pool
    Pool(factory) {
      return {
        items: [],
        get() {
          for (let i = 0; i < this.items.length; i++) if (!this.items[i].alive) return this.items[i];
          const o = factory(); this.items.push(o); return o;
        },
        forEach(fn) { for (let i = 0; i < this.items.length; i++) if (this.items[i].alive) fn(this.items[i], i); },
        clear() { for (let i = 0; i < this.items.length; i++) this.items[i].alive = false; },
        count() { let n = 0; for (let i = 0; i < this.items.length; i++) if (this.items[i].alive) n++; return n; }
      };
    }
  };

  g.U = U;
})(window);
