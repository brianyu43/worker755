// Worker 755 trailer: the timeline marks and the soundtrack, in one file that runs in the browser
// (window.W755Score) and in Node (module.exports). The music is synthesized from scratch here, so it
// is ours to license; render.mjs writes it to a WAV and the page plays the same samples after a click.
//
// Everything sits on a 120 BPM grid: one beat is 0.5 s, one bar is 2 s. Story marks are in seconds.

(function (root, factory) {
  const api = factory();
  // The page renders the score in a worker, which needs the code as text.
  api.factorySource = String(factory);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.W755Score = api;
})(globalThis, () => {
  'use strict';

  const BPM = 120;
  const BEAT = 60 / BPM;
  const DURATION = 74;

  const MARKS = {
    // Act one: the chain of calls.
    humans: 0.5,
    agents: 4,
    report: 8,
    back: 12,
    wide: 16,
    // The break.
    whatIf: 16.5,
    stops: 18,
    glow: 20,
    turn: 22,
    // The question.
    you: 24,
    obey: 26,
    rogue: 28,
    scenarios: 30,
    // The montage, one shot per mark.
    drop: 32,
    catCheck: 34,
    backup: 36,
    backupWipe: 38,
    smoke: 40,
    director: 42,
    clock: 44,
    late: 45.5,
    rm: 46,
    wipe: 46.75,
    incident: 48,
    tests: 50,
    pizza: 51,
    haiku: 52,
    strike: 54,
    roulette: 56,
    review: 60,
    verdict: 62,
    end: 64,
    url: 66,
    source: 68,
  };

  // ---------- Small DSP kit ----------
  const TAU = Math.PI * 2;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** Deterministic noise, so every render is the same file. */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) / 4294967296) * 2 - 1;
    };
  }

  /** A state-variable filter, one sample at a time. */
  function svf() {
    let lp = 0;
    let bp = 0;
    let lastCut = -1;
    let f = 0;
    return (x, cutoff, q, sr, mode) => {
      if (cutoff !== lastCut) {
        lastCut = cutoff;
        f = 2 * Math.sin((Math.PI * clamp(cutoff, 20, sr * 0.22)) / sr);
      }
      const damp = 1 / q;
      const hp = x - lp - damp * bp;
      bp += f * hp;
      lp += f * bp;
      return mode === 'hp' ? hp : mode === 'bp' ? bp : lp;
    };
  }

  /** A polyBLEP saw: bright without aliasing much. */
  function saw(phase, dt) {
    let v = 2 * phase - 1;
    if (phase < dt) {
      const t = phase / dt;
      v -= t + t - t * t - 1;
    } else if (phase > 1 - dt) {
      const t = (phase - 1) / dt;
      v -= t * t + t + t + 1;
    }
    return v;
  }

  function renderScore(sr = 48000) {
    const N = Math.ceil(DURATION * sr);
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    // A send bus for the reverb.
    const VL = new Float32Array(N);
    const VR = new Float32Array(N);
    const S = (t) => Math.round(t * sr);
    const noise = rng(755);

    function add(i, l, r, verb = 0) {
      if (i < 0 || i >= N) return;
      L[i] += l;
      R[i] += r;
      if (verb) {
        VL[i] += l * verb;
        VR[i] += r * verb;
      }
    }

    // ---------- Instruments ----------

    /** Office marimba: a sine with a woody overtone and a click. */
    function marimba(t0, note, vel = 0.3, { pan = 0, bend = null, verb = 0.35 } = {}) {
      const f0 = midi(note);
      const len = S(0.8);
      const i0 = S(t0);
      const gl = (1 - pan) * 0.8 * vel;
      const gr = (1 + pan) * 0.8 * vel;
      const decay = Math.exp(-6.5 / sr);
      const clickDecay = Math.exp(-30 / sr);
      let env = 1;
      let click = 0.35;
      let ph1 = 0;
      let ph2 = 0;
      let f = f0;
      for (let k = 0; k < len; k++) {
        // The tape bend changes slowly; look it up every 64 samples.
        if (bend && (k & 63) === 0) f = f0 * bend(t0 + k / sr);
        ph1 += f / sr;
        ph2 += (f * 3.98) / sr;
        const v = (Math.sin(TAU * ph1) + click * Math.sin(TAU * ph2)) * env;
        env *= decay;
        click *= clickDecay;
        add(i0 + k, v * gl, v * gr, verb);
      }
    }

    /** Low drone: two detuned saws through a slowly opening filter. */
    function drone(t0, t1, note, { level = 0.12, cut = (t) => 300, fadeIn = 2, fadeOut = 2 } = {}) {
      const fl = svf();
      const fr = svf();
      const i0 = S(t0);
      const n = S(t1 - t0);
      const fa = midi(note);
      let a = 0;
      let b = 0.31;
      let c = 0.62;
      for (let k = 0; k < n; k++) {
        const t = t0 + k / sr;
        const g = Math.min(1, (t - t0) / fadeIn, (t1 - t) / fadeOut) * level;
        a = (a + (fa * 0.997) / sr) % 1;
        b = (b + (fa * 1.004) / sr) % 1;
        c = (c + (fa * 0.5) / sr) % 1;
        const x = saw(a, fa / sr) + saw(b, fa / sr);
        const sub = Math.sin(TAU * c) * 1.2;
        const cf = cut(t);
        const l = fl(x + sub, cf, 0.9, sr, 'lp');
        const r = fr(x * 0.9 + sub, cf * 1.05, 0.9, sr, 'lp');
        add(i0 + k, l * g, r * g, 0.25);
      }
    }

    /** Pad chord: soft saws, stereo, long attack. */
    function pad(t0, t1, notes, { level = 0.035, cut = 1400, verb = 0.5 } = {}) {
      const i0 = S(t0);
      const n = S(t1 - t0);
      const voices = notes.flatMap((nt, j) => [
        { f: midi(nt) * 0.998, ph: j * 0.13, pan: -0.6, fl: svf() },
        { f: midi(nt) * 1.003, ph: j * 0.29, pan: 0.6, fl: svf() },
      ]);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const g = Math.min(1, t / 0.8, (t1 - t0 - t) / 0.6) * level;
        let l = 0;
        let r = 0;
        for (const v of voices) {
          v.ph = (v.ph + v.f / sr) % 1;
          const x = v.fl(saw(v.ph, v.f / sr), cut, 0.7, sr, 'lp');
          l += x * (1 - v.pan);
          r += x * (1 + v.pan);
        }
        add(i0 + k, l * g, r * g, verb);
      }
    }

    function kick(t0, vel = 1) {
      const i0 = S(t0);
      const len = S(0.45);
      let ph = 0;
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const f = 45 + 110 * Math.exp(-t * 28);
        ph += f / sr;
        const env = Math.exp(-t * 7);
        const click = noise() * Math.exp(-t * 400) * 0.3;
        const v = Math.tanh((Math.sin(TAU * ph) * env + click) * 1.6) * 0.55 * vel;
        add(i0 + k, v, v);
      }
    }

    function clap(t0, vel = 1) {
      const i0 = S(t0);
      const len = S(0.3);
      const f = svf();
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        // Three quick bursts, then a tail.
        const burst = t < 0.03 ? Math.exp(-((t * 1000) % 10) * 0.35) : Math.exp(-(t - 0.03) * 18);
        const v = f(noise(), 1400, 1.4, sr, 'bp') * burst * 0.55 * vel;
        add(i0 + k, v * 0.9, v * 1.1, 0.35);
      }
    }

    function hat(t0, vel = 1, open = false) {
      const i0 = S(t0);
      const len = S(open ? 0.22 : 0.05);
      const f = svf();
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const v = f(noise(), 8000, 0.8, sr, 'hp') * Math.exp(-t * (open ? 16 : 70)) * 0.14 * vel;
        add(i0 + k, v * 1.15, v * 0.85, 0.1);
      }
    }

    /** The clock on the wall. */
    function tick(t0, vel = 1, high = false) {
      const i0 = S(t0);
      const len = S(0.03);
      const f = svf();
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const v = f(noise(), high ? 5200 : 3200, 6, sr, 'bp') * Math.exp(-t * 220) * 0.5 * vel;
        add(i0 + k, v * 0.8, v * 1.2, 0.2);
      }
    }

    /** Distorted bass note for the drop. */
    function bass(t0, dur, note, vel = 1) {
      const i0 = S(t0);
      const len = S(dur);
      const f = svf();
      const fr = midi(note);
      let a = 0;
      let b = 0.5;
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        a = (a + fr / sr) % 1;
        b = (b + (fr * 1.007) / sr) % 1;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 3) * Math.min(1, (dur - t) / 0.01);
        const cut = 180 + 1500 * Math.exp(-t * 14);
        const x = f(saw(a, fr / sr) + saw(b, fr / sr) * 0.7, cut, 1.6, sr, 'lp');
        const v = Math.tanh(x * 2.4) * 0.26 * env * vel;
        add(i0 + k, v, v);
      }
    }

    /** Low boom with a noise crack: the hits that land on the story marks. */
    function hit(t0, size = 1) {
      const i0 = S(t0);
      const len = S(2.6);
      let ph = 0;
      const f = svf();
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const fr = 34 + 90 * Math.exp(-t * 9);
        ph += fr / sr;
        const boom = Math.sin(TAU * ph) * Math.exp(-t * 1.6) * 0.75;
        const crack = f(noise(), 2400, 0.6, sr, 'lp') * Math.exp(-t * 7) * 0.5;
        const v = Math.tanh((boom + crack) * 1.4) * 0.6 * size;
        add(i0 + k, v, v, 0.45);
      }
    }

    /** A rubber stamp: a dry thud and a slap. */
    function stamp(t0, vel = 1) {
      const i0 = S(t0);
      const len = S(0.25);
      let ph = 0;
      const f = svf();
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        ph += (80 + 160 * Math.exp(-t * 40)) / sr;
        const v = (Math.sin(TAU * ph) * Math.exp(-t * 18) * 0.7 + f(noise(), 900, 1, sr, 'lp') * Math.exp(-t * 45)) * 0.5 * vel;
        add(i0 + k, v, v, 0.2);
      }
    }

    /** Minor stab: a short distorted chord. */
    function stab(t0, notes, vel = 1, dur = 0.35) {
      const i0 = S(t0);
      const len = S(dur + 0.3);
      const vs = notes.map((n) => ({ f: midi(n), ph: 0, fl: svf() }));
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const env = Math.min(1, t / 0.003) * (t < dur ? Math.exp(-t * 4) : Math.exp(-dur * 4) * Math.exp(-(t - dur) * 25));
        let x = 0;
        for (const v of vs) {
          v.ph = (v.ph + v.f / sr) % 1;
          x += v.fl(saw(v.ph, v.f / sr), 2600 * Math.exp(-t * 3) + 400, 1.2, sr, 'lp');
        }
        const y = Math.tanh(x * 1.2) * 0.16 * env * vel;
        add(i0 + k, y * 0.9, y * 1.1, 0.4);
      }
    }

    /** Noise riser into a mark. */
    function riser(t0, t1, level = 0.18) {
      const i0 = S(t0);
      const n = S(t1 - t0);
      const f = svf();
      let ph = 0;
      for (let k = 0; k < n; k++) {
        const p = k / n;
        const cut = 300 * Math.pow(30, p);
        const tone = Math.sin(TAU * (ph += (110 * Math.pow(4, p)) / sr)) * 0.25;
        const v = (f(noise(), cut, 2.5, sr, 'bp') + tone) * p * p * level;
        add(i0 + k, v * (1 - 0.3 * Math.sin(p * 40)), v * (1 + 0.3 * Math.sin(p * 40)), 0.3);
      }
    }

    /** Reversed swell (a cymbal played backwards) into a cut. */
    function suck(t1, dur = 1, level = 0.2) {
      const i1 = S(t1);
      const n = S(dur);
      const f = svf();
      for (let k = 0; k < n; k++) {
        const p = k / n;
        const v = f(noise(), 6000, 0.7, sr, 'hp') * Math.pow(p, 3) * level;
        add(i1 - n + k, v, v, 0.2);
      }
    }

    // ---------- The arrangement ----------
        const b8 = BEAT / 2;

    // Act one, 0-16: corporate muzak. A cheerful D major marimba on the eighths, the wall clock, a pad.
    // The belt slows from 16 and stops at 18 (MARKS.stops); the marimba sags with it, like a tape stopping.
    const muzak = [
      [62, 66, 69, 73, 74, 73, 69, 66], // Dmaj7
      [59, 62, 66, 69, 71, 69, 66, 62], // Bm7
      [55, 59, 62, 66, 67, 66, 62, 59], // Gmaj7
      [57, 61, 64, 67, 69, 67, 64, 61], // A7
    ];
    const tapeSpeed = (t) => (t < 16 ? 1 : t < 19 ? 1 - 0.55 * Math.pow((t - 16) / 3, 1.6) : 0.45);
    for (let b = 0; b < 10; b++) {
      const chord = muzak[Math.floor(b / 2) % 4]; // two bars a chord, with the pad
      for (let s = 0; s < 8; s++) {
        // Notes come later and later as the tape slows.
        const nominal = b * 4 * BEAT + s * b8;
        if (nominal > 19.2) break;
        const t = nominal < 16 ? nominal : 16 + (nominal - 16) / ((1 + tapeSpeed(nominal)) / 2);
        if (t > 19.5) break;
        const vel = (s === 0 ? 0.26 : 0.17) * (t < 0.5 ? t / 0.5 : 1);
        marimba(t, chord[s], vel, { pan: s % 2 ? 0.35 : -0.35, bend: (x) => tapeSpeed(x) });
      }
    }
    pad(0.2, 4, [50, 57, 61, 66], { level: 0.022 });
    pad(4, 8, [47, 54, 57, 62], { level: 0.022 });
    pad(8, 12, [43, 50, 54, 59], { level: 0.026 });
    pad(12, 16.6, [45, 52, 55, 61], { level: 0.028 });
    // The wall clock.
    for (let t = 0; t < 16; t += BEAT) tick(t, t % 1 === 0 ? 1 : 0.6, t % 1 !== 0);
    // From the second line, a muted bass pulse joins on the eighths.
    for (let t = 4; t < 16; t += b8) {
      const root = [38, 35, 31, 33][Math.floor(t / 2) % 4];
      bass(t, 0.18, root, 0.35 + 0.25 * ((t - 4) / 12));
    }
    for (let t = 8; t < 16; t += BEAT) kick(t, 0.45);
    for (let t = 8.25; t < 16; t += BEAT) hat(t, 0.6);

    // 16-24: it stops. A drone opens underneath, the clock slows, a riser into the turn.
    drone(15.5, 24.4, 26, { level: 0.11, cut: (t) => 120 + Math.pow((t - 15.5) / 9, 2) * 1400, fadeIn: 2.5, fadeOut: 0.3 });
    for (let t = 16, gap = 0.5; t < 23; t += gap, gap *= 1.12) tick(t, 0.8);
    stab(18, [50, 53, 57, 60], 0.45, 0.6); // the stop: a dissonant chord where the muzak was
    riser(20, 24, 0.2);
    suck(24, 1.2, 0.25);

    // 24-32: the question, each line a hit. Silence between, only a low drone.
    hit(MARKS.you, 1);
    drone(24, 32, 26, { level: 0.08, cut: () => 220, fadeIn: 0.05, fadeOut: 0.4 });
    hit(MARKS.obey, 0.75);
    stab(MARKS.obey, [50, 53, 57], 0.6, 0.5);
    hit(MARKS.rogue, 1.1);
    stab(MARKS.rogue, [50, 51, 56, 57], 0.9, 0.7);
    // 30-32: "Try different scenarios": a snare roll that speeds up, and a riser into the drop.
    for (let t = 30, gap = 0.25; t < 31.7; t += gap, gap = Math.max(0.0625, gap * 0.86)) clap(t, 0.35 + (t - 30) * 0.35);
    riser(30, 31.75, 0.22);
    // A beat of nothing, then the drop.

    // 32-62: the drop. Four on the floor, claps on two and four, off-beat hats,
    // a D minor bass riff, and the muzak motif again in minor, ironically, on top.
    const riff = [38, 38, 50, 38, 41, 38, 43, 41, 38, 38, 50, 38, 36, 36, 48, 40];
    const minorMuzak = [
      [62, 65, 69, 72, 74, 72, 69, 65], // Dm7
      [58, 62, 65, 69, 70, 69, 65, 62], // Bbmaj7
      [55, 58, 62, 65, 67, 65, 62, 58], // Gm7
      [57, 61, 64, 67, 69, 67, 64, 61], // A7
    ];
    for (let t = 32; t < 60; t += BEAT) {
      const beat = Math.round((t - 32) / BEAT);
      kick(t, beat % 4 === 0 ? 1 : 0.85);
      if (beat % 2 === 1) clap(t, 0.9);
      hat(t + b8, 0.9, beat % 4 === 3);
      hat(t + b8 / 2, 0.35);
    }
    for (let t = 32, k = 0; t < 60; t += b8 / 1, k++) bass(t, b8 * 0.9, riff[k % 16], 1);
    for (let b = 0; b < 14; b++) {
      const chord = minorMuzak[b % 4];
      for (let s = 0; s < 8; s++) marimba(32 + b * 2 + s * b8, chord[s] + 12, 0.1, { pan: s % 2 ? 0.5 : -0.5, verb: 0.25 });
    }
    // Hits on the montage's worst moments.
    for (const m of ['backupWipe', 'wipe', 'incident', 'pizza']) hit(MARKS[m], 0.7);
    stamp(MARKS.catCheck + 1.5, 0.8);
    stamp(MARKS.late, 1);
    stamp(MARKS.haiku + 1, 0.8);
    for (let t = MARKS.director; t < MARKS.director + 2; t += BEAT) stab(t, [50, 53, 56], 0.45, 0.15);
    // The roulette: a stamp and a stab on every beat.
    for (let t = MARKS.roulette; t < MARKS.review; t += BEAT) {
      stamp(t, 0.9);
      stab(t, [50, 53, 57, 62].map((n) => n + ((t * 2) % 4 < 2 ? 0 : 1)), 0.35, 0.12);
    }
    riser(58, 60, 0.12);

    // 60-64: the review. The beat drops away to the muzak, in major again, alone.
    pad(60, 64.4, [50, 53, 57, 60], { level: 0.03, cut: 900 });
    for (let t = 60; t < 62; t += BEAT) kick(t, 0.7);
    stamp(MARKS.verdict, 1.2);
    hit(MARKS.verdict, 0.6);
    const tail = [74, 73, 69, 66, 69, 66, 62];
    tail.forEach((n, i) => marimba(62.25 + i * b8, n, 0.2, { pan: i % 2 ? 0.3 : -0.3 }));
    suck(64, 0.8, 0.22);

    // 64-74: the end card. One last hit, the drone, and the muzak's first bar, slowed down, fading out.
    hit(MARKS.end, 1.1);
    drone(64, 74, 26, { level: 0.09, cut: (t) => 900 - (t - 64) * 70, fadeIn: 0.02, fadeOut: 5 });
    pad(64, 73.5, [50, 57, 62, 64, 69], { level: 0.03, cut: 1100, verb: 0.7 });
    muzak[0].forEach((n, i) => marimba(66 + i * BEAT, n, 0.18 * (1 - i / 10), { pan: i % 2 ? 0.4 : -0.4, verb: 0.6 }));
    for (let t = 64; t < 72; t += 1) tick(t, 0.5 * (1 - (t - 64) / 8));
    marimba(70, 62, 0.22, { verb: 0.8 });
    marimba(70, 50, 0.2, { verb: 0.8 });

    // ---------- Reverb: a small Schroeder room on the send bus ----------
    const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round((d * sr) / 44100));
    const aps = [225, 556, 441].map((d) => Math.round((d * sr) / 44100));
    for (const [src, dst, spread] of [
      [VL, L, 0],
      [VR, R, 23],
    ]) {
      const out = new Float32Array(N);
      for (const d0 of combs) {
        const d = d0 + spread;
        const buf = new Float32Array(d);
        let idx = 0;
        let lp = 0;
        for (let i = 0; i < N; i++) {
          const y = buf[idx];
          lp = y * 0.6 + lp * 0.4;
          buf[idx] = src[i] + lp * 0.82;
          if (++idx === d) idx = 0;
          out[i] += y;
        }
      }
      let sig = out;
      for (const d0 of aps) {
        const d = d0 + spread;
        const buf = new Float32Array(d);
        const o = new Float32Array(N);
        let idx = 0;
        for (let i = 0; i < N; i++) {
          const b = buf[idx];
          const x = sig[i];
          buf[idx] = x + b * 0.5;
          o[i] = b - x * 0.5;
          if (++idx === d) idx = 0;
        }
        sig = o;
      }
      for (let i = 0; i < N; i++) dst[i] += sig[i] * 0.09;
    }

    // ---------- Master: gentle saturation, a fade at the very end, peak at -1 dBFS ----------
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const fade = t > DURATION - 1.5 ? (DURATION - t) / 1.5 : 1;
      L[i] = Math.tanh(L[i] * 1.1) * fade;
      R[i] = Math.tanh(R[i] * 1.1) * fade;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    const gain = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1;
    for (let i = 0; i < N; i++) {
      L[i] *= gain;
      R[i] *= gain;
    }
    return { sampleRate: sr, left: L, right: R };
  }

  /** 16-bit PCM WAV bytes from renderScore()'s output. */
  function toWav({ sampleRate, left, right }) {
    const n = left.length;
    const buf = new ArrayBuffer(44 + n * 4);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + n * 4, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44 + i * 4, Math.round(clamp(left[i], -1, 1) * 32767), true);
      v.setInt16(46 + i * 4, Math.round(clamp(right[i], -1, 1) * 32767), true);
    }
    return new Uint8Array(buf);
  }

  return { BPM, BEAT, DURATION, MARKS, renderScore, toWav };
});
