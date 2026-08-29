/* ===== audio.js — procedural WebAudio SFX + BGM (no asset files) ===== */
(function (g) {
  'use strict';

  const Snd = {
    ctx: null, master: null, sfxGain: null, bgmGain: null,
    ready: false, sfxOn: true, bgmOn: true,
    noiseBuf: null, _bgmTimer: null, _bgmStep: 0, _bgmMode: null,

    init() {
      if (this.ready) return true;
      const AC = g.AudioContext || g.webkitAudioContext;
      if (!AC) return false;
      try { this.ctx = new AC(); } catch (e) { return false; }
      this.master = this.ctx.createGain(); this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
      this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = 0.20; this.bgmGain.connect(this.master);
      // white noise buffer (1s)
      const sr = this.ctx.sampleRate, len = sr * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, sr);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ready = true;
      return true;
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    now() { return this.ctx ? this.ctx.currentTime : 0; },

    _noise(dur, gain, filterType, f0, f1, dest) {
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = c.createBiquadFilter(); flt.type = filterType || 'lowpass';
      flt.frequency.setValueAtTime(f0, t);
      if (f1 != null) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const gn = c.createGain();
      gn.gain.setValueAtTime(gain, t);
      gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(flt); flt.connect(gn); gn.connect(dest || this.sfxGain);
      src.start(t); src.stop(t + dur + 0.02);
      return { src, gn, flt };
    },
    _tone(type, f0, f1, dur, gain, dest, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0);
      const o = c.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const gn = c.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.25));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(dest || this.sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
      return o;
    },

    play(name, opt) {
      if (!this.ready || !this.sfxOn) return;
      if (this.ctx.state === 'suspended') this.resume();
      opt = opt || {};
      const vol = opt.vol == null ? 1 : opt.vol;
      try {
        switch (name) {
          case 'shot_rifle':
            this._noise(0.13, 0.5 * vol, 'lowpass', 4200, 500);
            this._tone('square', 220, 60, 0.09, 0.16 * vol);
            break;
          case 'shot_smg':
            this._noise(0.09, 0.36 * vol, 'lowpass', 5200, 800);
            this._tone('square', 300, 90, 0.06, 0.11 * vol);
            break;
          case 'shot_shotgun':
            this._noise(0.30, 0.62 * vol, 'lowpass', 2600, 180);
            this._tone('sawtooth', 130, 40, 0.22, 0.22 * vol);
            break;
          case 'shot_sniper':
            this._noise(0.42, 0.60 * vol, 'lowpass', 3400, 220);
            this._tone('sawtooth', 180, 42, 0.34, 0.24 * vol);
            this._tone('sine', 900, 260, 0.25, 0.07 * vol, null, 0.03);
            break;
          case 'dry':
            this._tone('square', 1500, 700, 0.035, 0.08 * vol);
            break;
          case 'reload_start':
            this._noise(0.07, 0.2 * vol, 'bandpass', 1400);
            this._tone('square', 520, 320, 0.05, 0.06 * vol);
            break;
          case 'reload_mid':
            this._noise(0.06, 0.22 * vol, 'bandpass', 900);
            break;
          case 'reload_end':
            this._noise(0.08, 0.26 * vol, 'bandpass', 1800);
            this._tone('square', 780, 1100, 0.06, 0.07 * vol);
            break;
          case 'hit':
            this._noise(0.05, 0.26 * vol, 'bandpass', 2600);
            this._tone('triangle', 1250, 640, 0.05, 0.10 * vol);
            break;
          case 'crit':
            this._tone('square', 1650, 2400, 0.07, 0.15 * vol);
            this._tone('square', 2400, 1200, 0.10, 0.10 * vol, null, 0.05);
            this._noise(0.08, 0.22 * vol, 'highpass', 2200);
            break;
          case 'impact_wall':
            this._noise(0.06, 0.16 * vol, 'lowpass', 1400, 400);
            break;
          case 'enemy_die':
            this._noise(0.34, 0.32 * vol, 'lowpass', 900, 120);
            this._tone('sawtooth', 190, 48, 0.32, 0.16 * vol);
            break;
          case 'boss_die':
            this._noise(1.1, 0.5 * vol, 'lowpass', 1400, 70);
            this._tone('sawtooth', 130, 30, 1.0, 0.26 * vol);
            this._tone('square', 70, 24, 1.2, 0.20 * vol);
            break;
          case 'hurt':
            this._noise(0.24, 0.32 * vol, 'lowpass', 700, 120);
            this._tone('sine', 150, 62, 0.22, 0.18 * vol);
            break;
          case 'enemy_shot':
            this._noise(0.10, 0.20 * vol, 'bandpass', 1500);
            this._tone('sawtooth', 340, 120, 0.10, 0.09 * vol);
            break;
          case 'alert':
            this._tone('square', 700, 1050, 0.10, 0.09 * vol);
            this._tone('square', 1050, 700, 0.10, 0.07 * vol, null, 0.09);
            break;
          case 'btn':
            this._tone('square', 1300, 1750, 0.035, 0.07 * vol);
            break;
          case 'btn_big':
            this._tone('square', 700, 1400, 0.09, 0.10 * vol);
            this._tone('sine', 1400, 2100, 0.14, 0.06 * vol, null, 0.06);
            break;
          case 'coin':
            this._tone('square', 1500, 2100, 0.06, 0.07 * vol);
            this._tone('square', 2100, 2600, 0.09, 0.05 * vol, null, 0.05);
            break;
          case 'upgrade':
            [520, 700, 950, 1300].forEach((f, i) => this._tone('square', f, f * 1.35, 0.14, 0.09 * vol, null, i * 0.07));
            break;
          case 'switch':
            this._noise(0.09, 0.18 * vol, 'bandpass', 1100);
            this._tone('square', 400, 700, 0.07, 0.06 * vol, null, 0.06);
            break;
          case 'clear':
            [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone('triangle', f, f, 0.34, 0.13 * vol, null, i * 0.115));
            break;
          case 'gameover':
            [392, 330, 262, 196].forEach((f, i) => this._tone('sawtooth', f, f * 0.94, 0.5, 0.13 * vol, null, i * 0.19));
            break;
          case 'levelup':
            [660, 880, 1320].forEach((f, i) => this._tone('square', f, f, 0.16, 0.08 * vol, null, i * 0.08));
            break;
          case 'lowammo':
            this._tone('square', 1900, 1500, 0.05, 0.05 * vol);
            break;
        }
      } catch (e) { /* audio must never break gameplay */ }
    },

    // --- simple sequenced BGM ---
    startBgm(mode) {
      if (!this.ready) return;
      if (this._bgmTimer && this._bgmMode === mode) return;
      this.stopBgm();
      this._bgmMode = mode; this._bgmStep = 0;
      if (!this.bgmOn) return;
      const battle = [0, 0, 7, 0, 3, 0, 7, 5];
      const menu = [0, 7, 3, 10, 5, 12, 7, 3];
      const boss = [0, 1, 0, 6, 0, 1, 6, 7];
      const seq = mode === 'menu' ? menu : (mode === 'boss' ? boss : battle);
      const root = mode === 'boss' ? 55 : (mode === 'menu' ? 65.4 : 61.7);
      const tempo = mode === 'menu' ? 340 : (mode === 'boss' ? 190 : 230);
      const self = this;
      this._bgmTimer = setInterval(function () {
        if (!self.bgmOn || !self.ctx) return;
        if (self.ctx.state === 'suspended') return;
        const s = self._bgmStep % seq.length;
        const semi = seq[s];
        const f = root * Math.pow(2, semi / 12);
        try {
          self._tone('sawtooth', f, f, tempo / 1000 * 0.85, 0.16, self.bgmGain);
          if (s % 2 === 0) self._noise(0.06, 0.16, 'lowpass', 220, 90, self.bgmGain);
          if (s % 4 === 2) self._noise(0.05, 0.07, 'highpass', 5200, 4000, self.bgmGain);
          if (mode !== 'menu' && s % 8 === 0) self._tone('triangle', f * 4, f * 4, 0.3, 0.035, self.bgmGain);
        } catch (e) { }
        self._bgmStep++;
      }, tempo);
    },
    stopBgm() { if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; } this._bgmMode = null; },
    setSfx(on) { this.sfxOn = !!on; },
    setBgm(on) {
      this.bgmOn = !!on;
      if (!on) { const m = this._bgmMode; this.stopBgm(); this._bgmMode = m; }
      else if (this._bgmMode) { const m = this._bgmMode; this._bgmMode = null; this.startBgm(m); }
    }
  };

  g.Snd = Snd;
})(window);
