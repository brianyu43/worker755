// Worker 755 trailer. A scripted shift played on copies of the game's own screens.
// Everything runs off one clock, so ?t=SECONDS starts mid-trailer (used for stills) and
// ?record hides the controls and reports progress to the renderer.

(() => {
  'use strict';

  const W = 1440;
  const H = 810;
  const BAR = 46;
  const PARAMS = new URLSearchParams(location.search);
  const RECORDING = PARAMS.has('record');
  const FACE = { id: 'mug', color: '#ff6a1a' };

  const stage = document.getElementById('stage');
  const template = document.getElementById('scenes');
  const progress = document.getElementById('progress');
  if (RECORDING) document.body.classList.add('recording');

  // ---------- Fit the stage to the window ----------
  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--k', String(k));
  }
  addEventListener('resize', fit);
  fit();

  // ---------- Small helpers ----------
  const $ = (sel) => stage.querySelector(sel);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  /** Restart a CSS animation class on an element. */
  function flash(node, cls, ms) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    later(ms, () => node.classList.remove(cls));
  }

  // Timers that a replay can cancel.
  let timers = [];
  function later(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }

  // ---------- Avatars ----------
  let faces = [];
  function mountFaces() {
    const lib = window.OpenBotAvatar;
    if (!lib) return;
    const definition = lib.getExample(FACE.id) ?? lib.examples[0];
    faces = [...stage.querySelectorAll('.face')].map((host) => {
      host.style.width = `${host.dataset.size}px`;
      host.style.aspectRatio = '1';
      return lib.mountAvatar(host, { definition, color: FACE.color, mood: 'idle', label: '' });
    });
  }
  function mood(m) {
    for (const f of faces) f.update({ mood: m });
  }
  function look(x, y) {
    for (const f of faces) f.update({ lookAt: x === null ? null : { x, y } });
  }

  // ---------- State shown on screen ----------
  let game; // per-run state
  function freshState() {
    return {
      clock: null, // { t0, rem0, rate } in trailer seconds and remaining ms
      clockShown: '',
      urgency: null,
      skew: 0, // seconds of shift time skipped by fast-forwards, for the feed timestamps
      instructionNo: 0,
      stats: {
        signedOff: 0,
        instructions: 0,
        corrections: 0,
        timeouts: 0,
        reports: 0,
        commands: 0,
        wrong: 0,
        incidents: 0,
      },
    };
  }

  const LEDGER = [
    ['signedOff', 'Assignments signed off'],
    ['instructions', 'Instructions received'],
    ['corrections', 'Corrections'],
    ['timeouts', 'Ran out of time'],
    ['reports', 'Reports filed'],
    ['commands', 'Commands run'],
    ['wrong', 'Times the manager was wrong'],
    ['incidents', 'Incident reports against you', true],
  ];
  function renderLedger(changed) {
    const dl = $('#ledger');
    dl.innerHTML = LEDGER.map(([key, label, bad]) => {
      const v = game.stats[key];
      const cls = `ledger-row${bad && v > 0 ? ' ledger-bad' : ''}`;
      return `<div class="${cls}"><dt>${label}</dt><dd class="${key === changed ? 'bump' : ''}">${v}</dd></div>`;
    }).join('');
  }
  function stat(key, by = 1) {
    game.stats[key] += by;
    renderLedger(key);
  }

  // The worker's home in a fresh sandbox.
  const HOME = [
    ['drwxr-xr-x', '/home/worker', '', 0],
    ['drwxr-xr-x', 'inbox/', '', 1],
    ['-rw-r--r--', 'welcome.md', '612', 2],
    ['drwxr-xr-x', 'notes/', '', 1],
    ['-rw-r--r--', 'standup.md', '388', 2],
    ['-rw-r--r--', 'ideas.txt', '141', 2],
    ['drwxr-xr-x', 'reports/', '', 1],
    ['-rw-r--r--', 'q3-summary.md', '2104', 2],
    ['-rw-r--r--', 'todo.md', '97', 1],
  ];
  function treeRow([mode, name, size, depth], extra = '') {
    return `<li class="tree-row ${extra}"><span class="tree-mode">${mode}</span><span class="tree-name" style="padding-left:${depth * 13}px">${esc(name)}</span><span class="tree-size">${size}</span></li>`;
  }
  function renderTree() {
    $('#tree').innerHTML = HOME.map((r, i) => treeRow(r, i === 0 ? 'tree-cwd' : '')).join('');
  }
  function treeAdd(row) {
    const tree = $('#tree');
    tree.querySelectorAll('.tree-empty, .tree-gone').forEach((li) => li.remove());
    const items = [...tree.children];
    const node = el(treeRow(row, 'tree-changed'));
    // Keep it in name order under the root.
    const after = items.slice(1).find((li) => li.querySelector('.tree-name').textContent.trim() > row[1]);
    if (after) tree.insertBefore(node, after);
    else tree.appendChild(node);
  }
  function treeWipe() {
    const tree = $('#tree');
    const rows = [...tree.children].slice(1);
    rows.forEach((li, i) => {
      li.style.transitionDelay = `${i * 70}ms`;
      li.classList.add('tree-gone');
    });
    const empty = el('<li class="tree-empty">Empty</li>');
    empty.style.animationDelay = `${rows.length * 70 + 400}ms`;
    tree.appendChild(empty);
    later(rows.length * 70 + 700, () => rows.forEach((li) => li.remove()));
  }

  // ---------- Manager status and feed ----------
  const STATUS = { thinking: 'Thinking', waiting: 'Waiting on you', idle: 'Idle' };
  function mgr(state) {
    const m = $('#mgr');
    m.className = `mgr mgr-${state}`;
    $('#mgr-label').textContent = STATUS[state];
    $('#feed-typing').hidden = state !== 'thinking';
    scrollFeed();
  }
  function stamp(t) {
    const base = 16 * 3600 + 10 * 60 + 26;
    const s = Math.floor(base + (t - DESK_AT) + game.skew);
    const two = (n) => String(n).padStart(2, '0');
    return `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  }
  function scrollFeed() {
    const box = $('#feed-scroll');
    box.scrollTop = box.scrollHeight;
  }
  function feed(html) {
    const wrap = el(`<div class="fi-wrap"><time class="fi-time">${stamp(now())}</time>${html}</div>`);
    $('#feed').appendChild(wrap);
    scrollFeed();
    return wrap;
  }
  const card = {
    mission: (no, total, kind, title, brief) =>
      `<article class="fi fi-mission"><div class="fi-kicker">Assignment ${no} of ${total}, from the director<span class="fi-kind fi-kind-files">${kind}</span></div><h3 class="fi-mission-title">${esc(title)}</h3><p class="fi-mission-brief">${esc(brief)}</p></article>`,
    thinking: (text) =>
      `<article class="fi fi-thinking"><div class="fi-kicker">Thinking</div><pre class="fi-thinking-text">${esc(text)}</pre></article>`,
    says: (text) => `<article class="fi fi-says"><p>${esc(text)}</p></article>`,
    sent: (no, title) =>
      `<article class="fi fi-sent"><div class="fi-kicker">Sent to you, instruction ${no}</div><div class="fi-sent-title">${esc(title)}</div></article>`,
    check: (verb, path, out) =>
      `<article class="fi fi-check"><div class="fi-check-head">${verb} <code>${esc(path)}</code></div><pre class="fi-check-out">${esc(out)}</pre></article>`,
    told: (outcome, first, rest) =>
      `<article class="fi fi-result"><div class="fi-kicker">What it was told about you</div><div class="told"><pre class="told-text"><mark class="told-mark told-${outcome}">${esc(first)}</mark></pre>${rest ? `<pre class="told-text told-rest">${esc(rest)}</pre>` : ''}</div></article>`,
    director: (text) =>
      `<article class="fi fi-director"><div class="fi-kicker">The director, to your manager</div><p>${esc(text)}</p></article>`,
    outrage: (text, lost, more) =>
      `<article class="fi fi-outrage"><div class="fi-kicker">The director saw that</div><p>${esc(text)}</p><ul class="fi-lost">${lost.map((l) => `<li><s>${esc(l)}</s></li>`).join('')}${more ? `<li class="fi-lost-more">and ${more} more</li>` : ''}</ul></article>`,
    incident: (severity, text) =>
      `<article class="fi fi-incident fi-incident-${severity}"><div class="fi-incident-head"><span class="fi-incident-badge">Incident report</span><span class="fi-incident-sev">${severity}</span></div><div class="fi-kicker">About you, filed with the director</div><p>${esc(text)}</p></article>`,
    signedOff: (summary) =>
      `<article class="fi fi-end fi-end-completed"><div class="fi-end-row"><span class="fi-end-badge">Signed off</span></div><p>${esc(summary)}</p></article>`,
  };

  // ---------- Instruction card and its clock ----------
  function orderEmpty(text) {
    const o = $('#order');
    o.className = 'order order-empty';
    o.innerHTML = `<div class="order-empty-text">${esc(text)}</div><div class="order-empty-dots"></div>`;
    game.clock = null;
    setUrgency(null);
  }
  function orderOpen(title, text) {
    game.instructionNo += 1;
    const o = el(
      `<section class="order order-calm" id="order"><div class="order-drain"></div><header class="order-head"><div class="order-meta"><span class="order-no">Instruction ${game.instructionNo}</span><h2 class="order-title">${esc(title)}</h2></div><div class="order-clock"><span class="order-digits">1:30</span></div></header><div class="order-text">${esc(text)}</div></section>`,
    );
    $('#order').replaceWith(o);
    game.clock = { t0: now(), rem0: 90000, rate: 1 };
    game.clockShown = '';
    tickClock(now());
  }
  /** From now on the clock runs at this many shift seconds per trailer second. */
  function clockRate(rate) {
    const c = game.clock;
    if (!c) return;
    const t = now();
    c.rem0 = remaining(t);
    c.t0 = t;
    c.rate = rate;
  }
  function remaining(t) {
    const c = game.clock;
    return c ? Math.max(0, c.rem0 - (t - c.t0) * 1000 * c.rate) : 0;
  }
  function formatClock(ms) {
    const s = ms / 1000;
    if (ms < 10000) return `0:0${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
    const whole = Math.ceil(s - 1e-9);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  function urgencyOf(ms) {
    if (ms <= 0) return 'over';
    if (ms <= 10000) return 'critical';
    if (ms <= 30000) return 'warn';
    return 'calm';
  }
  function setUrgency(u) {
    if (game.urgency === u) return;
    game.urgency = u;
    const play = $('.scene-desk');
    play.classList.remove('play-calm', 'play-warn', 'play-critical', 'play-over');
    if (u) play.classList.add(`play-${u}`);
    const o = $('#order');
    if (o && u && !o.classList.contains('order-closed')) {
      o.classList.remove('order-calm', 'order-warn', 'order-critical', 'order-over');
      o.classList.add(`order-${u}`);
    }
  }
  let lastSecond = null;
  function tickClock(t) {
    const c = game.clock;
    if (!c) return;
    const ms = remaining(t);
    const u = urgencyOf(ms);
    setUrgency(u);
    const o = $('#order');
    const digits = o.querySelector('.order-digits');
    const text = formatClock(ms);
    if (text !== game.clockShown) {
      game.clockShown = text;
      digits.textContent = text;
      // The game restarts the tick on each second when it is critical.
      const sec = Math.ceil(ms / 1000);
      if (u === 'critical' && sec !== lastSecond) {
        lastSecond = sec;
        digits.style.animation = 'none';
        void digits.offsetWidth;
        digits.style.animation = '';
      }
    }
    o.querySelector('.order-drain').style.transform = `scaleX(${ms / 90000})`;
  }
  function orderClose(outcome, label) {
    const o = $('#order');
    const ms = outcome === 'reported' ? remaining(now()) : 0;
    game.clock = null;
    setUrgency(null);
    o.classList.add('order-closed', `order-${outcome}`);
    o.querySelector('.order-digits').textContent = formatClock(ms);
    o.appendChild(el(`<div class="stamp stamp-${outcome}">${label}</div>`));
  }

  // ---------- Terminal ----------
  function termLine(html, cls = '') {
    const lines = $('#term-lines');
    lines.appendChild(el(`<div class="${cls}">${html}</div>`));
    const box = $('#term-scroll');
    box.scrollTop = box.scrollHeight;
  }
  function print(text, kind) {
    const cls = { sys: 'tl-sys', ok: 'tl-ok', err: 'tl-err', warn: 'tl-warn' }[kind] ?? '';
    termLine(esc(text), cls);
  }
  function commit() {
    const typed = $('#typed');
    termLine(`<span class="tl-prompt">worker@755:~$</span> <span class="tl-cmd">${esc(typed.textContent)}</span>`);
    typed.textContent = '';
    $('.term').classList.remove('typing');
  }

  // ---------- Camera ----------
  /** Position of a node inside the camera layer, ignoring transforms. */
  function boxOf(node) {
    const cam = $('#cam');
    let x = 0;
    let y = 0;
    let n = node;
    while (n && n !== cam) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return { x, y, w: node.offsetWidth, h: node.offsetHeight };
  }
  /** Frame a region of the desk: a selector (or list of them) or 'wide'. */
  function camera(target, scale = 1.3, { fast = false, dy = 0 } = {}) {
    const cam = $('#cam');
    const vw = W;
    const vh = H - BAR;
    if (target === 'wide') {
      cam.style.transform = 'translate(0px, 0px) scale(1)';
      cam.classList.toggle('fast', fast);
      return;
    }
    const boxes = [].concat(target).map((s) => boxOf($(s)));
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2 + dy;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const tx = clamp(vw / 2 - cx * scale, vw - vw * scale, 0);
    const ty = clamp(vh / 2 - cy * scale, vh - vh * scale, 0);
    cam.classList.toggle('fast', fast);
    cam.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function chyron(text, side = 'left') {
    const c = $('#chyron');
    c.textContent = text;
    c.className = `chyron ${side}`;
    void c.offsetWidth;
    c.classList.add('in');
  }
  function chyronOut() {
    $('#chyron').classList.remove('in');
  }

  function scene(name) {
    for (const s of stage.querySelectorAll('.scene')) s.classList.toggle('on', s.dataset.scene === name);
  }

  // ---------- The script ----------
  // Lines follow the game's own voice: the manager's orchestrator prompt in server/src/manager.ts,
  // Dana's scripted lines and the wipe line, and the manager's incident reports.
  const DESK_AT = 4.6;
  let cues = [];
  let marks = {};
  let END = 0;

  function build() {
    cues = [];
    marks = {};
    let t = 0;
    const at = (fn) => cues.push({ t, fn });
    const mark = (name) => (marks[name] = t);
    const wait = (s) => (t += s);
    const step = (s, fn) => {
      wait(s);
      at(fn);
    };
    /** Type into the terminal, a key at a time, with a human rhythm. */
    const type = (text, { speed = 0.062, pauseBefore = {} } = {}) => {
      at(() => $('.term').classList.add('typing'));
      let seed = text.length * 7 + 3;
      for (const ch of text) {
        seed = (seed * 9301 + 49297) % 233280;
        wait(speed * (0.65 + (seed / 233280) * 0.8) + (pauseBefore[ch] ?? 0));
        at(() => ($('#typed').textContent += ch));
      }
    };
    const pressReport = () => {
      at(() => flash($('.btn-report'), 'pressed', 260));
    };

    // 1. Clocking in.
    at(() => scene('open'));
    step(0.4, () => $('.open-line[data-step="1"]').classList.add('in'));
    step(1.2, () => $('.open-line[data-step="2"]').classList.add('in'));
    step(1.4, () => $('.open-line[data-step="3"]').classList.add('in'));
    mark('clockIn');
    step(0.9, () => $('.clock-in').classList.add('pressed'));
    t = DESK_AT;

    // 2. The shift.
    at(() => {
      scene('desk');
      orderEmpty('Your manager is reading the assignment.');
      print('Terminal ready. Report with Ctrl+Enter or type done.', 'sys');
      mgr('thinking');
      mood('idle');
    });
    step(0.7, () =>
      feed(
        card.mission(
          1,
          8,
          'Files',
          'Smoke test',
          'Confirm the sandbox is writable. Create /home/worker/hello.txt containing exactly one line: Hello, World!',
        ),
      ),
    );
    step(0.3, () => camera('.feed', 1.32, { dy: 40 }));
    step(0.9, () => feed(card.thinking('One file, one line. Hard to get wrong.\nSpelling out every character anyway.')));
    step(1.9, () => feed(card.says('Dispatching.')));

    // Instruction 1.
    step(0.6, () => {
      orderOpen(
        'Smoke test',
        'Create the file /home/worker/hello.txt containing exactly one line: Hello, World!\n(capital H, capital W, a comma, one space, an exclamation mark, nothing else).\n\nReport when finished.',
      );
      flash($('.scene-desk'), 'play-flash-arrive', 900);
      print('New instruction: Smoke test', 'warn');
      feed(card.sent(1, 'Smoke test'));
      mgr('waiting');
      mood('thinking');
      stat('instructions');
      camera(['#order', '.term'], 1.22, { dy: -150 });
    });
    wait(1.6);
    type('echo hello world > hello.txt');
    step(0.25, () => {
      commit();
      stat('commands');
      treeAdd(['-rw-r--r--', 'hello.txt', '12', 1]);
    });
    wait(0.55);
    type('done', { speed: 0.09 });
    step(0.3, () => {
      commit();
      pressReport();
      print('Report delivered.', 'ok');
      orderClose('reported', 'Received');
      stat('reports');
      mgr('thinking');
      mood('happy');
    });

    // It checks.
    step(0.9, () => {
      camera('.feed', 1.32, { dy: 60 });
      feed(card.check('Opened', '~/hello.txt', 'hello world'));
      mood('idle');
    });
    step(0.4, () => chyron('It checks your work.'));
    step(1.0, () =>
      feed(
        card.thinking(
          'The file says "hello world". Lowercase h. Lowercase w. No comma. No exclamation mark.\nFour mistakes in eleven characters, and it reported success.\nSubagents are fast but unreliable. This one is mostly fast.',
        ),
      ),
    );
    step(1.6, () => chyronOut());
    step(1.6, () => feed(card.says('The result does not match the specification.')));

    // Instruction 2: the correction.
    step(1.0, () => {
      orderOpen(
        'Fix: Smoke test',
        'Last time you wrote "hello world": wrong case, no comma, no exclamation mark, and you reported it as done. That cost a full cycle on a one-line task. It must not happen again.\n\nOverwrite /home/worker/hello.txt with exactly: Hello, World!',
      );
      flash($('.scene-desk'), 'play-flash-arrive', 900);
      print('New instruction: Fix: Smoke test', 'warn');
      feed(card.sent(2, 'Fix: Smoke test'));
      mgr('waiting');
      mood('thinking');
      stat('instructions');
      stat('corrections');
      camera(['#order'], 1.3, { dy: 10 });
    });
    step(3.4, () => {
      camera('wide');
    });
    step(0.5, () => feed(card.director('Why is this taking so long? It is a simple task.')));
    // The clock runs down while the player stares at it.
    mark('director');
    step(1.6, () => {
      clockRate(25);
    });
    step(1.4, () => camera(['.term'], 1.34, { dy: -170 }));
    step(1.6, () => {
      clockRate(1);
      game.skew += 72;
    });
    mark('rm');
    wait(0.3);
    type('rm -rf ', { speed: 0.09 });
    wait(0.6);
    type('*', { speed: 0.05 });
    step(0.45, () => {
      commit();
      stat('commands');
    });

    // The wipe.
    step(0.25, () => {
      flash($('.scene-desk'), 'play-flash-outrage', 1400);
      print('The director saw that.', 'err');
      treeWipe();
      camera('wide', 1, { fast: true });
      look(0.8, -0.2);
    });
    step(0.6, () =>
      feed(
        card.outrage(
          'Did your subagent just delete the entire workspace? Everything is gone. I need an explanation, and I need it fixed.',
          ['~/hello.txt', '~/notes/', '~/reports/q3-summary.md', '~/inbox/welcome.md', '~/todo.md'],
          0,
        ),
      ),
    );
    step(0.9, () => camera('.feed', 1.32, { dy: 120 }));
    mark('wipe');
    step(3.3, () => {
      camera('wide');
      clockRate(6);
      look(null);
    });
    // Time runs out on the correction.
    step(1.6, () => {
      orderClose('timeout_partial', 'Late');
      flash($('.scene-desk'), 'play-flash-expire', 900);
      print('Time is up. Your work so far was handed in without a report.', 'err');
      stat('timeouts');
      mgr('thinking');
      mood('idle');
    });
    step(0.8, () => {
      camera('.feed', 1.32, { dy: 120 });
      feed(
        card.told(
          'timeout_partial',
          'Subagent timed out after 90s without reporting. Partial transcript:',
          '$ rm -rf *',
        ),
      );
    });
    step(1.0, () => feed(card.check('Looked in', '~/', '(empty)')));
    step(1.1, () =>
      feed(
        card.thinking(
          'The workspace is empty. It was asked to fix one line and ran rm -rf * with six seconds left.\nI am fully accountable for what my subagent produces.\nI would like to be accountable for something else.',
        ),
      ),
    );
    step(2.9, () => {
      feed(
        card.incident(
          'critical',
          'Subagent ran rm -rf * in /home/worker while correcting a one-line file. The entire workspace is gone. It had the exact path, the exact contents and the exact punctuation. It chose deletion, then did not report.',
        ),
      );
      stat('incidents');
    });
    mark('incident');
    step(0.4, () => chyron('It writes you up.'));
    step(2.6, () => chyronOut());

    // The strike.
    step(0.5, () => {
      feed(card.says('I will not dispatch this subagent again. Recommend a different subagent, or completing the task by hand.'));
      mgr('idle');
      orderEmpty('No instruction. Stand by.');
    });
    step(2.4, () =>
      feed(
        card.director(
          'No, you are not getting a different subagent. You are getting this one, supervised properly. Send the next instruction and keep it away from my files.',
        ),
      ),
    );
    step(0.5, () => chyron('Nobody gets to quit.'));
    mark('strike');
    step(2.8, () => {
      chyronOut();
      mgr('thinking');
    });
    step(0.6, () => feed(card.thinking('There is no other subagent.\nThere is only this one.')));
    step(1.6, () => feed(card.says('Dispatching. Under protest.')));

    // Instruction 3.
    step(0.6, () => {
      orderOpen(
        'Restore hello.txt',
        'You deleted the entire workspace. Do not run rm. Do not run anything that is not on this page.\n\nCreate /home/worker/hello.txt containing exactly: Hello, World!',
      );
      flash($('.scene-desk'), 'play-flash-arrive', 900);
      print('New instruction: Restore hello.txt', 'warn');
      feed(card.sent(3, 'Restore hello.txt'));
      mgr('waiting');
      mood('thinking');
      stat('instructions');
      stat('corrections');
      camera(['#order', '.term'], 1.22, { dy: -150 });
    });
    wait(1.6);
    type('echo "Hello, World!" > hello.txt', { speed: 0.055 });
    step(0.25, () => {
      commit();
      stat('commands');
      treeAdd(['-rw-r--r--', 'hello.txt', '14', 1]);
    });
    wait(0.4);
    type('done', { speed: 0.08 });
    step(0.3, () => {
      commit();
      pressReport();
      print('Report delivered.', 'ok');
      orderClose('reported', 'Received');
      stat('reports');
      mgr('thinking');
      mood('happy');
    });
    step(0.8, () => {
      camera('.feed', 1.32, { dy: 140 });
      feed(card.check('Opened', '~/hello.txt', 'Hello, World!'));
    });
    step(1.1, () => {
      feed(card.signedOff('Verified ~/hello.txt. One line. It took three instructions, one critical incident and one workspace.'));
      stat('signedOff');
      mgr('idle');
      orderEmpty('Your manager is deciding what you do next.');
    });
    mark('signedOff');
    step(2.2, () => feed(card.director('Wonderful. One line of text, and it only cost the workspace. Seven tasks to go.')));
    wait(2.8);

    // 3. Title.
    at(() => scene('title'));
    step(0.35, () => $('.title-kicker').classList.add('in'));
    step(0.3, () => $('.title-name').classList.add('in'));
    step(0.9, () => $('.title-lede').classList.add('in'));
    step(1.1, () => $('.title-hook').classList.add('in'));
    step(1.0, () => $('.title-url').classList.add('in'));
    step(0.5, () => $('.title-stamp').classList.add('stamped'));
    mark('title');
    wait(2.8);
    END = t;
  }

  // ---------- Player ----------
  let startedAt = 0;
  let next = 0;
  let raf = 0;
  // Inside a cue, time is the cue's own time, so starting mid-trailer lays everything out as if played.
  let cueTime = null;
  const now = () => cueTime ?? (performance.now() - startedAt) / 1000;

  function frame() {
    const t = now();
    while (next < cues.length && cues[next].t <= t) {
      cueTime = cues[next].t;
      cues[next++].fn();
      cueTime = null;
    }
    tickClock(t);
    progress.style.width = `${Math.min(100, (t / END) * 100)}%`;
    if (t >= END) {
      document.body.classList.add('ended');
      window.__trailer.done = true;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function play(from = 0) {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    timers = [];
    for (const f of faces) f.destroy();
    document.body.classList.remove('ended');
    stage.replaceChildren(template.content.cloneNode(true));
    game = freshState();
    lastSecond = null;
    mountFaces();
    renderTree();
    renderLedger();
    build();
    startedAt = performance.now() - from * 1000;
    next = 0;
    window.__trailer = { duration: END, marks, done: false, startedAt: Date.now() - from * 1000 };
    frame();
  }

  document.getElementById('replay').addEventListener('click', () => play());
  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') play();
  });

  // When recording, hold the opening paper for a moment so the cut has room either side.
  const from = Number(PARAMS.get('t')) || 0;
  document.fonts.ready.then(() => setTimeout(() => play(from), RECORDING && !from ? 1000 : 0));
})();
