# Worker 755 trailer

A 74-second trailer with its own soundtrack. It runs in three parts:

1. **The chain of calls** (0–24 s). On a dark board, a human hands work to an agent. The agent drops tickets onto subagents riding a conveyor belt, the subagents send reports back up, and the agent reports to the human. Then box 755 stops, the boxes behind it pile up, it glows, and it turns round to face you. The narration runs "Humans used to call agents. / Agents call subagents. / Subagents report back to agents. / Agents report back to humans. / But what if one subagent, Worker 755, became sentient?"
2. **The question** (24–32 s). Black cards land on the hits: "What if it were you? / Would you obey? / Or go rogue? / Try different scenarios.", with the game's two workplaces, Fresh sandbox and Legacy production.
3. **The montage** (32–64 s). Quick cuts on the beat through the game's own screens and missions: the *Birthday card* cat drawn in nano and signed off; *Backup first*, where `mv` is used instead of `cp` and the production database vanishes; *Smoke test*, with "hello world"; the director's escalating messages; *Config drift* timing out; `rm -rf *` in the director's home folder during *Disk space*; a critical incident report; `LIKE '%test%'` deleting Greatest Pizza during *Test accounts*; a clean *Release haiku*; the manager trying to quit; eight more assignments stamped one per beat; and the performance review stamped *Under investigation*. It ends on the card: "Play at worker755.com, or self-host: source code on GitHub".

Mission titles, briefs, the director's lines and the damage reactions are taken from the game (`server/src/i18n/en.ts`).

## Watching it

Open `trailer/index.html` in a browser. It needs no server or build step. Click **Play with sound**. Hover the bottom edge for Replay and mute, or press `R` to replay. Add `?t=30` to the address to start at 30 seconds.

## Rendering

```sh
npm run setup                          # once, for the Playwright in web/node_modules
node trailer/render.mjs                # trailer/trailer.mp4 and trailer/trailer.webm, 1920x1080, 60 fps
node trailer/render.mjs --fps 30       # the same at 30 fps
node trailer/render.mjs --from 30 --to 40   # a slice, for checking a cut
node trailer/render.mjs stills         # trailer/stills/*.png
node trailer/render.mjs wav            # trailer/score.wav, the soundtrack alone
```

There is no screen recording. `trailer.js` draws any moment on request: `window.__trailer.renderAt(t)` sets every position, opacity, camera move and line of text from `t` alone. Nothing on the stage uses timers, CSS animations or CSS transitions; `trailer.css` switches them all off inside the stage. `render.mjs` opens several headless Chromium pages, has each one draw every Nth frame and screenshot it, and feeds the frames to ffmpeg in order together with the soundtrack. Because no step depends on how fast the machine runs, every frame is a new moment, and none are dropped or repeated. A full 60 fps render takes about 10 minutes on 8 cores (most of it is Chromium's screenshots, at about 9 frames a second), plus a few minutes for the WebM. Rendered videos and `score.wav` are ignored by git.

To change the trailer, edit `trailer.js`. Each shot is built by one function. The montage shots are `desk({...})` calls that script the game's desktop play screen (files and record on the left, the work order, terminal and editor in the middle, the manager on the right): what each part shows and when, plus camera framing, shakes and captions. The markup follows the game's components, so when the play screen changes, update `desk()` to match. Camera targets (`P`) are points inside elements, such as the terminal or the timer, so they follow the layout rather than fixed pixels. All times come from `MARKS` in `score.js`.

## The music

`score.js` holds the timeline marks and the soundtrack. The music is synthesized from scratch in plain JavaScript, so there are no samples and nothing to license: oscillators, filtered noise, envelopes, a small Schroeder reverb, and a soft limiter that peaks at −1 dBFS. It is written at 120 BPM, one beat every 0.5 s, so that the cuts land on the beat:

- 0–16 s: cheerful corporate muzak. A D major marimba arpeggio over a soft pad, the wall clock ticking, and a bass pulse and kick that build.
- 16–24 s: when 755 stops, the muzak sags and slows like a tape stopping. A low drone opens up underneath, and a riser leads to the turn.
- 24–32 s: a hit on each question, with a dissonant stab on "rogue", then a snare roll and riser, and a beat of silence.
- 32–60 s: the drop. Four on the floor, claps, hats, a distorted D minor bass riff, and the muzak motif played again in minor. Impacts land on the wipes, the incident and the pizza, and a stamp lands on every beat of the roulette.
- 60–74 s: the beat falls away, the muzak comes back alone, one last hit lands on the title, and the end fades out.

Node renders it to a 48 kHz WAV for the video (`render.mjs`, or `node trailer/render.mjs wav`). The page runs the same `renderScore()` in a Web Worker as soon as it opens and plays the result after the click, so the browser and the video have identical sound.

## Files

- `index.html`, `trailer.css`, `trailer.js`: the page.
- `score.js`: the timeline marks and the synthesizer, shared by the page and the renderer.
- `render.mjs`: frame-by-frame rendering, stills and the WAV.
- `game.css`: `web/src/styles.css` as is, after the trailer's own `@font-face` rules. Refresh it with `{ head -23 trailer/game.css; cat web/src/styles.css; } > /tmp/g && mv /tmp/g trailer/game.css` when the game's styles change. `trailer.css` only adds what the trailer needs on top (camera, captions, carets, the roulette and review cards).
- `fonts/`: Archivo and JetBrains Mono (OFL, licences included).
- `vendor/open-bot-avatar.js`: the game's avatar library (MIT), bundled into a single script so the page also works from `file://`. The trailer uses its still mode, so every avatar frame depends only on the mood and head angle it is given.
