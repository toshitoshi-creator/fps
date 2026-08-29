/* ===== input.js — virtual stick / look drag / action buttons / keyboard ===== */
(function (g) {
  'use strict';

  const Input = {
    move: { x: 0, y: 0 },      // -1..1  (x=strafe, y=forward)
    look: { dx: 0, dy: 0 },    // consumed each frame (radians accumulated as px)
    fire: false,
    sprint: false,
    crouch: false,
    sensitivity: 120,
    lefty: false,
    onReload: null, onSwitch: null, onSelectWeapon: null,
    _stickId: null, _lookId: null,
    _stickOx: 0, _stickOy: 0,
    _els: {},
    _enabled: false,
    _keys: {},
    _mouseLook: false,

    init() {
      const $ = U.$id;
      this._els = {
        moveZone: $('moveZone'), lookZone: $('lookZone'),
        base: $('stickBase'), knob: $('stickKnob'),
        fire: $('btnFire'), reload: $('btnReload'), sw: $('btnSwitch'),
        sprint: $('btnSprint'), crouch: $('btnCrouch')
      };
      this._bindZone(this._els.moveZone, 'stick');
      this._bindZone(this._els.lookZone, 'look');
      this._bindButtons();
      this._bindKeys();
      // block default gestures
      ['contextmenu', 'gesturestart', 'gesturechange'].forEach(ev =>
        document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
      document.addEventListener('touchmove', e => {
        if (e.touches.length > 1) e.preventDefault();
      }, { passive: false });
      return this;
    },

    setEnabled(on) {
      this._enabled = !!on;
      if (!on) this.reset();
    },
    reset() {
      this.move.x = this.move.y = 0;
      this.look.dx = this.look.dy = 0;
      this.fire = false; this.sprint = false;
      this._btnFire = false; this._mouseFire = false; this._btnSprint = false;
      this._stickId = this._lookId = null;
      if (this._els.base) this._els.base.classList.add('hidden');
      if (this._els.fire) this._els.fire.classList.remove('pressed');
      if (this._els.sprint) this._els.sprint.classList.remove('pressed');
      this._keys = {};
    },

    /* ---- zones ---- */
    _bindZone(el, kind) {
      if (!el) return;
      const self = this;
      el.addEventListener('pointerdown', function (e) {
        if (!self._enabled) return;
        e.preventDefault();
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        if (kind === 'stick') {
          if (self._stickId !== null) return;
          self._stickId = e.pointerId;
          const r = el.getBoundingClientRect();
          self._stickOx = e.clientX; self._stickOy = e.clientY;
          const b = self._els.base;
          b.classList.remove('hidden');
          b.style.left = (e.clientX - r.left) + 'px';
          b.style.top = (e.clientY - r.top) + 'px';
          self._els.knob.style.transform = 'translate(0,0)';
        } else {
          if (self._lookId !== null) return;
          self._lookId = e.pointerId;
          self._lookLx = e.clientX; self._lookLy = e.clientY;
          self._lookMoved = 0;
        }
      }, { passive: false });

      el.addEventListener('pointermove', function (e) {
        if (!self._enabled) return;
        if (kind === 'stick' && e.pointerId === self._stickId) {
          e.preventDefault();
          const dx = e.clientX - self._stickOx, dy = e.clientY - self._stickOy;
          const max = 52;
          const len = Math.hypot(dx, dy);
          const k = len > max ? max / len : 1;
          const kx = dx * k, ky = dy * k;
          self._els.knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
          const dead = 8;
          if (len < dead) { self.move.x = 0; self.move.y = 0; }
          else {
            const nx = kx / max, ny = ky / max;
            self.move.x = U.clamp(nx * 1.25, -1, 1);
            self.move.y = U.clamp(-ny * 1.25, -1, 1);
          }
        } else if (kind === 'look' && e.pointerId === self._lookId) {
          e.preventDefault();
          const dx = e.clientX - self._lookLx, dy = e.clientY - self._lookLy;
          self._lookLx = e.clientX; self._lookLy = e.clientY;
          self._lookMoved += Math.abs(dx) + Math.abs(dy);
          self.look.dx += dx; self.look.dy += dy;
        }
      }, { passive: false });

      const end = function (e) {
        if (kind === 'stick' && e.pointerId === self._stickId) {
          self._stickId = null; self.move.x = 0; self.move.y = 0;
          self._els.base.classList.add('hidden');
        } else if (kind === 'look' && e.pointerId === self._lookId) {
          self._lookId = null;
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    },

    /* ---- action buttons ---- */
    _bindButtons() {
      const self = this;
      const hold = (el, on, off) => {
        if (!el) return;
        const down = e => {
          e.preventDefault(); e.stopPropagation();
          el.classList.add('pressed');
          try { el.setPointerCapture(e.pointerId); } catch (err) { }
          on();
        };
        const up = e => {
          e.preventDefault(); e.stopPropagation();
          el.classList.remove('pressed');
          if (off) off();
        };
        el.addEventListener('pointerdown', down, { passive: false });
        el.addEventListener('pointerup', up, { passive: false });
        el.addEventListener('pointercancel', up, { passive: false });
      };
      const tap = (el, fn) => {
        if (!el) return;
        el.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          el.classList.add('pressed'); fn();
        }, { passive: false });
        const up = e => { e.stopPropagation(); el.classList.remove('pressed'); };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      };

      hold(this._els.fire, () => { self._btnFire = true; }, () => { self._btnFire = false; });
      hold(this._els.sprint, () => { self._btnSprint = true; }, () => { self._btnSprint = false; });
      tap(this._els.reload, () => { if (self.onReload) self.onReload(); });
      tap(this._els.sw, () => { if (self.onSwitch) self.onSwitch(); });
      tap(this._els.crouch, () => {
        self.crouch = !self.crouch;
        self._els.crouch.classList.toggle('toggled', self.crouch);
      });
    },

    /* ---- keyboard / mouse (desktop convenience + automated tests) ---- */
    _bindKeys() {
      const self = this;
      window.addEventListener('keydown', e => {
        self._keys[e.code] = true;
        if (!self._enabled) return;
        if (e.code === 'KeyR' && self.onReload) self.onReload();
        if (e.code === 'KeyQ' && self.onSwitch) self.onSwitch();
        if (e.code === 'KeyC') { self.crouch = !self.crouch; self._els.crouch.classList.toggle('toggled', self.crouch); }
        if (/^Digit[1-4]$/.test(e.code) && self.onSelectWeapon) self.onSelectWeapon(+e.code.slice(5) - 1);
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].indexOf(e.code) >= 0) e.preventDefault();
      });
      window.addEventListener('keyup', e => { self._keys[e.code] = false; });
      const view = U.$id('view');
      view.addEventListener('mousedown', e => { if (self._enabled && e.button === 0) self._mouseFire = true; });
      window.addEventListener('mouseup', e => { if (e.button === 0) self._mouseFire = false; });
      window.addEventListener('mousemove', e => {
        if (!self._enabled) return;
        if (document.pointerLockElement === view) { self.look.dx += e.movementX; self.look.dy += e.movementY; }
      });
      view.addEventListener('click', () => {
        if (self._enabled && self._mouseLook && view.requestPointerLock) view.requestPointerLock();
      });
    },

    // merge keyboard state into movement each frame
    pollKeys() {
      if (!this._enabled) return;
      const k = this._keys;
      let mx = 0, my = 0, used = false;
      if (k.KeyW || k.ArrowUp) { my += 1; used = true; }
      if (k.KeyS || k.ArrowDown) { my -= 1; used = true; }
      if (k.KeyA) { mx -= 1; used = true; }
      if (k.KeyD) { mx += 1; used = true; }
      if (k.ArrowLeft) { this.look.dx -= 9; }
      if (k.ArrowRight) { this.look.dx += 9; }
      if (used && this._stickId === null) {
        const l = Math.hypot(mx, my) || 1;
        this.move.x = mx / l; this.move.y = my / l;
      } else if (!used && this._stickId === null && !this._padActive) {
        this.move.x = 0; this.move.y = 0;
      }
      this.sprint = this._btnSprint || !!k.ShiftLeft;
      this.fire = !!(this._btnFire || this._mouseFire || k.Space);
    },

    consumeLook() {
      const s = this.sensitivity / 100;
      const dx = this.look.dx * 0.0022 * s;
      const dy = this.look.dy * 0.0022 * s;
      this.look.dx = 0; this.look.dy = 0;
      return { dx, dy };
    },

    setLefty(on) {
      this.lefty = !!on;
      document.body.classList.toggle('lefty', this.lefty);
    },
    setNeedReload(on) {
      if (this._els.reload) this._els.reload.classList.toggle('need', !!on);
    }
  };

  g.Input = Input;
})(window);
