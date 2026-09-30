/*
 * Procedural soundscape built entirely with the Web Audio API:
 *   - rain: layered filtered noise with slow gusts, plus individual drops
 *     tapping the glass (some synced to drops landing on screen);
 *   - thunder: rolling low-passed brown noise, delayed after lightning;
 *   - music: a slow generative ambient piece — warm pad chords and a sparse,
 *     soft piano-like melody through a long reverb.
 */
(function (global) {
  'use strict';

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // Chord voicings (MIDI). Dmaj9 – Bm11 – Gmaj9 – A6sus – Em9 – Gmaj7/A
  const PROGRESSION = [
    [38, 50, 57, 61, 64, 66],
    [35, 50, 54, 57, 61, 64],
    [31, 50, 54, 57, 59, 62],
    [33, 52, 57, 59, 62, 66],
    [40, 50, 55, 59, 62, 66],
    [33, 50, 55, 57, 59, 62]
  ];
  // D major pentatonic, upper register.
  const MELODY = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
  const CHORD_LEN = 10;

  function AmbientAudio() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.volumes = { master: 0.7, rain: 0.7, music: 0.45, thunder: 0.6 };
    this.intensity = 0.55;
    this.lastImpact = 0;
    this.impactBudget = 0;
  }

  AmbientAudio.prototype.start = function () {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();
    this.started = true;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(5, 2.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.8;
    this.reverb.connect(verbOut);
    verbOut.connect(this.master);

    this.rainBus = ctx.createGain();
    this.rainBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.7;
    this.musicBus.connect(musicSend);
    musicSend.connect(this.reverb);
    this.thunderBus = ctx.createGain();
    this.thunderBus.connect(this.master);
    const thunderSend = ctx.createGain();
    thunderSend.gain.value = 0.5;
    this.thunderBus.connect(thunderSend);
    thunderSend.connect(this.reverb);
    this.tapSend = ctx.createGain();
    this.tapSend.gain.value = 0.25;
    this.tapSend.connect(this.reverb);

    this.buildRain();
    this.buildMusic();
    this.applyVolumes(true);

    const self = this;
    this.timer = setInterval(function () { self.tick(); }, 100);
    return true;
  };

  AmbientAudio.prototype.impulse = function (seconds, decay) {
    const ctx = this.ctx;
    const len = Math.round(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  };

  // Seamlessly looping stereo noise. type: white | pink | brown
  AmbientAudio.prototype.noise = function (type, seconds) {
    const ctx = this.ctx;
    const len = Math.round(ctx.sampleRate * seconds);
    const fade = Math.round(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(len + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          raw[i] = last * 3.5;
        } else {
          raw[i] = w;
        }
      }
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        if (i < fade) {
          const t = i / fade;
          d[i] = raw[i] * t + raw[len + i] * (1 - t);
        } else d[i] = raw[i];
      }
    }
    return buf;
  };

  AmbientAudio.prototype.loop = function (buffer, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate || 1;
    src.start(0, Math.random() * buffer.duration);
    return src;
  };

  AmbientAudio.prototype.filter = function (type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  };

  /* ------------------------------ Rain -------------------------------- */
  AmbientAudio.prototype.buildRain = function () {
    const ctx = this.ctx;
    this.whiteBuf = this.noise('white', 4);
    this.pinkBuf = this.noise('pink', 7);
    this.brownBuf = this.noise('brown', 9);

    // Body of the rain: the steady wash of countless drops.
    this.washFilter = this.filter('lowpass', 2600, 0.4);
    const washHp = this.filter('highpass', 180, 0.5);
    this.washGain = ctx.createGain();
    this.loop(this.pinkBuf).connect(washHp);
    washHp.connect(this.washFilter);
    this.washFilter.connect(this.washGain);
    this.washGain.connect(this.rainBus);

    // High, fizzy patter.
    this.hissGain = ctx.createGain();
    const hissBp = this.filter('bandpass', 5200, 0.6);
    this.loop(this.whiteBuf, 0.97).connect(hissBp);
    hissBp.connect(this.hissGain);
    this.hissGain.connect(this.rainBus);

    // Low rumble: rain on rooftops and the street.
    this.rumbleGain = ctx.createGain();
    const rumbleLp = this.filter('lowpass', 380, 0.3);
    this.loop(this.brownBuf).connect(rumbleLp);
    rumbleLp.connect(this.rumbleGain);
    this.rumbleGain.connect(this.rainBus);

    this.gust = 1;
    this.gustTarget = 1;
    this.setIntensity(this.intensity, true);
  };

  AmbientAudio.prototype.setIntensity = function (i, instant) {
    this.intensity = i;
    if (!this.ctx || !this.washGain) return;
    const t = this.ctx.currentTime;
    const tc = instant ? 0.01 : 0.8;
    const g = this.gust;
    this.washGain.gain.setTargetAtTime((0.05 + i * 0.5) * g, t, tc);
    this.hissGain.gain.setTargetAtTime((0.01 + i * 0.06) * g, t, tc);
    this.rumbleGain.gain.setTargetAtTime(0.08 + i * 0.32, t, tc);
    this.washFilter.frequency.setTargetAtTime(1200 + i * 3200 * g, t, tc);
  };

  // A single drop tapping the window pane.
  AmbientAudio.prototype.tap = function (when, level, pan) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const bp = this.filter('bandpass', rand(1400, 6500), rand(2, 9));
    const g = ctx.createGain();
    const dur = rand(0.015, 0.07);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(bp);
    bp.connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(this.rainBus);
    out.connect(this.tapSend);
    src.start(when, Math.random() * 3, dur + 0.02);
  };

  // A heavier drip from the gutter or window frame, with a tiny pitch drop.
  AmbientAudio.prototype.drip = function (when) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const f = rand(900, 2200);
    o.frequency.setValueAtTime(f, when);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.3, 1.7), when + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(rand(0.02, 0.05), when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    o.connect(g);
    g.connect(this.rainBus);
    g.connect(this.tapSend);
    o.start(when);
    o.stop(when + 0.12);
  };

  // Called by the simulation whenever a drop lands on screen.
  AmbientAudio.prototype.impact = function (size, x) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.impactBudget <= 0) return;
    this.impactBudget--;
    const level = Math.min(0.5, 0.05 + size * 0.03) * (0.6 + Math.random() * 0.4);
    this.tap(this.ctx.currentTime + 0.01, level, (x - 0.5) * 1.6);
  };

  AmbientAudio.prototype.thunder = function (distance) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const dur = rand(6, 11);
    const near = 1 - distance;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.55, 0.8);
    const lp = this.filter('lowpass', 250 + near * 1400, 0.7);
    lp.frequency.setValueAtTime(250 + near * 1400, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx.createGain();
    const peak = 0.5 + near * 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(peak, t, 0.05 + distance * 0.5);
    // Rolling rumbles.
    const rolls = 3 + ((Math.random() * 4) | 0);
    for (let i = 1; i <= rolls; i++) {
      const at = t + (i / (rolls + 1)) * dur * 0.7 + rand(0, 0.4);
      g.gain.setTargetAtTime(peak * rand(0.25, 0.9) * (1 - i / (rolls + 2)), at, rand(0.1, 0.5));
    }
    g.gain.setTargetAtTime(0.0001, t + dur * 0.75, dur * 0.12);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.thunderBus);
    src.start(t, Math.random() * 5);
    src.stop(t + dur + 2);

    if (distance < 0.35) {
      // A sharp crack for close strikes.
      const c = ctx.createBufferSource();
      c.buffer = this.whiteBuf;
      const hp = this.filter('bandpass', 1800, 0.5);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(0.35 * near, t + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      c.connect(hp);
      hp.connect(cg);
      cg.connect(this.thunderBus);
      c.start(t);
      c.stop(t + 0.7);
    }
  };

  /* ------------------------------ Music ------------------------------- */
  AmbientAudio.prototype.buildMusic = function () {
    const ctx = this.ctx;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.9;
    const padLp = this.filter('lowpass', 1100, 0.3);
    this.padBus.connect(padLp);
    padLp.connect(this.musicBus);
    // Slowly breathing filter on the pad.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain);
    lfoGain.connect(padLp.frequency);
    lfo.start();

    this.keysBus = ctx.createGain();
    this.keysBus.gain.value = 0.9;
    const keysLp = this.filter('lowpass', 3200, 0.4);
    this.keysBus.connect(keysLp);
    keysLp.connect(this.musicBus);
    // Soft tape-ish echo on the melody.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.48;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const dlp = this.filter('lowpass', 2000, 0.3);
    keysLp.connect(delay);
    delay.connect(dlp);
    dlp.connect(fb);
    fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    dlp.connect(wet);
    wet.connect(this.musicBus);

    this.chordIndex = 0;
    this.nextChord = ctx.currentTime + 0.5;
    this.nextNote = ctx.currentTime + 4;
  };

  AmbientAudio.prototype.padNote = function (midi, t, dur, vel) {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const g = ctx.createGain();
    const attack = 3.5, release = 4.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + attack);
    g.gain.setValueAtTime(vel, t + dur - release);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.padBus);
    const types = ['triangle', 'sine'];
    const detune = [-7, 6];
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = types[i];
      o.frequency.value = f;
      o.detune.value = detune[i] + rand(-2, 2);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  };

  AmbientAudio.prototype.keyNote = function (midi, t, vel) {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const partials = [[1, 1, 3.2], [2, 0.28, 1.4], [3, 0.08, 0.7], [4.2, 0.03, 0.35]];
    const out = ctx.createGain();
    out.gain.value = vel;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.4, 0.4);
      out.connect(pan);
      pan.connect(this.keysBus);
    } else {
      out.connect(this.keysBus);
    }
    partials.forEach(function (p) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * p[0];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(p[1], t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + p[2] + 0.05);
    });
  };

  AmbientAudio.prototype.scheduleMusic = function () {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 1.5;
    while (this.nextChord < ahead) {
      const chord = PROGRESSION[this.chordIndex % PROGRESSION.length];
      const t = this.nextChord;
      const self = this;
      chord.forEach(function (m, i) {
        const vel = i === 0 ? 0.075 : 0.032 - i * 0.002;
        self.padNote(m, t + i * 0.12, CHORD_LEN + 5, vel);
      });
      // Sub bass an octave under the root.
      this.padNote(chord[0] - 12, t, CHORD_LEN + 4, 0.05);
      this.currentChord = chord;
      this.chordIndex++;
      this.nextChord += CHORD_LEN;
    }
    while (this.nextNote < ahead) {
      const t = this.nextNote;
      if (Math.random() < 0.72) {
        const chord = this.currentChord || PROGRESSION[0];
        // Prefer chord tones, but wander through the pentatonic scale.
        let note = pick(MELODY);
        if (Math.random() < 0.5) {
          const tone = pick(chord.slice(1)) + 12;
          if (tone >= 62 && tone <= 86) note = tone;
        }
        this.keyNote(note, t, rand(0.05, 0.1));
        if (Math.random() < 0.22) this.keyNote(note - 12, t + 0.02, rand(0.03, 0.05));
      }
      this.nextNote += pick([1.2, 1.2, 2.4, 2.4, 3.6, 4.8]);
    }
  };

  /* ---------------------------- Scheduler ----------------------------- */
  AmbientAudio.prototype.tick = function () {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Allow up to ~14 visually-synced taps per second.
    this.impactBudget = Math.min(3, this.impactBudget + 1.4);

    // Random scattered taps across the pane.
    const rate = 3 + this.intensity * 38;
    let n = 0;
    let lambda = rate * 0.1;
    let p = Math.exp(-lambda), s = p, u = Math.random();
    while (u > s && n < 20) { n++; p *= lambda / n; s += p; }
    for (let i = 0; i < n; i++) {
      this.tap(now + 0.05 + Math.random() * 0.1, rand(0.015, 0.09) * (0.5 + this.intensity * 0.6), rand(-0.9, 0.9));
    }
    if (Math.random() < 0.015 + this.intensity * 0.02) this.drip(now + 0.05 + Math.random() * 0.1);

    // Gusts: the rain swells and eases.
    if (Math.random() < 0.02) this.gustTarget = rand(0.7, 1.25);
    this.gust += (this.gustTarget - this.gust) * 0.03;
    if (Math.random() < 0.1) this.setIntensity(this.intensity);

    this.scheduleMusic();
  };

  AmbientAudio.prototype.setVolumes = function (v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  };

  AmbientAudio.prototype.applyVolumes = function (fadeIn) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    const curve = function (x) { return x * x; };
    this.master.gain.setTargetAtTime(this.muted ? 0 : curve(v.master) * 1.4, t, fadeIn ? 1.5 : 0.15);
    this.rainBus.gain.setTargetAtTime(curve(v.rain) * 1.6, t, 0.15);
    this.musicBus.gain.setTargetAtTime(curve(v.music) * 1.8, t, 0.15);
    this.thunderBus.gain.setTargetAtTime(curve(v.thunder) * 1.4, t, 0.15);
  };

  AmbientAudio.prototype.setMuted = function (m) {
    this.muted = m;
    this.applyVolumes();
  };

  global.AmbientAudio = AmbientAudio;
})(window);
