# Talking Cat

A browser toy in the spirit of Talking Tom, built for a 6–7" Boox E Ink tablet.
Tap **TALK**, say something, and the cat repeats it back in a silly voice while
its mouth moves. Poking it in different places gets different reactions.

No build step, no dependencies, no audio or image files — the cat is SVG and
every sound is synthesised with the Web Audio API. The whole thing is about
40 KB and works offline once loaded.

## Deploying to GitHub Pages

The repo root is the site. `.github/workflows/pages.yml` publishes it on every
push to `main`, and it is live at:

**https://kiran-maturi.github.io/talkingcat/**

Pages has to be told to take its content from Actions once, in the repo UI:
**Settings → Pages → Source: GitHub Actions**. After that, deploying is just:

```bash
git add -A && git commit -m "..." && git push
```

HTTPS is not optional here — `getUserMedia` refuses to run on plain HTTP or
`file://`, so opening `index.html` off the device's storage will load the app
but the microphone will never work. GitHub Pages gives you HTTPS for free.

To serve it from your own box instead, copy the folder behind any web server
with a TLS certificate; there is nothing to configure.

Bump `CACHE` in `sw.js` when you deploy a change, or devices that already
installed the app will keep serving the old version from their cache.

## On the Boox

1. Open **https://kiran-maturi.github.io/talkingcat/** in the Boox browser
   (NeoBrowser or Chrome).
2. Tap **TALK** once and **Allow** the microphone. Chromium remembers the
   grant per origin, so this is a one-time thing.
3. Browser menu → **Add to Home screen**. It installs as a PWA: full screen,
   no address bar, and the service worker keeps it working with wifi off.

Add the app to the device's **power-saving whitelist** if the screen keeps
dropping out — Boox firmware is aggressive, and the wake lock only helps while
the browser is allowed to run.

### If something doesn't work

`?demo=1` skips the microphone and plays a synthesised clip instead, so you can
confirm the speaker and the mouth animation work before dealing with
permissions:

```
https://kiran-maturi.github.io/talkingcat/?demo=1
```

The gear icon opens Settings, which prints a diagnostics block — secure
context, capture backend, sample rate, audio state, user agent. That is the
first thing to read if the cat can't hear anything.

## The E Ink side

E Ink mode is on automatically when the user agent mentions Onyx/Boox, or when
the browser reports `(update: slow)`. Force it either way with `?eink=1` /
`?eink=0`, or from Settings — the choice is remembered.

What it changes:

- **Pure black on white.** No greys, no shadows, no gradients, no transitions.
- **Frame rate is deliberately low.** The mouth redraws at most every 180 ms;
  faster than about 5 fps and an E Ink panel renders a smear rather than a
  moving mouth.
- **The idle cat is sleepy on purpose.** Every blink is a partial refresh that
  leaves a faint ghost, so idle animation is rare and small.
- **Ghost busting.** After every ~16 visual changes (configurable, and always
  after a burst of talking) the screen flashes solid black for 150 ms, which
  forces the panel controller into a full refresh. The ↻ button does it on
  demand.
- **64 px minimum touch targets** everywhere.

## Tap zones

| Zone | Reaction |
|---|---|
| Ears | giggle, ears flatten |
| Top of head | purr, happy eyes |
| Face | startled "Boop!" |
| Belly | giggle |
| Tail | startled "Mrrow!" |
| Front paws | waves a paw, "Hi!" |

The **Voice** button cycles Kitten / Cat / Big Cat / Robot / Echo and replays
the last recording in the new voice. **Again** replays without re-recording.

## Files

```
index.html      markup and the settings sheet
styles.css      1-bit palette by default; .colour on <html> swaps it
js/eink.js      display-mode detection, frame pacing, full-refresh flash
js/cat.js       the cat as SVG; every pose variant lives in the DOM and
                posing just toggles display, so a frame costs 1–2 writes
js/audio.js     mic capture (AudioWorklet, ScriptProcessor fallback),
                silence trimming, voice effects, synthesised cat noises
js/app.js       state machine, tap reactions, settings, wake lock
sw.js           cache-first service worker (bump CACHE when you deploy)
```

### Tweaking the cat

All the art is in the `MARKUP` array in `js/cat.js`, on a 400×520 viewBox.
Poses are combinations of `ears` (up/perked/flat), `eyes`
(open/wide/happy/blink), `mouth` (0–3), `tail` (0–2), `arms` (down/wave) and
`blush`. To add a reaction, add an entry to `REACTIONS` in `js/app.js` and a
matching tap zone `<rect data-zone="...">` at the end of `MARKUP`.

Sounds live in `js/audio.js` under `Sound`. `meow()` is the interesting one —
a sawtooth with a pitch contour, vibrato, and two sweeping bandpass filters
standing in for formants.

## Notes

- Talking Tom is Outfit7's product. This is an independent toy for one family,
  with its own cat.
- Recordings never leave the device. There is no server, no upload, and
  nothing is written to storage — the audio lives in memory until the next
  recording replaces it. Only settings go to `localStorage`.
