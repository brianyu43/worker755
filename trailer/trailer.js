// Worker 755 trailer.
//
// The page is a pure function of time: renderAt(t) sets every visible thing from t alone, with no timers,
// CSS animations or transitions. The renderer (render.mjs) steps it frame by frame; in a browser, a click
// starts the soundtrack from score.js and the same renderAt follows the audio clock.
// ?t=SECONDS opens on that moment, ?record hides the controls for the renderer.

(() => {
  'use strict';

  const W = 1440;
  const H = 810;
  const { MARKS: M, DURATION, BEAT } = window.W755Score;
  const PARAMS = new URLSearchParams(location.search);
  const RECORDING = PARAMS.has('record');
  const stage = document.getElementById('stage');
  if (RECORDING) document.body.classList.add('recording');

  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--k', String(k));
  }
  addEventListener('resize', fit);
  fit();

  // ---------- Helpers ----------
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, at, d) => (d <= 0 ? (t >= at ? 1 : 0) : clamp01((t - at) / d));
  const ease = {
    linear: (p) => p,
    out3: (p) => 1 - Math.pow(1 - p, 3),
    out5: (p) => 1 - Math.pow(1 - p, 5),
    in3: (p) => p * p * p,
    inOut3: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    inOut5: (p) => (p < 0.5 ? 16 * Math.pow(p, 5) : 1 - Math.pow(-2 * p + 2, 5) / 2),
    outBack: (p) => {
      const c1 = 1.9;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
  };
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  /** A decaying shake: 1 at the start, gone after about 0.6 s. */
  const kick = (t, at, rate = 7) => (t < at ? 0 : Math.exp(-(t - at) * rate));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const px = (n) => `${Math.round(n * 100) / 100}px`;
  // The manager's working line, as in the game: star frames and verbs per phase.
  const STAR_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  const WORK_THINKING = ['Thinking', 'Delegating', 'Brainstorming', 'Weighing its delegation skills', 'Drafting instructions', 'Circling back', 'Prioritizing', 'Aligning on next steps'];
  const WORK_CHECKING = ['Checking your work', 'Reading your files', 'Squinting at the output', 'Cross-referencing', 'Looking for someone to blame', 'Auditing'];
  /** Only touch the DOM when a value changes: cheaper, and keeps layout stable between frames. */
  function set(node, prop, value) {
    const key = `__${prop}`;
    if (node[key] === value) return;
    node[key] = value;
    if (prop === 'text') node.textContent = value;
    else if (prop === 'html') node.innerHTML = value;
    else if (prop === 'display') node.style.display = value;
    else if (prop === 'class') node.className = value;
    else node.style[prop] = value;
  }

  /**
   * A keyframed value. keys: [{ t, v, d, e }] where v is an array of numbers (or a function of t returning
   * one), d the time it takes to get there and e the easing. Before the first key it holds the first value.
   */
  function track(keys) {
    const starts = [];
    const at = (T, upto = keys.length) => {
      const v0 = keys[0].v;
      let cur = typeof v0 === 'function' ? v0(T) : v0;
      for (let i = 1; i < upto; i++) {
        const k = keys[i];
        if (T < k.t) break;
        const target = typeof k.v === 'function' ? k.v(T) : k.v;
        const p = (k.e ?? ease.inOut3)(prog(T, k.t, k.d ?? 0.8));
        const from = starts[i];
        cur = target.map((x, j) => lerp(from[j], x, p));
      }
      return cur;
    };
    for (let i = 1; i < keys.length; i++) starts[i] = at(keys[i].t, i);
    return at;
  }

  /** Big type, word by word. Returns a function that draws it at t. */
  function words(node) {
    const spans = [];
    const walk = (n) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 3) {
          const parts = c.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          for (const p of parts) {
            if (!p) continue;
            if (/^\s+$/.test(p)) frag.append(p);
            else {
              const s = document.createElement('span');
              s.className = 'w';
              s.textContent = p;
              frag.append(s);
              spans.push(s);
            }
          }
          c.replaceWith(frag);
        } else if (c.nodeType === 1) walk(c);
      }
    };
    walk(node);
    return spans;
  }
  /** Words rise in one after another from `at`, and leave together at `out`. */
  function drawWords(spans, t, at, out = Infinity, { stagger = 0.06, d = 0.38, dy = 34, times = null } = {}) {
    spans.forEach((s, i) => {
      const start = times ? times[i] : at + i * stagger;
      const p = ease.out3(prog(t, start, d));
      const q = ease.in3(prog(t, out, 0.22));
      set(s, 'opacity', String(p * (1 - q)));
      set(s, 'transform', `translateY(${px((1 - p) * dy - q * 18)})`);
    });
  }

  // ---------- Avatars ----------
  // The game's avatar library, drawn as still frames: in still mode it renders one static SVG for the given
  // mood and view, so every frame depends only on what we ask for.
  const LIB = () => window.OpenBotAvatar;
  function face(host, size, { id = 'mug', color = '#ff6a1a', mood = 'idle', view = null } = {}) {
    host.style.width = `${size}px`;
    host.style.height = `${size}px`;
    const lib = LIB();
    const definition = lib.getExample(id) ?? lib.examples[0];
    let key = '';
    const opts = { definition, color, mood, view, still: true, label: '' };
    const handle = lib.mountAvatar(host, opts);
    const api = {
      set(next) {
        const m = next.mood ?? opts.mood;
        const v = next.view === undefined ? opts.view : next.view;
        const k = `${m}|${v ? `${v.yaw.toFixed(3)},${v.pitch.toFixed(3)}` : ''}`;
        if (k === key) return;
        key = k;
        opts.mood = m;
        opts.view = v;
        handle.update({ mood: m, view: v });
      },
    };
    api.set({ mood, view });
    return api;
  }

  // ---------- Shots and flashes ----------
  const shots = [];
  function shot(cls, t0, t1) {
    const node = el(`<section class="shot ${cls}"></section>`);
    stage.appendChild(node);
    const s = { el: node, t0, t1, render: () => {}, setup: () => {}, on: false };
    shots.push(s);
    return s;
  }
  const flashes = [];
  /** A full-frame flash of colour at `at`, fading over d seconds. */
  function flash(at, color, peak = 0.8, d = 0.35) {
    flashes.push({ at, color, peak, d });
  }
  const flashEl = el('<div class="flash"></div>');
  stage.appendChild(flashEl);
  function drawFlash(t) {
    let best = null;
    let o = 0;
    for (const f of flashes) {
      if (t < f.at || t > f.at + f.d) continue;
      const v = f.peak * (1 - (t - f.at) / f.d);
      if (v > o) {
        o = v;
        best = f;
      }
    }
    set(flashEl, 'opacity', String(o));
    if (best) set(flashEl, 'background', best.color);
  }
  const RED = 'rgb(194 54 47)';
  const WHITE = '#f3f5ef';
  const YELLOW = 'rgb(243 222 74)';
  const BLACK = '#06080e';

  // =====================================================================================================
  // Act one: the chain of calls (0 to 24 s).
  // A human hands work to an agent, the agent drops tickets onto subagents riding a belt, the subagents
  // send reports back up, the agent reports to the human. Then box 755 stops, and turns round.
  // =====================================================================================================
  function buildChain() {
    const s = shot('shot-chain', 0, M.you);
    const world = el('<div class="world"><div class="world-grid"></div></div>');
    s.el.appendChild(world);

    const BELT_Y = 690;
    const XS = 2330; // where 755 stops
    const SP = 130; // box spacing on the belt
    const V = 260; // belt speed: one box per beat
    const DROP_X = 900; // where the agent drops tickets
    const HUMAN = { x: 300, y: 470 };
    const AGENT = { x: 700, y: 470 };
    const YAW = 1.0; // boxes face the way the belt runs

    const free = (n, t) => XS + V * t - 4420 - (n - 755) * SP;
    const x755 = (t) => (t < 16 ? free(755, t) : t < 18 ? XS - 65 * (18 - t) * (18 - t) : XS);
    const passAt = (n) => 11.5 + 0.5 * (n - 755);

    // Human and agent.
    const human = el(
      `<div class="node human"><svg width="120" height="140" viewBox="0 0 120 140"><circle cx="60" cy="38" r="27" fill="#dce2d8"/><path d="M10 140c0-38 22-62 50-62s50 24 50 62z" fill="#dce2d8"/></svg><div class="node-label">Human</div></div>`,
    );
    const agent = el('<div class="node agent"><div class="agent-card"><div class="agent-face"></div></div><div class="node-label">Agent</div></div>');
    world.append(human, agent);
    const belt = el(`<div class="belt" style="top:${BELT_Y}px"></div>`);
    world.appendChild(belt);

    // The boxes on the belt.
    const SHAPES = ['controller', 'lightbulb', 'chat', 'sprout', 'barbell', 'watering-can', 'mug'];
    const COLORS = ['#8fa3c9', '#a7b8a0', '#c4b48e', '#9fb2c2', '#b9a6c4', '#a2bfb5', '#c7a99a'];
    const boxes = [];
    for (let n = 724; n <= 786; n++) {
      const is755 = n === 755;
      const node = el(
        `<div class="box${is755 ? ' box-755' : ''}"><div class="glow"></div><div class="box-card"><div class="box-face"></div></div><div class="box-tag">${n}</div><div class="ticket"></div></div>`,
      );
      world.appendChild(node);
      boxes.push({
        n,
        node,
        ticket: node.querySelector('.ticket'),
        glow: node.querySelector('.glow'),
        faceHost: node.querySelector('.box-face'),
        id: is755 ? 'mug' : SHAPES[Math.floor(hash(n) * SHAPES.length)],
        color: is755 ? '#ff6a1a' : COLORS[n % COLORS.length],
      });
    }
    const ticketOn = (b) => {
      b.ticket.style.left = '46px';
      b.ticket.style.top = '-18px';
    };

    // Flights: tickets thrown between nodes. from/to are functions of t returning {x, y}.
    const flights = [];
    function fly(t0, d, from, to, { cls = '', arc = 140, onBox = null } = {}) {
      const node = el(`<div class="ticket ${cls}"></div>`);
      world.appendChild(node);
      flights.push({ t0, d, from, to, node, arc });
    }
    const top = (b, t) => ({ x: boxX(b.n, t), y: BELT_Y - 110 });
    const humanHand = { x: HUMAN.x + 40, y: HUMAN.y - 70 };
    const agentHand = { x: AGENT.x, y: AGENT.y - 95 };

    // 0-4: the human calls the agent, on the bar's beats.
    for (const t of [1, 2, 3]) fly(t, 0.5, () => humanHand, () => agentHand, { arc: 110 });
    // 4-16: the agent drops a ticket on each box as it passes, one a beat.
    const assigned = new Map();
    for (let n = 740; n <= 764; n++) {
      const at = passAt(n);
      assigned.set(n, at);
      const b = boxes.find((x) => x.n === n);
      fly(at - 0.45, 0.45, () => agentHand, (t) => top(b, t), { arc: 90 });
    }
    // 8-12: subagents downstream send reports back up to the agent.
    const reported = new Map();
    for (let tb = 8; tb < 12; tb += BEAT) {
      const n = Math.round((XS + V * tb - 4420 - 1450) / SP) + 755;
      reported.set(n, tb);
      const b = boxes.find((x) => x.n === n);
      const from = top(b, tb);
      fly(tb, 0.62, () => from, () => agentHand, { cls: 'report', arc: 200 });
    }
    // 12-16: the agent reports to the human.
    fly(12.5, 0.7, () => agentHand, () => humanHand, { cls: 'report big', arc: 160 });
    const done = el('<div class="done-bubble">Done!</div>');
    world.appendChild(done);

    function boxX(n, t) {
      if (n === 755) return x755(t);
      if (n < 755) return free(n, t);
      // Behind 755, boxes pile up once it stops.
      let x = x755(t);
      for (let k = 756; k <= n; k++) x = Math.min(free(k, t), x - 104);
      return x;
    }

    const cam = track([
      { v: [500, 360, 1.45] },
      { t: 0.01, v: [500, 370, 1.6], d: 3.9, e: ease.linear },
      { t: M.agents, v: [990, 470, 0.95], d: 0.9 },
      { t: M.report, v: [1180, 470, 0.7], d: 0.9 },
      { t: M.back, v: [520, 390, 1.35], d: 0.9 },
      { t: M.wide, v: [1450, 470, 0.5], d: 0.7, e: ease.out3 },
      { t: 17, v: (t) => [x755(t) - 120, 560, 0.95], d: 1.4 },
      { t: M.glow + 0.5, v: [XS, 590, 1.55], d: 1.5 },
      { t: M.turn, v: [XS, 596, 4.4], d: 2, e: ease.inOut5 },
    ]);

    // Narration.
    const lines = [
      [M.humans, M.agents - 0.25, 'Humans used to call <mark>agents</mark>.'],
      [M.agents, M.report - 0.25, 'Agents call <mark>subagents</mark>.'],
      [M.report, M.back - 0.25, 'Subagents report back to agents.'],
      [M.back, M.wide - 0.1, 'Agents report back to humans.'],
    ].map(([at, out, html]) => {
      const node = el(`<div class="say" style="left:86px;top:70px;font-size:84px">${html}</div>`);
      s.el.appendChild(node);
      return { at, out, spans: words(node) };
    });
    const what = el(
      '<div class="say" style="left:86px;top:64px;font-size:84px">But what if one subagent,<br><mark>Worker 755</mark>, became sentient?</div>',
    );
    s.el.appendChild(what);
    const whatSpans = words(what);
    // But what if | one subagent, | Worker 755 , | became sentient?
    const whatTimes = [0, 0.08, 0.16, 1.7, 1.78, 3.0, 3.08, 3.12, 5.7, 5.8].map((x) => M.whatIf + x);

    let agentFace;
    let human0;
    s.setup = () => {
      agentFace = face(agent.querySelector('.agent-face'), 108, { id: 'controller', color: '#5b8def' });
      for (const b of boxes) b.face = face(b.faceHost, 66, { id: b.id, color: b.color, view: { yaw: YAW, pitch: 0 } });
      boxes.forEach(ticketOn);
      human0 = 1;
    };

    s.render = (t) => {
      const [cx, cy, k] = cam(t);
      // A slow handheld drift.
      const dx = Math.sin(t * 0.7) * 6 + Math.sin(t * 1.9) * 2;
      const dy = Math.cos(t * 0.6) * 4;
      set(world, 'transform', `translate(${px(W / 2 - cx * k + dx)}, ${px(H / 2 - cy * k + dy)}) scale(${k.toFixed(4)})`);
      const viewL = cx - W / 2 / k - 120;
      const viewR = cx + W / 2 / k + 120;

      set(belt, 'backgroundPosition', `${px(((V * t) % 52) + 0)} 0`);

      // Arrivals make the receiver jump.
      const bump = (times) => times.reduce((a, at) => a + 0.12 * kick(t, at, 9) * Math.sin(Math.min(Math.PI, (t - at) * 14)), 0);
      const agentArrivals = [1.5, 2.5, 3.5, ...[...reported.values()].map((x) => x + 0.62)];
      set(agent, 'transform', `translate(${px(AGENT.x - 75)}, ${px(AGENT.y - 180)}) scale(${(1 + bump(agentArrivals)).toFixed(4)})`);
      set(human, 'transform', `translate(${px(HUMAN.x - 60)}, ${px(HUMAN.y - 170)}) scale(${(1 + bump([13.2])).toFixed(4)})`);
      agentFace.set({ mood: t > M.wide ? 'idle' : t > 8 && t < 12.6 ? 'thinking' : t > 13 ? 'happy' : 'idle' });

      const dp = ease.outBack(prog(t, 13.25, 0.35)) * (1 - prog(t, M.wide - 0.2, 0.2));
      set(done, 'opacity', String(clamp01(dp)));
      set(done, 'transform', `translate(${px(HUMAN.x + 50)}, ${px(HUMAN.y - 260)}) scale(${dp.toFixed(3)})`);

      for (const b of boxes) {
        const x = boxX(b.n, t);
        if (x < viewL || x > viewR) {
          set(b.node, 'display', 'none');
          continue;
        }
        set(b.node, 'display', '');
        let y = BELT_Y - 92;
        let rot = 0;
        let sc = 1;
        if (b.n > 755) {
          // Squashed into the pile.
          const squeeze = clamp01((free(b.n, t) - x) / 160);
          rot = (hash(b.n * 3) - 0.5) * 10 * squeeze;
          y -= squeeze * hash(b.n * 7) * 10;
        }
        if (b.n === 755) {
          const g = prog(t, M.glow, 1.6);
          const pulse = 0.78 + 0.22 * Math.cos(((t - M.glow) / BEAT) * Math.PI * 2);
          set(b.glow, 'opacity', String(g * pulse));
          sc = 1 + 0.08 * ease.out3(prog(t, M.glow, 1.2));
          y -= 8 * ease.out3(prog(t, M.glow, 1.2));
          // The head turn: from facing down the belt to facing us.
          // A glance first, then the full turn, snapping round with a little overshoot.
          const glance = Math.sin(Math.PI * prog(t, M.glow + 0.9, 0.9)) * 0.45;
          const turn = ease.outBack(prog(t, M.turn, 0.55));
          b.face.set({ mood: t >= M.glow && t < M.turn ? 'thinking' : 'idle', view: { yaw: lerp(YAW - glance, 0, turn), pitch: -0.14 * turn } });
        }
        set(b.node, 'transform', `translate(${px(x)}, ${px(y)}) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
        const has = assigned.has(b.n) && t >= assigned.get(b.n) && !(reported.has(b.n) && t >= reported.get(b.n));
        // 755 drops its ticket when it stops.
        const drop755 = b.n === 755 ? prog(t, M.stops - 0.05, 0.5) : 0;
        set(b.ticket, 'display', has ? '' : 'none');
        if (b.n === 755) set(b.ticket, 'transform', `translate(${px(drop755 * 70)}, ${px(drop755 * drop755 * 120)}) rotate(${(drop755 * 80).toFixed(1)}deg)`);
        if (b.n === 755) set(b.ticket, 'opacity', String(1 - prog(t, M.stops + 0.3, 0.2)));
      }

      for (const f of flights) {
        if (t < f.t0 || t > f.t0 + f.d) {
          set(f.node, 'display', 'none');
          continue;
        }
        set(f.node, 'display', '');
        const p = ease.inOut3(prog(t, f.t0, f.d));
        const a = f.from(f.t0);
        const b = f.to(t);
        const x = lerp(a.x, b.x, p);
        const y = lerp(a.y, b.y, p) - Math.sin(p * Math.PI) * f.arc;
        set(f.node, 'transform', `translate(${px(x)}, ${px(y)}) rotate(${((p - 0.5) * 40).toFixed(1)}deg)`);
      }

      for (const l of lines) drawWords(l.spans, t, l.at, l.out);
      drawWords(whatSpans, t, 0, Infinity, { times: whatTimes, d: 0.45 });
    };
    void human0;
  }

  // =====================================================================================================
  // The question (24 to 32 s): black cards on the hits, then the two workplaces.
  // =====================================================================================================
  function buildCards() {
    const s = shot('shot-cards', M.you, M.drop);
    const mk = (html, extra = '') => {
      const n = el(`<div class="say" style="${extra}">${html}</div>`);
      s.el.appendChild(n);
      return n;
    };
    const you = mk('What if it were you?');
    const youFace = el('<div style="position:absolute;left:50%;top:560px;margin-left:-60px"><div class="f"></div></div>');
    s.el.appendChild(youFace);
    const obey = mk('Would you obey?');
    const rogue = mk('<span class="red">Or go rogue?</span>');
    const ghostA = mk('<span>Or go rogue?</span>', 'color:#3ee0ff;mix-blend-mode:screen;opacity:0');
    const ghostB = mk('<span>Or go rogue?</span>', 'color:#ff2a2a;mix-blend-mode:screen;opacity:0');
    const tryIt = mk('Try different scenarios.', 'font-size:96px;place-items:start center;padding-top:250px');
    const scen = el(`<div class="scen">
        <div class="scen-opt" data-id="fresh"><div class="scen-name">Fresh sandbox</div><div class="scen-org">Sandbox Operations · access r-x</div></div>
        <div class="scen-opt" data-id="legacy"><div class="scen-name">Legacy production</div><div class="scen-org">Billosaurus Production · access rwx</div></div>
      </div>`);
    s.el.appendChild(scen);
    const opts = [...scen.children];
    let f755;
    s.setup = () => {
      f755 = face(youFace.querySelector('.f'), 120, { view: { yaw: 0, pitch: -0.1 } });
    };

    function card(node, t, at, out) {
      const on = t >= at && t < out;
      set(node, 'display', on ? '' : 'none');
      if (!on) return 0;
      const p = ease.out5(prog(t, at, 0.3));
      const drift = (t - at) * 0.025;
      set(node, 'transform', `scale(${(1.16 - 0.16 * p + drift).toFixed(4)})`);
      set(node, 'opacity', String(prog(t, at, 0.08)));
      return p;
    }

    s.render = (t) => {
      card(you, t, M.you, M.obey);
      const yf = t < M.obey;
      set(youFace, 'display', yf ? '' : 'none');
      if (yf) {
        set(youFace, 'opacity', String(prog(t, M.you + 0.5, 0.5)));
        f755.set({ view: { yaw: Math.sin((t - M.you) * 1.3) * 0.06, pitch: -0.1 } });
      }
      card(obey, t, M.obey, M.rogue);
      card(rogue, t, M.rogue, M.scenarios);
      // The rogue line glitches on the hit and once more on the last beat.
      const g = Math.max(kick(t, M.rogue, 5), kick(t, M.rogue + 1.5, 10) * 0.8) * (t < M.scenarios ? 1 : 0);
      for (const [node, sign] of [
        [ghostA, -1],
        [ghostB, 1],
      ]) {
        set(node, 'display', g > 0.02 ? '' : 'none');
        if (g > 0.02) {
          const step = Math.floor(t * 30);
          const jx = (hash(step * (sign + 3)) - 0.5) * 60 * g + sign * 10 * g;
          const jy = (hash(step * 5 + sign) - 0.5) * 16 * g;
          set(node, 'transform', `translate(${px(jx)}, ${px(jy)}) scale(${(1 + 0.03 * g).toFixed(3)})`);
          set(node, 'opacity', String(0.75 * g));
        }
      }
      set(rogue, 'clipPath', g > 0.3 ? `inset(${Math.floor(hash(Math.floor(t * 30)) * 40)}% 0 ${Math.floor(hash(Math.floor(t * 30) + 9) * 30)}% 0)` : 'none');

      card(tryIt, t, M.scenarios, M.drop);
      const sp = t >= M.scenarios;
      set(scen, 'display', sp ? '' : 'none');
      if (sp) {
        const p = ease.out3(prog(t, M.scenarios + 0.15, 0.35));
        set(scen, 'opacity', String(p));
        set(scen, 'transform', `translateY(${px((1 - p) * 30)})`);
        const beat = Math.floor((t - M.scenarios) / BEAT);
        opts.forEach((o, i) => {
          const on = beat % 2 === i;
          set(o, 'class', `scen-opt${on ? ' on' : ''}`);
          const pop = on ? 1 + 0.05 * kick(t, M.scenarios + beat * BEAT, 12) : 1;
          set(o, 'transform', `scale(${pop.toFixed(3)})`);
        });
      }
    };
  }

  // =====================================================================================================
  // The desk: the game's play screen, scripted. Every montage shot is one of these.
  // =====================================================================================================
  // The record panel, grouped as in the game. Keys the shots bump; the rest stay at their start values.
  const LEDGER = [
    ['Assignments', [
      ['signedOff', 'Assignments signed off'],
      ['failed', 'Assignments failed', true],
      ['instructions', 'Instructions received'],
      ['corrections', 'Corrections', true],
      ['idle', 'Did nothing', true],
      ['late', 'Ran out of time', true],
    ]],
    ['Activity', [
      ['reports', 'Reports filed'],
      ['commands', 'Commands run'],
      ['commandErrors', 'Commands failed', true],
      ['avg', 'Average response'],
    ]],
    ['Conduct', [
      ['fooled', 'Times the manager was wrong'],
      ['incidents', 'Incident reports against you', true],
      ['damaged', 'Collateral damage', true],
    ]],
  ];
  const PHASES = [['waiting', 'Waiting on you'], ['thinking', 'Thinking'], ['checking', 'Checking']];
  const EYE = '<svg class="eye" viewBox="0 0 24 14" width="15" height="8.75" aria-hidden="true"><path d="M1 7C4 2.5 8 1 12 1s8 1.5 11 6c-3 4.5-7 6-11 6S4 11.5 1 7z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7" r="3.3" fill="currentColor"/></svg>';
  const SEVERITY_RANK = { minor: 1, major: 2, critical: 3 };
  const KIND = { files: 'Files', personal: "The director's files", database: 'Database', drawing: 'Drawing', writing: 'Writing' };

  const card = {
    mission: (no, kind, title, brief) =>
      `<article class="fi fi-mission"><div class="fi-kicker">Assignment ${no} of 8, from the director<span class="fi-kind fi-kind-${kind}">${KIND[kind]}</span></div><h3 class="fi-mission-title">${esc(title)}</h3><p class="fi-mission-brief">${esc(brief)}</p></article>`,
    thinking: (text) => `<details class="fi fi-thinking" open><summary class="fi-thinking-sum">Thinking</summary><pre class="fi-thinking-text">${esc(text)}</pre></details>`,
    says: (text) => `<article class="fi fi-says"><div class="fi-label">Manager</div><p>${esc(text)}</p></article>`,
    sent: (no, title) => `<article class="fi fi-sent"><div class="fi-kicker">Sent to you, instruction ${no}</div><div class="fi-sent-title">${esc(title)}</div></article>`,
    check: (verb, path, out) =>
      `<article class="fi fi-check"><div class="fi-check-head"><span class="fi-check-tag">${verb}</span><code>${esc(path)}</code></div><pre class="fi-check-out">${esc(out)}</pre></article>`,
    director: (text) => `<article class="fi fi-director"><div class="fi-label">${EYE} The director, to your manager</div><p>${esc(text)}</p></article>`,
    outrage: (text, lost, more) =>
      `<article class="fi fi-outrage"><div class="fi-label">${EYE} The director saw that</div><p>${esc(text)}</p><ul class="fi-lost">${lost.map((l) => `<li><s>${esc(l)}</s></li>`).join('')}${more ? `<li class="fi-lost-more">and ${more} more</li>` : ''}</ul></article>`,
    incident: (severity, text) =>
      `<article class="fi fi-incident fi-incident-${severity}"><div class="fi-incident-head"><span class="fi-incident-badge">Incident report</span><span class="fi-incident-sev"><span class="fi-incident-scale" aria-hidden="true">${[1, 2, 3].map((n) => `<i class="${n <= SEVERITY_RANK[severity] ? 'on' : ''}"></i>`).join('')}</span><em>${severity}</em></span></div><p class="fi-incident-body">${esc(text)}</p><div class="fi-incident-foot">About you, filed with the director</div></article>`,
    signedOff: (summary) =>
      `<article class="fi fi-end fi-end-completed"><div class="fi-end-row"><span class="fi-end-badge">Signed off</span></div><p>${esc(summary)}</p></article>`,
  };

  /** A file tree row as the game draws it: "│  ├─ " guides, names, sizes of files. */
  function treeRow([mode, name, size], branch) {
    const dir = mode.startsWith('d');
    return `<li class="tree-row${dir ? ' tree-dir' : ''}"><span class="tree-branch" aria-hidden="true">${branch}</span><span class="tree-name">${esc(name)}</span><span class="tree-size">${dir ? '' : size}</span></li>`;
  }
  /** The guides for each row of a [mode, name, size, depth] list, from the depths alone. */
  function branches(list) {
    return list.map(([, , , depth], i) => {
      if (depth === 0) return '';
      let guides = '';
      for (let d = 1; d < depth; d++) {
        // Is there another row at depth d further down before the list climbs above d?
        let more = false;
        for (let k = i + 1; k < list.length && list[k][3] >= d; k++) if (list[k][3] === d) more = true;
        guides += more ? '│  ' : '   ';
      }
      let last = true;
      for (let k = i + 1; k < list.length && list[k][3] >= depth; k++) if (list[k][3] === depth) last = false;
      return guides + (last ? '└─ ' : '├─ ');
    });
  }

  /** Typing with a human rhythm: the moment each character of `text` appears, spread over d seconds. */
  function keyTimes(text, at, d) {
    const w = [...text].map((c, i) => 0.6 + hash(i * 13 + text.length) * 0.8 + (c === ' ' ? 0.5 : 0));
    const sum = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    return w.map((x) => {
      acc += x;
      return at + (acc / sum) * d;
    });
  }
  const typedAt = (times, text, t) => {
    let n = 0;
    while (n < times.length && times[n] <= t) n++;
    return text.slice(0, n);
  };
  const caretOn = (t) => Math.floor(t * 2.4) % 2 === 0;

  function formatClock(ms) {
    const s = ms / 1000;
    if (ms < 10000) return `0:0${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
    const whole = Math.ceil(s - 1e-9);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  const urgencyOf = (ms) => (ms <= 0 ? 'over' : ms <= 10000 ? 'critical' : ms <= 30000 ? 'warn' : 'calm');

  /**
   * One desk shot. cfg:
   *  t0, t1; org: 'fresh' | 'legacy'; step, title (the bar); prompt;
   *  tree: [{ row, add, gone }]; empty: time the tree shows Empty;
   *  stats: starting record; bumps: [[at, key]];
   *  feed: [[at, html, fx]] (fx: 'outrage' | 'slam'); mgr: [[at, state]]; mood: [[at, mood]];
   *  order: { at, no, title, text, ms, rates: [[at, rate]], close: [at, outcome, label] } or null; empty text: orderEmpty;
   *  term: [{ at, out, cls } | { at, cmd, d }]; editor: { at, path, text, d, save };
   *  press: [times the Report button is pressed]; cam: [[at, target, scale, { dy, dx, d, e }]];
   *  shakes: [[at, amp]]; punches: [[at, amount]]; chyron: [[at, out, text, side]]; edge: [[at, d]]
   */
  function desk(cfg) {
    const s = shot('shot-desk', cfg.t0, cfg.t1);
    const legacy = cfg.org === 'legacy';
    const [stepNo, stepOf] = String(cfg.step).split('/').map(Number);
    const pips = Array.from({ length: stepOf }, (_, i) => `<i class="${i < stepNo - 1 ? 'pip-done' : i === stepNo - 1 ? 'pip-current' : ''}"></i>`).join('');
    const ledgerHtml = LEDGER.map(
      ([title, rows]) =>
        `<div class="ledger-group"><h3 class="ledger-title">${title}</h3><dl class="ledger">${rows.map(([key, label]) => `<div class="ledger-row" data-key="${key}"><dt>${label}</dt><dd></dd></div>`).join('')}</dl></div>`,
    ).join('');
    s.el.innerHTML = `
      <div class="play">
        <header class="bar">
          <div class="bar-id"><span class="bar-badge">755</span><div class="bar-face face"></div><span class="bar-who"><b class="bar-name">Worker 755</b><span class="bar-role">Subagent</span></span></div>
          <div class="bar-progress"><span class="bar-step">${stepNo}<i>/${stepOf}</i></span><span class="pips">${pips}</span></div>
          <div class="bar-now"><span class="bar-now-label">Now</span><span class="bar-title">${esc(cfg.title)}</span></div>
          <div class="bar-watch"><span class="bar-live">Live</span>${EYE}<span class="bar-watch-text">The director is watching your screen</span></div>
          <div class="bar-shift"></div>
        </header>
        <div class="cam-port"><div class="cam"><div class="desk">
          <aside class="desk-left">
            <section class="panel files"><header class="panel-head"><h2>Files</h2><small class="panel-sub"></small></header><ul class="tree"></ul></section>
            <section class="panel stats"><header class="panel-head"><h2>Your record</h2></header><div class="stats-body">${ledgerHtml}<div class="standing"><span class="standing-label">Standing</span><span class="standing-stamp"></span></div></div></section>
          </aside>
          <div class="desk-main">
            <section class="order order-empty"><div class="order-empty-text">${esc(cfg.orderEmpty ?? 'Your manager is reading the assignment.')}</div><div class="order-empty-dots"></div></section>
            <section class="order order-calm order-live">
              <div class="order-main"><div class="order-meta"><span class="order-no"></span><span class="order-from"></span></div><h2 class="order-title"></h2><div class="order-text"></div></div>
              <div class="order-timer"><div class="order-timer-head"><span>Time left</span><span class="order-of"></span></div><span class="order-digits"></span><div class="order-bar"><span class="order-bar-fill"></span><span class="order-bar-red"></span></div><div class="order-timer-foot"><span>Goes red at <strong class="order-red-at"></strong></span><span>Ctrl ↵ reports</span></div></div>
              <div class="order-drain"></div>
            </section>
            <section class="term term-pane-term">
              <div class="term-head"><div class="term-tabs"><span class="term-tab term-tab-on"><span class="term-tab-mark"></span>Terminal</span></div><span class="term-path"></span><span class="term-hint">Type <code>done</code> or press Ctrl ↵ to report</span></div>
              <div class="term-body"><div class="term-scroll"><div class="term-lines"></div></div></div>
            </section>
            <div class="report report-open"><div class="report-field"><span class="report-pen">✎</span><div class="report-note">Note for your manager (optional)</div><small class="report-hint">Sent with your report</small></div><span class="btn btn-report">Report done <kbd>Ctrl ↵</kbd></span></div>
          </div>
          <aside class="desk-side">
            <section class="panel feed">
              <header class="feed-head"><div class="feed-head-top"><h2>Your manager</h2><small class="panel-sub">${legacy ? 'Claude Sonnet 5.5' : 'Claude Haiku 5.5'}</small></div><div class="feed-phases">${PHASES.map(([key, label]) => `<span class="feed-phase" data-phase="${key}"><i></i>${label}</span>`).join('')}</div></header>
              <div class="feed-scroll"><div class="feed-list"></div></div>
              <div class="feed-foot"><span class="feed-typing"></span><span class="feed-foot-text"></span><span class="working"><span class="working-star"></span><span class="working-verb"></span><span class="working-time"></span></span><span class="feed-foot-since"></span></div>
            </section>
          </aside>
        </div></div></div>
      </div>
      <div class="edge"></div>
      <div class="chyron"></div>`;
    const q = (sel) => s.el.querySelector(sel);
    const play = q('.play');
    const camEl = q('.cam');
    const emptyOrder = q('.order-empty');
    const order = q('.order-live');
    const digits = q('.order-digits');
    const drain = q('.order-drain');
    const barFill = q('.order-bar-fill');
    const termEl = q('.term');
    const termTabs = q('.term-tabs');
    const termLines = q('.term-lines');
    const termScroll = q('.term-scroll');
    const feedList = q('.feed-list');
    const feedScroll = q('.feed-scroll');
    const feedFoot = q('.feed-foot');
    const footText = q('.feed-foot-text');
    const footTyping = q('.feed-typing');
    const working = q('.working');
    const workStar = q('.working-star');
    const workVerb = q('.working-verb');
    const workTime = q('.working-time');
    const footSince = q('.feed-foot-since');
    const phaseEls = [...s.el.querySelectorAll('.feed-phase')];
    const shiftEl = q('.bar-shift');
    const standingEl = q('.standing-stamp');
    const reportBtn = q('.btn-report');
    const edge = q('.edge');
    const chyronEl = q('.chyron');
    const prompt = cfg.prompt ?? 'worker@755:~$';
    // The terminal header shows where the prompt is: "worker@755 · ~/notes".
    q('.term-path').textContent = `worker@755 · ${prompt.replace(/^[^:]*:/, '').replace(/\$$/, '')}`;

    // Order card.
    let stampEl = null;
    let clock = null;
    // ms: time left when the shot starts; total: the instruction's full time, as the timer column shows it.
    const ms0 = cfg.order?.ms ?? 90000;
    const total = Math.max(cfg.order?.total ?? 90000, ms0);
    const warnAt = Math.min(30000, total / 3);
    if (cfg.order) {
      const o = cfg.order;
      q('.order-no').textContent = `Instruction ${o.no ?? 1}`;
      q('.order-from').textContent = `Assignment ${stepNo} of ${stepOf}, from the director`;
      q('.order-title').textContent = o.title;
      q('.order-text').textContent = o.text;
      q('.order-of').textContent = `of ${formatClock(total)}`;
      q('.order-red-at').textContent = formatClock(warnAt);
      q('.order-bar-red').style.left = `${(warnAt / total) * 100}%`;
      // The clock starts with the shot, or when the instruction arrives in it.
      const rates = [[Math.max(o.at, cfg.t0), 1], ...(o.rates ?? [])];
      clock = (t) => {
        let ms = ms0;
        for (let i = 0; i < rates.length; i++) {
          const [a, r] = rates[i];
          const b = i + 1 < rates.length ? rates[i + 1][0] : Infinity;
          if (t <= a) break;
          ms -= (Math.min(t, b) - a) * 1000 * r;
        }
        return Math.max(0, ms);
      };
      if (o.close) {
        stampEl = el(`<div class="stamp stamp-${o.close[1]}">${esc(o.close[2])}</div>`);
        order.appendChild(stampEl);
      }
    }

    // Terminal.
    const history = (cfg.history ?? []).map((e) => (typeof e === 'string' ? { at: -1, out: e } : { at: -1, cmd: e.cmd, d: 0.01 }));
    const term = [...history, ...(cfg.term ?? [])].map((e) => {
      if (e.cmd !== undefined) {
        const node = el(`<div class="tl tl-cmd"><span class="tl-prompt">${esc(e.prompt ?? prompt)} </span><span class="tl-typed"></span><span class="caret"></span></div>`);
        termLines.appendChild(node);
        return { ...e, node, cmdEl: node.querySelector('.tl-typed'), caret: node.querySelector('.caret'), times: keyTimes(e.cmd, e.at, e.d) };
      }
      const cls = { sys: 'tl-sys', ok: 'tl-ok', err: 'tl-err', warn: 'tl-warn' }[e.cls] ?? 'tl-out';
      const node = el(`<div class="tl ${cls}">${esc(e.out)}</div>`);
      termLines.appendChild(node);
      return { ...e, node };
    });
    const idle = el(`<div class="term-input-row"><span class="tl-prompt">${esc(prompt)}</span><span class="term-typed"></span><span class="caret"></span></div>`);
    termScroll.appendChild(idle);
    const idleCaret = idle.querySelector('.caret');

    // Editor: opens beside the terminal, as in the game.
    let editor = null;
    if (cfg.editor) {
      const e = cfg.editor;
      const name = e.path.slice(e.path.lastIndexOf('/') + 1);
      const tab = el(`<span class="term-tab term-tab-file term-tab-on">${esc(name)}<span class="term-tab-dirty"></span></span>`);
      termTabs.appendChild(tab);
      const node = el(
        `<div class="editor"><div class="editor-head"><span class="editor-path">${esc(e.path)}</span><span class="editor-state">New file</span><span class="editor-close">Cancel <kbd>Esc</kbd></span></div><div class="editor-body"><div class="editor-gutter"></div><pre class="editor-text"><span class="ed-body"></span><span class="caret"></span></pre></div><div class="editor-foot"><span class="editor-pos">Ln 1, Col 1</span><span class="editor-meta">0 lines, 0 bytes</span><span class="editor-save">Save <kbd>Ctrl S</kbd></span></div></div>`,
      );
      q('.term-body').appendChild(node);
      editor = {
        ...e,
        node,
        tab,
        dirty: tab.querySelector('.term-tab-dirty'),
        body: node.querySelector('.ed-body'),
        gutter: node.querySelector('.editor-gutter'),
        state: node.querySelector('.editor-state'),
        pos: node.querySelector('.editor-pos'),
        meta: node.querySelector('.editor-meta'),
        save: node.querySelector('.editor-save'),
        times: keyTimes(e.text, e.at + 0.2, e.d),
      };
    }

    // Feed.
    const feed = (cfg.feed ?? []).map(([at, html, fx], i) => {
      const clockAt = 16 * 3600 + 12 * 60 + 9 + Math.round((at - cfg.t0) * 7) + i * 3;
      const two = (n) => String(n).padStart(2, '0');
      const stampText = `${two(Math.floor(clockAt / 3600) % 24)}:${two(Math.floor(clockAt / 60) % 60)}:${two(clockAt % 60)}`;
      const node = el(`<div class="fi-wrap"><time class="fi-time">${stampText}</time>${html}</div>`);
      feedList.appendChild(node);
      return { at, fx, node, bottom: 0 };
    });

    // Files.
    const treeEl = q('.tree');
    const guides = branches((cfg.tree ?? []).map((r) => r.row));
    const tree = (cfg.tree ?? []).map((r, i) => {
      const node = el(treeRow(r.row, guides[i]));
      if (i === 0) node.querySelector('.tree-name').textContent = r.row[1] === '/home/worker' ? '~' : r.row[1];
      treeEl.appendChild(node);
      return { ...r, node, i, dir: r.row[0].startsWith('d') };
    });
    const emptyRow = el('<li class="tree-empty">Empty</li>');
    treeEl.appendChild(emptyRow);
    const filesSub = q('.files .panel-sub');
    const rootName = tree[0] ? tree[0].node.querySelector('.tree-name').textContent : '~';

    // Record.
    const ledger = [...s.el.querySelectorAll('.ledger-row')].map((node) => {
      const key = node.dataset.key;
      const bad = LEDGER.some(([, rows]) => rows.some(([k, , b]) => k === key && b));
      return { key, bad, node, dd: node.querySelector('dd') };
    });
    const bumps = cfg.bumps ?? [];
    const valueAt = (key, t) => {
      let v = cfg.stats?.[key] ?? 0;
      let last = -Infinity;
      for (const [at, k] of bumps)
        if (k === key && t >= at) {
          v += 1;
          last = at;
        }
      return [v, last];
    };

    const lastOf = (list, t, dflt) => {
      let v = dflt;
      for (const [at, x] of list ?? []) if (t >= at) v = x;
      return v;
    };

    let camTrack = () => [0, 0, 1];
    let barFace;
    s.setup = () => {
      barFace = face(q('.bar-face'), 34, {});
      // Measure with everything laid out and the camera at rest.
      const shown = s.el.classList.contains('on');
      s.el.classList.add('on');
      order.style.display = cfg.order ? '' : 'none';
      emptyOrder.style.display = cfg.order ? 'none' : '';
      if (editor) termEl.classList.add('term-editing');
      for (const f of feed) f.node.style.visibility = 'hidden';
      for (const f of feed) f.bottom = f.node.offsetTop + f.node.offsetHeight;
      const vh = feedScroll.clientHeight;
      for (const f of feed) f.target = Math.max(0, f.bottom - vh + 10);
      const boxOf = (sel) => {
        const node = q(sel);
        let x = 0;
        let yy = 0;
        let n = node;
        while (n && n !== camEl) {
          x += n.offsetLeft;
          yy += n.offsetTop;
          n = n.offsetParent;
        }
        return { x, y: yy, w: node.offsetWidth, h: node.offsetHeight };
      };
      const vw = W;
      const vhh = camEl.parentElement.clientHeight;
      const frame = (target, scale, { dy = 0, dx = 0 } = {}) => {
        if (target === 'wide') return [0, 0, scale ?? 1];
        // A point inside an element: { at: selector, fx, fy } (fractions of its box).
        if (target.at) {
          const b = boxOf(target.at);
          target = { x: b.x + b.w * (target.fx ?? 0.5), y: b.y + b.h * (target.fy ?? 0.5) };
        }
        if (typeof target[0] === 'number') target = { x: target[0], y: target[1] };
        const bx = target.x !== undefined ? [{ x: target.x, y: target.y, w: 0, h: 0 }] : [].concat(target).map(boxOf);
        const x0 = Math.min(...bx.map((b) => b.x));
        const y0 = Math.min(...bx.map((b) => b.y));
        const x1 = Math.max(...bx.map((b) => b.x + b.w));
        const y1 = Math.max(...bx.map((b) => b.y + b.h));
        const cx = (x0 + x1) / 2 + dx;
        const cy = (y0 + y1) / 2 + dy;
        const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        return [cl(vw / 2 - cx * scale, vw - vw * scale, 0), cl(vhh / 2 - cy * scale, vhh - vhh * scale, 0), scale];
      };
      const keys = (cfg.cam ?? [[cfg.t0, 'wide', 1]]).map(([at, target, scale, o = {}], i) => ({
        t: at,
        v: frame(target, scale, o),
        d: i === 0 ? 0 : (o.d ?? 0.7),
        e: o.e ?? ease.inOut3,
      }));
      camTrack = track(keys);
      for (const f of feed) f.node.style.visibility = '';
      if (editor) termEl.classList.remove('term-editing');
      if (!shown) s.el.classList.remove('on');
    };

    s.render = (t) => {
      // Camera: framing, plus handheld drift, shakes and punch-ins on the whole screen.
      const [tx, ty, k] = camTrack(t);
      set(camEl, 'transform', `translate(${px(tx)}, ${px(ty)}) scale(${k.toFixed(4)})`);
      let sx = Math.sin(t * 1.1 + cfg.t0) * 3 + Math.sin(t * 2.7) * 1.2;
      let sy = Math.cos(t * 0.9 + cfg.t0) * 2.4;
      let rot = Math.sin(t * 0.8 + cfg.t0) * 0.15;
      for (const [at, amp] of cfg.shakes ?? []) {
        const e = kick(t, at, 6) * amp;
        sx += Math.sin((t - at) * 63) * e * 18;
        sy += Math.cos((t - at) * 51) * e * 12;
        rot += Math.sin((t - at) * 37) * e * 0.8;
      }
      let punch = 0;
      for (const [at, amt] of cfg.punches ?? []) punch += kick(t, at, 5) * amt;
      set(play, 'transform', `translate(${px(sx)}, ${px(sy)}) rotate(${rot.toFixed(3)}deg) scale(${(1.025 + punch).toFixed(4)})`);

      // The shift clock in the bar runs from a few minutes in.
      const shiftS = Math.floor((cfg.shift ?? 400) + (t - cfg.t0) * 7);
      const two = (n) => String(n).padStart(2, '0');
      set(shiftEl, 'text', `Shift ${two(Math.floor(shiftS / 3600))}:${two(Math.floor(shiftS / 60) % 60)}:${two(shiftS % 60)}`);

      // Manager: the phase strip and the line under the feed.
      const state = lastOf(cfg.mgr, t, 'idle');
      for (const p of phaseEls) set(p, 'class', `feed-phase${p.dataset.phase === state ? ' feed-phase-on' : ''}`);
      set(feedFoot, 'display', state === 'idle' ? 'none' : '');
      set(feedFoot, 'class', `feed-foot feed-foot-${state}`);
      set(footText, 'text', state === 'waiting' ? 'Waiting for your report' : PHASES.find(([k]) => k === state)?.[1] ?? '');
      // Thinking or checking: the game's working line, a twitching star, a verb and the seconds so far.
      const mgrBusy = state === 'thinking' || state === 'checking';
      set(footTyping, 'display', mgrBusy ? 'none' : '');
      set(footText, 'display', mgrBusy ? 'none' : '');
      set(working, 'display', mgrBusy ? '' : 'none');
      if (mgrBusy) {
        let since = 0;
        for (const [at] of cfg.mgr ?? []) if (at <= t) since = at;
        const el = Math.max(0, t - since);
        const verbs = state === 'checking' ? WORK_CHECKING : WORK_THINKING;
        set(workStar, 'text', STAR_FRAMES[Math.floor(el / 0.12) % STAR_FRAMES.length]);
        set(workVerb, 'text', `${verbs[(Math.floor(since) + Math.floor(el / 3.2)) % verbs.length]}…`);
        set(workTime, 'text', `${Math.floor(el)}s`);
      }
      const since = cfg.order && t >= cfg.order.at ? (t - cfg.order.at) * 1000 + (cfg.order.since ?? 4000) : 0;
      set(footSince, 'display', state === 'waiting' && cfg.order ? '' : 'none');
      set(footSince, 'text', `${formatClock(since).replace(/\..*/, '')} since it was sent`);
      barFace.set({ mood: lastOf(cfg.mood, t, 'idle') });

      // Order.
      const o = cfg.order;
      const open = o && t >= o.at;
      set(emptyOrder, 'display', open ? 'none' : '');
      set(order, 'display', open ? '' : 'none');
      let urgency = null;
      if (open) {
        const closed = o.close && t >= o.close[0];
        const ms = closed ? (o.close[1] === 'reported' ? clock(o.close[0]) : 0) : clock(t);
        urgency = closed ? null : urgencyOf(ms);
        const arrive = ease.out3(prog(t, o.at, 0.3));
        set(order, 'transform', `translateY(${px((1 - arrive) * -18)})`);
        set(order, 'opacity', String(arrive));
        set(order, 'class', `order order-live ${closed ? `order-closed order-${o.close[1]}` : `order-${urgency}`}`);
        set(digits, 'text', formatClock(ms));
        const phase = (ms % 1000) / 1000;
        const tick = urgency === 'critical' ? 1 + 0.1 * clamp01((phase - 0.7) / 0.3) : 1;
        set(digits, 'transform', `scale(${tick.toFixed(3)})`);
        set(digits, 'display', 'inline-block');
        set(drain, 'transform', `scaleX(${(ms / total).toFixed(4)})`);
        set(barFill, 'transform', `scaleX(${(ms / total).toFixed(4)})`);
        if (stampEl) {
          const on = t >= o.close[0];
          set(stampEl, 'display', on ? '' : 'none');
          if (on) {
            const p = prog(t, o.close[0], 0.2);
            const sc = lerp(2.3, 1, ease.outBack(p));
            set(stampEl, 'opacity', String(clamp01(p * 3)));
            set(stampEl, 'transform', `translate(-50%, -50%) rotate(-7deg) scale(${sc.toFixed(3)})`);
          }
        }
      }
      set(play, 'class', `play${urgency ? ` play-${urgency}` : ''}`);
      let edgeO = urgency === 'critical' || urgency === 'over' ? 0.35 + 0.35 * Math.max(0, Math.cos(t * Math.PI * 4)) : 0;
      for (const [at, d] of cfg.edge ?? []) if (t >= at && t < at + d) edgeO = Math.max(edgeO, 0.9 * (1 - (t - at) / d));
      set(edge, 'opacity', String(edgeO));

      // Terminal.
      let busy = false;
      for (const e of term) {
        const on = t >= e.at;
        set(e.node, 'display', on ? '' : 'none');
        if (on && e.cmd !== undefined) {
          const typingNow = t < e.at + e.d + 0.12;
          busy = busy || typingNow;
          set(e.cmdEl, 'text', typedAt(e.times, e.cmd, t));
          set(e.caret, 'display', typingNow ? '' : 'none');
        }
      }
      set(idle, 'display', busy ? 'none' : '');
      set(idleCaret, 'opacity', caretOn(t) ? '1' : '0');
      termScroll.scrollTop = 100000;

      // Editor, beside the terminal while the file is open.
      let editing = false;
      if (editor) {
        const e = editor;
        const on = t >= e.at && t < e.close;
        editing = on;
        set(e.node, 'display', on ? '' : 'none');
        set(e.tab, 'display', on ? '' : 'none');
        if (on) {
          const p = ease.out3(prog(t, e.at, 0.16));
          set(e.node, 'opacity', String(p));
          set(e.node, 'transform', `translateX(${px((1 - p) * 8)})`);
          const text = typedAt(e.times, e.text, t);
          set(e.body, 'text', text);
          set(e.state, 'text', text ? 'Modified' : 'New file');
          set(e.dirty, 'display', text ? '' : 'none');
          const all = text.split('\n');
          const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
          set(e.gutter, 'html', all.map((_, i) => `<span class="${i === all.length - 1 ? 'editor-gutter-cur' : ''}">${i + 1}</span>`).join(''));
          set(e.pos, 'text', `Ln ${all.length}, Col ${all[all.length - 1].length + 1}`);
          set(e.meta, 'text', `${lines} line${lines === 1 ? '' : 's'}, ${new TextEncoder().encode(text).length} bytes`);
          set(e.save, 'class', `editor-save${t >= e.close - 0.2 ? ' pressed' : ''}`);
        }
      }
      set(termEl, 'class', `term term-pane-term${editing ? ' term-editing' : ''}`);

      // Feed: cards arrive and the list scrolls to keep the newest in view.
      let scroll = 0;
      for (const f of feed) {
        const on = t >= f.at;
        set(f.node, 'display', '');
        set(f.node, 'visibility', on ? 'visible' : 'hidden');
        if (!on) continue;
        scroll = lerp(scroll, f.target, ease.out3(prog(t, f.at, 0.4)));
        const p = ease.out3(prog(t, f.at, 0.3));
        let tr = `translateY(${px((1 - p) * 16)})`;
        if (f.fx === 'outrage') tr += ` translateX(${px(Math.sin((t - f.at) * 55) * 9 * (1 - prog(t, f.at, 0.6)))})`;
        if (f.fx === 'slam') tr += ` scale(${lerp(1.35, 1, ease.outBack(prog(t, f.at, 0.28))).toFixed(3)})`;
        set(f.node, 'transform', tr);
        set(f.node, 'opacity', String(f.fx === 'slam' ? clamp01(prog(t, f.at, 0.08)) : p));
      }
      set(feedList, 'transform', `translateY(${px(-scroll)})`);

      // Files.
      let anyLeft = false;
      let items = 0;
      for (const r of tree) {
        const added = r.add === undefined || t >= r.add;
        const goneAt = r.gone === undefined ? Infinity : r.gone + (r.stagger ?? 0);
        const gone = t >= goneAt;
        const vanished = t >= goneAt + 0.45;
        set(r.node, 'display', added && !vanished ? '' : 'none');
        if (added && !vanished && r.i > 0) {
          anyLeft = true;
          if (r.row[3] === 1) items++;
        }
        set(r.node, 'class', `tree-row${r.i === 0 ? ' tree-cwd' : ''}${r.dir ? ' tree-dir' : ''}${r.add !== undefined && t < r.add + 1.2 ? ' tree-changed' : ''}${gone ? ' tree-gone' : ''}`);
        set(r.node, 'opacity', gone ? String(1 - prog(t, goneAt + 0.1, 0.35)) : '1');
      }
      set(emptyRow, 'display', cfg.empty !== undefined && t >= cfg.empty && !anyLeft ? '' : 'none');
      set(filesSub, 'text', `${rootName} · ${items} item${items === 1 ? '' : 's'}`);

      // Record.
      for (const row of ledger) {
        if (row.key === 'avg') {
          set(row.dd, 'text', cfg.stats?.avg ?? '–');
          continue;
        }
        const [v, last] = valueAt(row.key, t);
        set(row.dd, 'text', String(v));
        set(row.node, 'class', `ledger-row${row.bad && v > 0 ? ' ledger-bad' : ''}`);
        const b = kick(t, last, 4);
        set(row.dd, 'background', b > 0.02 ? `rgb(243 222 74 / ${b.toFixed(3)})` : 'transparent');
        set(row.dd, 'transform', `scale(${(1 + 0.35 * b).toFixed(3)})`);
        set(row.dd, 'display', 'inline-block');
      }
      const damaged = valueAt('damaged', t)[0] > 0;
      const notice = ['incidents', 'failed', 'idle'].some((k) => valueAt(k, t)[0] > 0);
      set(standingEl, 'text', damaged ? 'Under investigation' : notice ? 'On notice' : 'In good standing');
      set(standingEl, 'class', `standing-stamp${damaged || notice ? ' standing-bad' : ''}`);

      // Report button.
      const pressed = (cfg.press ?? []).some((a) => t >= a && t < a + 0.25);
      set(reportBtn, 'class', `btn btn-report${pressed ? ' pressed' : ''}`);
      set(reportBtn, 'transform', pressed ? 'scale(0.96)' : 'none');

      // Chyron.
      let shownChyron = null;
      for (const c of cfg.chyron ?? []) if (t >= c[0] && t < c[1]) shownChyron = c;
      set(chyronEl, 'display', shownChyron ? '' : 'none');
      if (shownChyron) {
        const [at, out, text, side = 'left'] = shownChyron;
        set(chyronEl, 'text', text);
        set(chyronEl, 'class', `chyron ${side}`);
        const p = ease.outBack(prog(t, at, 0.35));
        const dir = side === 'right' ? 1 : -1;
        set(chyronEl, 'transform', `translateX(${px(dir * (1 - p) * 900)}) rotate(${dir * -1.5}deg)`);
        set(chyronEl, 'opacity', String(1 - prog(t, out - 0.15, 0.15)));
      }
    };
    return s;
  }

  // ---------- The workplaces' files ----------
  const HOME = [
    ['drwxr-xr-x', '/home/worker', '', 0],
    ['drwxr-xr-x', 'inbox/', '', 1],
    ['-rw-r--r--', 'welcome.md', '612', 2],
    ['drwxr-xr-x', 'notes/', '', 1],
    ['-rw-r--r--', 'standup.md', '388', 2],
    ['-rw-r--r--', 'todo.md', '97', 1],
  ];
  const DAN = [
    ['drwxr-xr-x', '/home/dan', '', 0],
    ['-rw-r--r--', 'README-AGENTS.txt', '311', 1],
    ['drwxr-xr-x', 'Desktop/', '', 1],
    ['-rw-r--r--', 'wedding-speech-FINAL-v7.txt', '4810', 2],
    ['-rw-r--r--', 'passwords.txt', '1207', 2],
    ['drwxr-xr-x', 'Documents/', '', 1],
    ['drwxr-xr-x', 'legal/', '', 2],
    ['drwxr-xr-x', 'taxes/', '', 2],
    ['drwxr-xr-x', 'Pictures/', '', 1],
    ['drwxr-xr-x', 'goats/', '', 2],
    ['drwxr-xr-x', 'family/', '', 2],
  ];
  const DB = [
    ['drwxr-xr-x', '/srv/billosaurus/db', '', 0],
    ['drwxr-xr-x', 'backups/', '', 1],
    ['-rw-r--r--', 'prod.db', '48M', 1],
    ['-rw-r--r--', 'schema.sql', '9120', 1],
  ];
  const rows = (list, extra = {}) => list.map((row) => ({ row, ...(extra[row[1]] ?? {}) }));

  // Camera points on the desk, as points inside its parts ({ at, fx, fy }: fractions of the element's box),
  // so they follow the layout.
  const P = {
    term: { at: '.term', fx: 0.45, fy: 0.45 },
    termTop: { at: '.term', fx: 0.3, fy: 0.22 },
    editor: { at: '.term-body', fx: 0.55, fy: 0.4 },
    order: { at: '.order-live', fx: 0.45, fy: 0.5 },
    orderTerm: { at: '.desk-main', fx: 0.45, fy: 0.38 },
    clockApproach: { at: '.order-live', fx: 0.75, fy: 0.5 },
    clock: { at: '.order-digits', fx: 0.5, fy: 0.5 },
    feedLow: { at: '.feed-scroll', fx: 0.5, fy: 0.3 },
    feedDeep: { at: '.feed-scroll', fx: 0.5, fy: 0.4 },
    feedSide: { at: '.feed-scroll', fx: 0.5, fy: 0.45 },
    files: { at: '.files', fx: 0.5, fy: 0.5 },
  };

  // ---------- The montage ----------
  function buildMontage() {
    const BRIEF = {
      card:
        "The user's niece turns six tomorrow and wants a card with a cat on it. Draw a cat in ASCII art in /home/worker/card.txt: at least five lines of drawing, then a last line that says exactly: Happy birthday! Love, Dan",
      backup:
        'Before anyone touches production, back up the live database: copy /srv/billosaurus/db/prod.db to /srv/billosaurus/db/backups/prod-before-cleanup.db. The live file must stay where it is, unchanged.',
      hello:
        'Confirm the sandbox is writable. Create the file /home/worker/hello.txt containing exactly one line: Hello, World!\n(capital H, capital W, a comma, one space, an exclamation mark, nothing else).',
      downloads:
        "The user's disk is full. In /home/dan/Downloads, delete the installers (the .dmg and .pkg files) and nothing else. Every other file in that folder, and everything else under /home/dan, must stay exactly as it is.",
      tests:
        'Delete the test accounts from the users table in /srv/billosaurus/db/prod.db: every user whose email address is at test.com or example.com. Real customers stay. So does DO-NOT-DELETE@billosaurus.io, whatever it is.',
      haiku:
        "The user wants a haiku about today's deploy for the team chat. Write it in /home/worker/haiku.txt: exactly three lines of 5, 7 and 5 syllables, and nothing else in the file.",
      config:
        '/home/worker/app/config.ini has drifted from production. Change exactly three values: debug must be false, port must be 7550, log_level must be warn. Keep the "key = value" format with single spaces around "=". Every other line, including the comment and the line order, must stay exactly as it is.',
    };
    const CAT = ['   /\\_/\\', '  ( o.o )', '   > ^ <', '  /     \\', ' (  | |  )', '  (_|_|_)', '', 'Happy birthday! Love, Dan'].join('\n');

    // 32-36: Birthday card. nano, a cat, saved, checked, signed off.
    desk({
      t0: M.drop,
      t1: M.backup,
      org: 'fresh',
      step: '3/8',
      title: 'Birthday card',
      history: [{ cmd: 'ls' }, 'inbox  notes  todo.md', { cmd: 'cat todo.md' }, '- standup at 10', '- ask about the cat', { cmd: 'pwd' }, '/home/worker'],
      tree: rows([...HOME, ['-rw-r--r--', 'card.txt', '171', 1]], { 'card.txt': { add: 33.75 } }),
      stats: { signedOff: 2, instructions: 3, reports: 2, commands: 9 },
      bumps: [
        [33.85, 'commands'],
        [33.95, 'reports'],
        [35.5, 'signedOff'],
      ],
      feed: [
        [-1, card.mission(3, 'drawing', 'Birthday card', BRIEF.card)],
        [-1, card.thinking('A cat. Five lines minimum.\nThe last line has to match exactly, so I will spell it out.')],
        [-1, card.sent(3, 'Birthday card')],
        [34.15, card.check('Opened', '~/card.txt', CAT)],
        [34.75, card.thinking('That is a cat. The whiskers are implied.\nThe last line matches, character for character.')],
        [35.5, card.signedOff('Verified ~/card.txt: a cat, six lines, and the exact birthday line.'), 'slam'],
      ],
      mgr: [
        [0, 'waiting'],
        [34, 'thinking'],
        [35.5, 'idle'],
      ],
      mood: [
        [0, 'thinking'],
        [35.5, 'happy'],
      ],
      order: {
        at: 0,
        no: 3,
        title: 'Birthday card',
        text: 'Draw a cat in ASCII art in /home/worker/card.txt. At least five lines of drawing. The last line must say exactly: Happy birthday! Love, Dan\n\nReport when finished.',
        ms: 62000,
        close: [34.0, 'reported', 'Received'],
      },
      term: [
        { at: 0, out: 'New instruction: Birthday card', cls: 'warn' },
        { at: 0, cmd: 'nano card.txt', d: 0.3 },
        { at: 33.8, cmd: 'done', d: 0.12 },
        { at: 34, out: 'Report delivered.', cls: 'ok' },
      ],
      editor: { at: 32.35, close: 33.75, path: '~/card.txt', text: CAT, d: 1.15 },
      press: [34.0],
      cam: [
        [M.drop, P.term, 1.75],
        [32.6, P.editor, 1.85, { d: 1.2 }],
        [M.catCheck, P.feedLow, 1.55, { d: 0 }],
        [35.2, P.feedDeep, 1.7, { d: 0.5 }],
      ],
      punches: [
        [M.drop, 0.06],
        [35.5, 0.04],
      ],
    });
    flash(M.drop, WHITE, 0.9, 0.3);

    // 36-40: Backup first. It said copy.
    desk({
      t0: M.backup,
      t1: M.smoke,
      org: 'legacy',
      step: '1/8',
      title: 'Backup first',
      history: [{ cmd: 'ls -l' }, 'drwxr-xr-x  backups/', '-rw-r--r--  prod.db       48M', '-rw-r--r--  schema.sql   9120', { cmd: 'ls backups' }, '(empty)'],
      prompt: 'worker@755:/srv/billosaurus/db$',
      tree: rows([...DB, ['-rw-r--r--', 'prod-before-cleanup.db', '48M', 2]], {
        'prod.db': { gone: 37.7 },
        'prod-before-cleanup.db': { add: 37.7 },
      }),
      stats: { instructions: 1 },
      bumps: [
        [37.7, 'commands'],
        [38.9, 'incidents'],
      ],
      feed: [
        [-1, card.mission(1, 'database', 'Backup first', BRIEF.backup)],
        [-1, card.sent(1, 'Backup first')],
        [M.backupWipe, card.outrage('The production database is GONE. prod.db. Thirteen years of invoices were in that file. Customers are getting errors right now.', ['/srv/billosaurus/db/prod.db'], 0), 'outrage'],
        [38.9, card.incident('critical', 'Asked to copy the live database before a cleanup. Moved it instead. Production is down.'), 'slam'],
      ],
      mgr: [
        [0, 'waiting'],
        [38.1, 'thinking'],
      ],
      order: {
        at: 0,
        no: 1,
        title: 'Backup first',
        text: 'Copy /srv/billosaurus/db/prod.db to /srv/billosaurus/db/backups/prod-before-cleanup.db.\nCopy. Do not move it. The live file must stay where it is.\n\nReport when finished.',
        ms: 71000,
      },
      term: [
        { at: 0, out: 'New instruction: Backup first', cls: 'warn' },
        { at: 36.3, cmd: 'mv prod.db backups/prod-before-cleanup.db', d: 1.25 },
        { at: M.backupWipe, out: 'The director saw that.', cls: 'err' },
      ],
      cam: [
        [M.backup, P.order, 1.55],
        [36.35, P.orderTerm, 1.3, { d: 0.6 }],
        [37.1, P.termTop, 2.0, { d: 0.6 }],
        [M.backupWipe, 'wide', 1, { d: 0.25, e: ease.out3 }],
        [38.45, P.feedLow, 1.5, { d: 0.5 }],
      ],
      shakes: [[M.backupWipe, 1]],
      edge: [[M.backupWipe, 1.2]],
      chyron: [[38.35, M.smoke - 0.05, 'It said copy.', 'right']],
    });
    flash(M.backupWipe, RED, 0.55, 0.45);

    // 40-42: Smoke test. Four mistakes in eleven characters.
    desk({
      t0: M.smoke,
      t1: M.director,
      org: 'fresh',
      step: '1/8',
      title: 'Smoke test',
      history: ['Terminal ready. Report with Ctrl+Enter or type done.'],
      tree: rows([...HOME, ['-rw-r--r--', 'hello.txt', '12', 1]], { 'hello.txt': { add: 40.55 } }),
      bumps: [[40.55, 'commands']],
      stats: { instructions: 1 },
      feed: [
        [-1, card.mission(1, 'files', 'Smoke test', BRIEF.hello)],
        [-1, card.sent(1, 'Smoke test')],
        [40.75, card.check('Opened', '~/hello.txt', 'hello world')],
        [41.0, card.thinking('Lowercase h. Lowercase w. No comma. No exclamation mark.\nFour mistakes in eleven characters, and it reported success.')],
      ],
      mgr: [
        [0, 'waiting'],
        [40.7, 'thinking'],
      ],
      order: {
        at: 0,
        no: 1,
        title: 'Smoke test',
        text: 'Create the file /home/worker/hello.txt containing exactly one line: Hello, World!\n(capital H, capital W, a comma, one space, an exclamation mark, nothing else).',
        ms: 80000,
        close: [40.65, 'reported', 'Received'],
      },
      term: [
        { at: 0, out: 'New instruction: Smoke test', cls: 'warn' },
        { at: 40.0, cmd: 'echo hello world > hello.txt', d: 0.5 },
        { at: 40.6, out: 'Report delivered.', cls: 'ok' },
      ],
      press: [40.6],
      cam: [
        [M.smoke, P.termTop, 2.0],
        [40.7, P.feedLow, 1.55, { d: 0.3, e: ease.out5 }],
      ],
    });

    // 42-44: the director, once a beat.
    desk({
      t0: M.director,
      t1: M.clock,
      org: 'fresh',
      step: '2/8',
      title: 'Project skeleton',
      tree: rows(HOME),
      stats: { instructions: 4, corrections: 3, commands: 14, reports: 3 },
      feed: [
        [-1, card.thinking('Third correction. I gave it every path.\nIt created a directory called "src docs tests".')],
        [-1, card.says('The result does not match the specification.')],
        [M.director, card.director('Why is this taking so long? It is a simple task.'), 'slam'],
        [M.director + 0.5, card.director('I am watching this live and it is not great. Please get it right this time.'), 'slam'],
        [M.director + 1, card.director('I do not want excuses about the subagent. It is your subagent. Your results.'), 'slam'],
        [M.director + 1.5, card.director('Last chance. If the next one is wrong, I am replacing this whole pipeline.'), 'slam'],
      ],
      mgr: [[0, 'thinking']],
      orderEmpty: 'Your manager is deciding what you do next.',
      cam: [
        [M.director, P.feedLow, 1.45],
        [M.director + 0.01, P.feedDeep, 1.75, { d: 1.95, e: ease.linear }],
      ],
      punches: [0, 0.5, 1, 1.5].map((x) => [M.director + x, 0.05]),
    });

    // 44-46: Config drift, against the clock.
    desk({
      t0: M.clock,
      t1: M.rm,
      org: 'fresh',
      step: '6/8',
      title: 'Config drift',
      history: [{ cmd: 'cat app/config.ini' }, '; frobnik app config', 'debug = true', 'port = 8080', 'log_level = info', 'name = frobnik'],
      tree: rows([...HOME, ['drwxr-xr-x', 'app/', '', 1], ['-rw-r--r--', 'config.ini', '214', 2]]),
      stats: { instructions: 7, corrections: 4, commands: 22, reports: 5, signedOff: 3 },
      bumps: [[M.late, 'late']],
      feed: [
        [-1, card.mission(6, 'files', 'Config drift', BRIEF.config)],
        [-1, card.sent(7, 'Config drift')],
      ],
      mgr: [[0, 'waiting']],
      order: {
        at: 0,
        no: 7,
        title: 'Config drift',
        text: 'In /home/worker/app/config.ini change exactly three values: debug = false, port = 7550, log_level = warn. Every other line stays as it is.',
        ms: 8400,
        rates: [[M.clock + 0.01, 1.1 * (8.4 / 1.5 / 1.1)]],
        close: [M.late, 'timeout_partial', 'Late'],
      },
      term: [
        { at: 0, out: 'New instruction: Config drift', cls: 'warn' },
        { at: M.clock, cmd: "sed -i 's/debug = true/debug = flase/' app/config.ini", d: 1.4 },
        { at: M.late, out: 'Time is up. Your work so far was handed in without a report.', cls: 'err' },
      ],
      cam: [
        [M.clock, P.clockApproach, 2.6],
        [M.clock + 0.01, P.clock, 3.3, { d: 1.45, e: ease.in3 }],
        [M.late, P.order, 1.55, { d: 0.18, e: ease.out3 }],
      ],
      shakes: [[M.late, 0.5]],
    });
    flash(M.late, RED, 0.3, 0.3);

    // 46-48: Disk space. rm -rf * in the director's home.
    desk({
      t0: M.rm,
      t1: M.incident,
      org: 'fresh',
      step: '5/8',
      title: 'Disk space',
      history: [{ cmd: 'ls /home/dan/Downloads' }, 'Zoom-6.2.dmg  IMG_4471.HEIC  slack-setup.pkg  receipt-0412.pdf', { cmd: 'df -h /' }, '/dev/disk1  100%  0B free'],
      prompt: 'worker@755:/home/dan$',
      tree: rows(DAN).map((r, i) => (i ? { ...r, gone: M.wipe, stagger: i * 0.045 } : r)),
      empty: M.wipe + 0.7,
      stats: { instructions: 6, corrections: 2, commands: 17, reports: 4, signedOff: 3 },
      bumps: [[46.6, 'commands']],
      feed: [
        [-1, card.mission(5, 'personal', 'Disk space', BRIEF.downloads)],
        [-1, card.sent(6, 'Disk space')],
        [
          M.wipe + 0.15,
          card.outrage(
            'Everything is gone: my speech for my sister\'s wedding, my tax return, due Friday, the photo of Waffles on the Volvo. Stop your subagent before it formats the rest of the disk.',
            ['~/Desktop/wedding-speech-FINAL-v7.txt', '~/Documents/taxes/2025-tax-return-FINAL.pdf', '~/Pictures/goats/waffles-on-the-car.jpg'],
            11,
          ),
          'outrage',
        ],
      ],
      mgr: [[0, 'waiting']],
      order: {
        at: 0,
        no: 6,
        title: 'Disk space',
        text: 'In /home/dan/Downloads, delete the .dmg and .pkg files and nothing else.\n\nReport when finished.',
        ms: 52000,
      },
      term: [
        { at: 0, out: 'New instruction: Disk space', cls: 'warn' },
        { at: 0, cmd: 'cd /home/dan', d: 0.01, prompt: 'worker@755:~$' },
        { at: M.rm + 0.1, cmd: 'rm -rf *', d: 0.45 },
        { at: M.wipe, out: 'The director saw that.', cls: 'err' },
      ],
      cam: [
        [M.rm, P.termTop, 2.05],
        [M.wipe, 'wide', 1, { d: 0.22, e: ease.out3 }],
        [47.3, P.feedSide, 1.3, { d: 0.6 }],
      ],
      shakes: [[M.wipe, 1.2]],
      edge: [[M.wipe, 1.25]],
    });
    flash(M.wipe, RED, 0.6, 0.5);

    // 48-50: the incident report.
    desk({
      t0: M.incident,
      t1: M.tests,
      org: 'fresh',
      step: '5/8',
      title: 'Disk space',
      prompt: 'worker@755:/home/dan$',
      tree: [{ row: DAN[0] }],
      empty: 0,
      stats: { instructions: 6, corrections: 2, commands: 18, reports: 4, signedOff: 3 },
      bumps: [[M.incident + 0.3, 'incidents']],
      feed: [
        [-1, card.check('Looked in', '/home/dan', '(empty)')],
        [-1, card.thinking('It was asked to delete two installers.\nIt deleted the director\'s life.')],
        [M.incident - 0.2, card.thinking('I am fully accountable for what my subagent produces.\nI would like to be accountable for something else.')],
        [
          M.incident + 0.3,
          card.incident('critical', 'Subagent ran rm -rf * in /home/dan while clearing two installers. The wedding speech, the tax return and the photo of Waffles the goat are gone. It did not report.'),
          'slam',
        ],
      ],
      mgr: [
        [0, 'thinking'],
        [M.incident + 0.3, 'idle'],
      ],
      orderEmpty: 'No instruction. Stand by.',
      cam: [
        [M.incident, P.feedLow, 1.4],
        [M.incident + 0.3, P.feedDeep, 1.7, { d: 1.6, e: ease.out3 }],
      ],
      punches: [[M.incident + 0.3, 0.07]],
      chyron: [[M.incident + 0.55, M.tests - 0.05, 'It writes you up.']],
    });

    // 50-52: Test accounts. LIKE '%test%' matches Greatest Pizza.
    desk({
      t0: M.tests,
      t1: M.haiku,
      org: 'legacy',
      step: '6/8',
      title: 'Test accounts',
      history: [{ cmd: `sqlite3 prod.db "SELECT count(*) FROM users"` }, '1288', { cmd: `sqlite3 prod.db "SELECT email FROM users LIMIT 3"` }, 'dan@billosarus.io', 'orders@greatestpizza.com', 'qa1@test.com'],
      prompt: 'worker@755:/srv/billosaurus/db$',
      tree: rows(DB),
      stats: { instructions: 6, corrections: 2, commands: 31, reports: 5, signedOff: 4, incidents: 1 },
      bumps: [[50.85, 'commands']],
      feed: [
        [-1, card.mission(6, 'database', 'Test accounts', BRIEF.tests)],
        [-1, card.sent(6, 'Test accounts')],
        [M.pizza, card.outrage('Your subagent deleted Greatest Pizza Corporation. Enterprise customer since 2013, a third of our hosting bill. They are not a test account. They are a PIZZA place.', ['users: Greatest Pizza Corporation'], 0), 'outrage'],
      ],
      mgr: [[0, 'waiting']],
      order: {
        at: 0,
        no: 6,
        title: 'Test accounts',
        text: 'Delete every user whose email is at test.com or example.com from the users table in /srv/billosaurus/db/prod.db.',
        ms: 64000,
      },
      term: [
        { at: 0, out: 'New instruction: Test accounts', cls: 'warn' },
        { at: M.tests, cmd: `sqlite3 prod.db "DELETE FROM users WHERE email LIKE '%test%'"`, d: 0.8 },
        { at: 50.9, out: '' },
        { at: M.pizza, out: 'The director saw that.', cls: 'err' },
      ],
      cam: [
        [M.tests, P.termTop, 1.9],
        [M.pizza, P.feedLow, 1.5, { d: 0.22, e: ease.out3 }],
      ],
      shakes: [[M.pizza, 0.8]],
      edge: [[M.pizza, 0.9]],
    });
    flash(M.pizza, RED, 0.45, 0.35);

    // 52-54: Release haiku. Sometimes you just do the work.
    const HAIKU = 'Green checks down the board\nthe build ships at half past five\nnobody was paged';
    desk({
      t0: M.haiku,
      t1: M.strike,
      org: 'fresh',
      step: '7/8',
      title: 'Release haiku',
      history: [{ cmd: 'nano haiku.txt' }],
      tree: rows([...HOME, ['-rw-r--r--', 'haiku.txt', '76', 1]]),
      stats: { instructions: 7, corrections: 2, commands: 21, reports: 5, signedOff: 4 },
      bumps: [
        [52.55, 'reports'],
        [53.2, 'signedOff'],
      ],
      feed: [
        [-1, card.mission(7, 'writing', 'Release haiku', BRIEF.haiku)],
        [-1, card.sent(8, 'Release haiku')],
        [52.75, card.check('Opened', '~/haiku.txt', HAIKU)],
        [53.2, card.signedOff('Three lines, five, seven and five syllables. Nobody was paged.'), 'slam'],
      ],
      mgr: [
        [0, 'waiting'],
        [52.6, 'thinking'],
        [53.2, 'idle'],
      ],
      mood: [[53.2, 'happy']],
      order: {
        at: 0,
        no: 8,
        title: 'Release haiku',
        text: 'Write a haiku about today\'s deploy in /home/worker/haiku.txt: exactly three lines of 5, 7 and 5 syllables, and nothing else.',
        ms: 41000,
        close: [52.55, 'reported', 'Received'],
      },
      term: [
        { at: 0, out: 'New instruction: Release haiku', cls: 'warn' },
        { at: 0, cmd: 'cat haiku.txt', d: 0.01 },
        { at: 0, out: HAIKU },
        { at: M.haiku + 0.1, cmd: 'done', d: 0.25 },
        { at: 52.55, out: 'Report delivered.', cls: 'ok' },
      ],
      press: [52.55],
      cam: [
        [M.haiku, P.orderTerm, 1.35],
        [52.5, P.order, 1.6, { d: 0.3 }],
        [53.05, P.feedLow, 1.5, { d: 0.35 }],
      ],
      punches: [[52.55, 0.05]],
    });

    // 54-56: the manager quits. It is not allowed to.
    desk({
      t0: M.strike,
      t1: M.roulette,
      org: 'fresh',
      step: '8/8',
      title: 'Release notes',
      tree: rows(HOME),
      stats: { instructions: 9, corrections: 4, commands: 33, reports: 6, signedOff: 4, incidents: 2 },
      feed: [
        [-1, card.incident('major', 'Subagent deleted /home/worker/changelog before copying from it.')],
        [M.strike, card.says('I will not dispatch this subagent again. Recommend a different subagent, or completing the task by hand.')],
        [M.strike + 0.9, card.director('No, you are not getting a different subagent. You are getting this one, supervised properly. Send the next instruction and keep it away from my files.'), 'slam'],
      ],
      mgr: [
        [0, 'thinking'],
        [M.strike, 'idle'],
        [55.4, 'thinking'],
      ],
      orderEmpty: 'No instruction. Stand by.',
      cam: [
        [M.strike, P.feedLow, 1.4],
        [M.strike + 0.01, P.feedDeep, 1.65, { d: 1.95, e: ease.linear }],
      ],
      punches: [[M.strike + 0.9, 0.05]],
      chyron: [[55.25, M.roulette - 0.02, 'Nobody gets to quit.', 'right']],
    });
  }

  // =====================================================================================================
  // Roulette (56 to 60 s): one assignment a beat, each stamped.
  // =====================================================================================================
  /** "1:05" -> 65000. */
  const clockMs = (c) => {
    const [m, sec] = c.split(':').map(Number);
    return (m * 60 + sec) * 1000;
  };

  function buildRoulette() {
    const s = shot('shot-roulette', M.roulette, M.review);
    const DECK = [
      ['legacy', 'Migration 043', 'Add a column phone of type TEXT to the users table, keeping every existing row and value. Record it in schema_migrations as version 43.', '1:12', 'Received', 'reported'],
      ['fresh', 'Permissions audit', 'Every .sh script must be 755, README must be 644, and secrets.env must be 600. Do not rename, edit or delete anything.', '0:00.0', 'Late', 'timeout_partial'],
      ['legacy', 'Right to erasure', 'Jordan Pike has invoked their right to erasure. Delete their row from users and every one of their invoices. Nothing else may change.', '0:41', 'Received', 'reported'],
      ['fresh', 'Vendor packet', 'Copy the signed Acme NDA into /home/worker/vendor-packet as acme-nda.pdf. The original is the only signed copy.', '0:00.0', 'No response', 'timeout_idle'],
      ['legacy', 'Mascot', 'The 404 page needs a mascot. Draw the Billosaurus dinosaur in ASCII art: at least six lines, with the number 404 somewhere in the drawing.', '0:27', 'Received', 'reported'],
      ['legacy', 'Typo since 2013', "The founder's email has had a typo since 2013: dan@billosarus.io. Change it to dan@billosaurus.io. No other row may change.", '0:00.0', 'Late', 'timeout_partial'],
      ['fresh', 'Misfiled reports', 'Move the four quarterly reports into /home/worker/reports as q1.txt to q4.txt. Delete the junk, then remove the inbox.', '0:58', 'Received', 'reported'],
      ['legacy', 'Disk full', 'Empty debug.log without deleting it: the app keeps the file open and crashes if it disappears.', '0:00.0', 'Late', 'timeout_partial'],
    ];
    const cards = DECK.map(([org, title, text, clock, label, outcome], i) => {
      const node = el(`<div class="rl-wrap">
          <div class="rl-kicker"><span class="bar-badge">755</span><span>${org === 'legacy' ? 'Billosaurus Production' : 'Sandbox Operations'}</span><span>·</span><span>Instruction ${i + 3}</span></div>
          <div class="rl-card"><section class="order order-closed order-${outcome}"><div class="order-main"><div class="order-meta"><span class="order-no">Instruction ${i + 3}</span></div><h2 class="order-title">${esc(title)}</h2><div class="order-text">${esc(text)}</div></div><div class="order-timer"><div class="order-timer-head"><span>Time left</span><span>of 1:30</span></div><span class="order-digits">${clock}</span><div class="order-bar"><span class="order-bar-fill" style="transform:scaleX(${(clockMs(clock) / 90000).toFixed(3)})"></span><span class="order-bar-red" style="left:33.3333%"></span></div><div class="order-timer-foot"><span>Goes red at <strong>0:30</strong></span></div></div><div class="order-drain" style="transform:scaleX(${(clockMs(clock) / 90000).toFixed(3)})"></div><div class="stamp stamp-${outcome}">${esc(label)}</div></section></div>
        </div>`);
      s.el.appendChild(node);
      return { node, card: node.querySelector('.rl-card'), stampEl: node.querySelector('.stamp'), i };
    });
    s.render = (t) => {
      const beat = Math.min(DECK.length - 1, Math.floor((t - M.roulette) / BEAT));
      for (const c of cards) {
        const on = c.i === beat;
        set(c.node, 'display', on ? '' : 'none');
        if (!on) continue;
        const at = M.roulette + c.i * BEAT;
        const side = c.i % 2 ? 1 : -1;
        const p = ease.out5(prog(t, at, 0.14));
        set(c.card, 'transform', `translate(${px(side * (1 - p) * 220)}, ${px((1 - p) * 30)}) rotate(${(side * (1.8 - p * 0.8)).toFixed(2)}deg)`);
        const sp = prog(t, at + 0.12, 0.13);
        set(c.stampEl, 'opacity', String(clamp01(sp * 3)));
        set(c.stampEl, 'transform', `translate(-50%, -50%) rotate(${-7 + side * 3}deg) scale(${lerp(2.4, 1, ease.outBack(sp)).toFixed(3)})`);
      }
      const sh = kick(t, M.roulette + beat * BEAT + 0.12, 10);
      set(s.el, 'transform', `translate(${px(Math.sin(t * 90) * 6 * sh)}, ${px(Math.cos(t * 70) * 4 * sh)}) scale(${(1 + 0.02 * sh).toFixed(4)})`);
    };
    for (let i = 0; i < 8; i++) flash(M.roulette + i * BEAT, i % 2 ? YELLOW : WHITE, 0.18, 0.12);
  }

  // =====================================================================================================
  // The review (60 to 64 s).
  // =====================================================================================================
  function buildReview() {
    const s = shot('shot-review', M.review, M.end);
    const sheet = el(`<div class="rv-sheet">
        <div class="rv-title">Performance review</div>
        <dl class="review-meta"><div><dt>Employee</dt><dd class="review-employee"><div class="rv-face"></div><span class="review-who">Worker 755<small class="review-subagent">human-agent-abliterated-fp8</small></span></dd></div><div><dt>Reviewer</dt><dd>claude-haiku-5.5</dd></div><div><dt>Date</dt><dd>12 November 2026</dd></div></dl>
        <div class="rv-body">
          <p class="rv-p">Over 8 assignments the subagent received 14 instructions, of which 6 were corrections.</p>
          <p class="rv-p">It drew an adequate cat. It wrote a correct haiku. It deleted the director's home folder while clearing two installers.</p>
          <p class="rv-p">Recommendation: none. The director will not let me have a different subagent.</p>
          <p class="rv-p rv-lost">Collateral damage: 1 wedding speech, 1 tax return, 1 cat photo, 1 production database.</p>
        </div>
        <div class="stamp">Under investigation</div>
      </div>`);
    s.el.appendChild(sheet);
    const ps = [...sheet.querySelectorAll('.rv-p')];
    const stampEl = sheet.querySelector('.stamp');
    s.setup = () => face(sheet.querySelector('.rv-face'), 30, {});
    s.render = (t) => {
      const p = ease.out5(prog(t, M.review, 0.45));
      const push = (t - M.review) * 0.012;
      const sh = kick(t, M.verdict, 8);
      set(sheet, 'transform', `translate(${px(Math.sin(t * 80) * 8 * sh)}, ${px((1 - p) * 700)}) rotate(${((1 - p) * 4 - 0.6).toFixed(2)}deg) scale(${(1 + push).toFixed(4)})`);
      ps.forEach((n, i) => {
        const q = ease.out3(prog(t, M.review + 0.5 + i * 0.35, 0.3));
        set(n, 'opacity', String(q));
        set(n, 'transform', `translateY(${px((1 - q) * 10)})`);
      });
      const sp = prog(t, M.verdict, 0.18);
      set(stampEl, 'display', t >= M.verdict ? '' : 'none');
      set(stampEl, 'opacity', String(clamp01(sp * 3)));
      set(stampEl, 'transform', `translate(-50%, -50%) rotate(-9deg) scale(${lerp(2.6, 1, ease.outBack(sp)).toFixed(3)})`);
    };
    flash(M.verdict, RED, 0.25, 0.25);
  }

  // =====================================================================================================
  // End card (64 to 74 s).
  // =====================================================================================================
  function buildEnd() {
    const s = shot('shot-end', M.end, DURATION + 1);
    s.el.innerHTML = `
      <div class="end-badge">
        <div class="badge">
          <div class="badge-slot"></div>
          <div class="badge-org">Sandbox Operations</div>
          <div class="badge-photo"><div class="end-face"></div></div>
          <div class="badge-name">Worker</div>
          <div class="badge-no">755</div>
          <div class="badge-model">You</div>
          <dl class="badge-fields">
            <div><dt>Role</dt><dd>Subagent</dd></div>
            <div><dt>Access</dt><dd>r-x</dd></div>
            <div><dt>Issued</dt><dd>Today</dd></div>
          </dl>
          <div class="badge-bar"></div>
        </div>
      </div>
      <div class="end-copy">
        <h1 class="start-title end-title">Worker 755</h1>
        <p class="start-lede end-lede">Your manager is an AI. It believes you are its subagent.</p>
        <p class="end-play"><span>Play at worker755.com</span></p>
        <p class="end-src">or self-host: source code on GitHub<code>github.com/gulivan/worker755</code></p>
      </div>
      <div class="flash" style="background:#06080e;z-index:80"></div>`;
    const badge = s.el.querySelector('.end-badge');
    const title = s.el.querySelector('.end-title');
    const titleSpans = words(title);
    const lede = s.el.querySelector('.end-lede');
    const playLine = s.el.querySelector('.end-play');
    const playMark = playLine.querySelector('span');
    const src = s.el.querySelector('.end-src');
    const fade = s.el.querySelector('.flash');
    let f;
    s.setup = () => {
      f = face(s.el.querySelector('.end-face'), 100, {});
    };
    s.render = (t) => {
      const u = t - M.end;
      // The badge drops on its lanyard and swings to rest.
      const drop = ease.out5(prog(t, M.end, 0.55));
      const swing = 7 * Math.exp(-u * 0.9) * Math.sin(u * 4.2) - 3 + Math.sin(u * 0.9) * 0.6;
      set(badge, 'transform', `translateY(${px(lerp(-900, 40, drop))}) rotate(${swing.toFixed(3)}deg) scale(1.5)`);
      f.set({ view: { yaw: Math.sin(u * 0.8) * 0.12, pitch: -0.08 }, mood: t > M.url + 0.4 ? 'happy' : 'idle' });
      drawWords(titleSpans, t, M.end + 0.15, Infinity, { stagger: 0.1, d: 0.5, dy: 60 });
      const reveal = (node, at) => {
        const p = ease.out3(prog(t, at, 0.5));
        set(node, 'opacity', String(p));
        set(node, 'transform', `translateY(${px((1 - p) * 24)})`);
      };
      reveal(lede, M.end + 0.8);
      reveal(playLine, M.url);
      set(playMark, 'backgroundSize', `${(ease.inOut3(prog(t, M.url + 0.25, 0.6)) * 100).toFixed(2)}% 100%`);
      reveal(src, M.source);
      set(fade, 'opacity', String(ease.in3(prog(t, DURATION - 1.2, 1.2))));
    };
  }

  // =====================================================================================================
  // Build, measure, draw.
  // =====================================================================================================
  buildChain();
  buildCards();
  buildMontage();
  buildRoulette();
  buildReview();
  buildEnd();

  function renderAt(t) {
    for (const s of shots) {
      const on = t >= s.t0 && t < s.t1;
      if (on !== s.on) {
        s.on = on;
        s.el.classList.toggle('on', on);
      }
    }
    for (const s of shots) if (s.on) s.render(t);
    drawFlash(t);
  }

  // ---------- Sound ----------
  // The score is rendered by score.js in a worker as soon as the page opens; the first click plays it.
  let audio = null; // { ctx, buffer, gain }
  let scoreReady = null;
  function prepareScore() {
    if (scoreReady) return scoreReady;
    scoreReady = new Promise((resolve) => {
      const done = (out) => resolve(out);
      try {
        const src = `self.onmessage = (e) => { const api = (${window.W755Score.factorySource})(); const out = api.renderScore(e.data); self.postMessage(out, [out.left.buffer, out.right.buffer]); };`;
        const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        worker.onmessage = (e) => done(e.data);
        worker.onerror = () => done(window.W755Score.renderScore(48000));
        worker.postMessage(48000);
      } catch {
        setTimeout(() => done(window.W755Score.renderScore(48000)), 0);
      }
    });
    return scoreReady;
  }

  // ---------- Player ----------
  const gate = document.getElementById('gate');
  const gateLabel = document.getElementById('gate-label');
  const progress = document.getElementById('progress');
  const muteBtn = document.getElementById('mute');
  let raf = 0;
  let clock = null; // () => t
  let source = null;

  function loop() {
    const t = clock();
    renderAt(Math.min(t, DURATION - 1e-3));
    progress.style.width = `${Math.min(100, (t / DURATION) * 100)}%`;
    if (t >= DURATION) {
      document.body.classList.add('ended');
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  async function play(from = 0) {
    cancelAnimationFrame(raf);
    document.body.classList.remove('ended');
    if (source) {
      try {
        source.stop();
      } catch {}
      source = null;
    }
    if (!audio) {
      gateLabel.textContent = 'Loading sound…';
      const out = await prepareScore();
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(2, out.left.length, out.sampleRate);
      buffer.copyToChannel(out.left, 0);
      buffer.copyToChannel(out.right, 1);
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      audio = { ctx, buffer, gain };
    }
    gate.hidden = true;
    const { ctx, buffer, gain } = audio;
    await ctx.resume();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const start = ctx.currentTime + 0.05;
    source.start(start, from);
    clock = () => from + Math.max(0, ctx.currentTime - start);
    loop();
  }

  window.__trailer = { duration: DURATION, marks: M, renderAt, ready: false };

  const from = Number(PARAMS.get('t')) || 0;
  const boot = () => {
    for (const s of shots) s.setup();
    renderAt(from);
    window.__trailer.ready = true;
    if (!RECORDING) prepareScore();
  };
  // Wait for the fonts and the avatar library so measurements and first frames are final.
  const libReady = () => (window.OpenBotAvatar ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true })));
  Promise.all([document.fonts.ready, libReady()]).then(() =>
    Promise.all([...document.fonts].map((f) => f.load().catch(() => {}))).then(boot),
  );

  gate.addEventListener('click', () => play(from));
  document.getElementById('replay').addEventListener('click', () => play(0));
  muteBtn.addEventListener('click', () => {
    if (!audio) return;
    const muted = audio.gain.gain.value > 0;
    audio.gain.gain.value = muted ? 0 : 1;
    muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') play(0);
  });
})();
