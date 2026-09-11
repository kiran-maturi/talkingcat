/* app.js — state machine, tap reactions and settings. */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  var cat = window.createCat($('#cat'));
  var statusEl = $('#status');
  var bubbleEl = $('#bubble');
  var meterBars = Array.prototype.slice.call(document.querySelectorAll('#meter i'));
  var talkBtn = $('#btn-talk');
  var replayBtn = $('#btn-replay');
  var voiceBtn = $('#btn-voice');
  var voiceName = $('#voice-name');

  var state = 'idle';
  var lastBuffer = null;
  var voiceIndex = 0;
  var idleTimer = null;
  var bubbleTimer = null;
  var reactionTimer = null;

  var settings = load();

  function load() {
    var d = { voice: 'kitten', refreshEvery: 16, maxRec: 6, vad: true, wake: true };
    try {
      var raw = localStorage.getItem('tc.settings');
      if (raw) Object.assign(d, JSON.parse(raw));
    } catch (e) {}
    return d;
  }

  function save() {
    try { localStorage.setItem('tc.settings', JSON.stringify(settings)); } catch (e) {}
  }

  /* ---------------- small UI helpers ---------------- */

  function setState(next) {
    if (state === next) return;
    document.body.classList.remove('state-' + state);
    state = next;
    document.body.classList.add('state-' + state);
  }

  function say(text) {
    if (statusEl.textContent !== text) {
      statusEl.textContent = text;
      window.Eink.note(1);
    }
  }

  function bubble(text, ms) {
    clearTimeout(bubbleTimer);
    if (!text) { bubbleEl.hidden = true; return; }
    bubbleEl.textContent = text;
    bubbleEl.hidden = false;
    window.Eink.note(1);
    bubbleTimer = setTimeout(function () {
      bubbleEl.hidden = true;
      window.Eink.note(1);
    }, ms || 1400);
  }

  var meterLevel = -1;
  function meter(rmsValue) {
    // sqrt keeps quiet speech visible without the bars pinning on a shout
    var n = Math.round(Math.min(1, Math.sqrt(rmsValue * 6)) * meterBars.length);
    if (n === meterLevel) return;
    meterLevel = n;
    meterBars.forEach(function (bar, i) { bar.classList.toggle('on', i < n); });
  }

  /* ---------------- idle life ---------------- */

  function scheduleIdle() {
    clearTimeout(idleTimer);
    // E Ink gets a sleepy cat on purpose: each blink is a partial refresh,
    // and a cat that blinks every second leaves a ghost of every blink.
    var wait = window.Eink.enabled
      ? 5000 + Math.random() * 6000
      : 2200 + Math.random() * 3000;
    idleTimer = setTimeout(idleBeat, wait);
  }

  function idleBeat() {
    if (state === 'idle') {
      if (Math.random() < 0.6) {
        cat.set({ eyes: 'blink' });
        setTimeout(function () {
          if (state === 'idle') cat.set({ eyes: 'open' });
        }, window.Eink.enabled ? 320 : 160);
      } else {
        var tails = [0, 1, 2].filter(function (t) { return t !== cat.get().tail; });
        cat.set({ tail: tails[Math.floor(Math.random() * tails.length)] });
      }
    }
    scheduleIdle();
  }

  function goIdle() {
    setState('idle');
    cat.set({ ears: 'up', eyes: 'open', mouth: 0, arms: 'down', blush: false });
    meter(0);
    say('Tap TALK');
    scheduleIdle();
  }

  /* ---------------- listen -> repeat ---------------- */

  // ?demo=1 skips the microphone entirely — useful for checking sound output
  // and mouth animation on a new device before granting permission.
  var DEMO = new URLSearchParams(location.search).has('demo');

  function onTalk() {
    if (state === 'listening') { window.Audio2.stop(); return; }
    if (state === 'talking') { window.Audio2.stopPlayback(); goIdle(); return; }

    if (DEMO) {
      window.Audio2.resume().then(function () {
        lastBuffer = window.Audio2.demoBuffer();
        replayBtn.disabled = false;
        speak(lastBuffer);
      });
      return;
    }

    clearTimeout(reactionTimer);
    setState('listening');
    cat.set({ ears: 'perked', eyes: 'wide', mouth: 0, arms: 'down', blush: false });
    say('Listening…');
    bubble(null);
    talkBtn.textContent = 'STOP';

    window.Audio2.record({
      maxMs: settings.maxRec * 1000,
      vad: settings.vad,
      onLevel: meter
    }).then(function (result) {
      talkBtn.textContent = 'TALK';
      meter(0);
      if (!result.buffer) {
        cat.set({ ears: 'flat', eyes: 'blink' });
        window.Audio2.sound.chirp();
        say('I did not hear that');
        bubble('Hmm?', 1600);
        reactionTimer = setTimeout(goIdle, 1600);
        return;
      }
      lastBuffer = result.buffer;
      replayBtn.disabled = false;
      speak(lastBuffer);
    }).catch(function (err) {
      talkBtn.textContent = 'TALK';
      micError(err);
    });
  }

  function micError(err) {
    var name = (err && err.name) || String(err);
    var msg = 'Microphone problem';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = 'Allow the microphone';
    } else if (name === 'NotFoundError' || name === 'no-getusermedia') {
      msg = 'No microphone found';
    } else if (!window.isSecureContext) {
      msg = 'Needs https to hear you';
    }
    cat.set({ ears: 'flat', eyes: 'blink', mouth: 0 });
    say(msg);
    bubble('?', 2000);
    setState('idle');
    scheduleIdle();
  }

  function speak(buffer) {
    setState('talking');
    cat.set({ ears: 'up', eyes: 'open', arms: 'down', blush: false });
    say('Meow!');

    window.Audio2.play(buffer, settings.voice, {
      onLevel: function (level) {
        var mouth = level > 0.22 ? 3 : level > 0.11 ? 2 : level > 0.035 ? 1 : 0;
        cat.set({ mouth: mouth });
        meter(level);
      },
      onEnd: function () {
        meter(0);
        cat.set({ mouth: 0, eyes: 'happy', blush: true });
        window.Eink.flash();          // clean slate after a burst of mouth frames
        reactionTimer = setTimeout(goIdle, 1200);
      }
    });
  }

  function onReplay() {
    if (!lastBuffer || state === 'listening') return;
    clearTimeout(reactionTimer);
    speak(lastBuffer);
  }

  /* ---------------- poke reactions ---------------- */

  var REACTIONS = {
    head:  { pose: { eyes: 'happy', ears: 'up',     mouth: 0, blush: true },  sound: 'purr',   text: 'Purrr…', ms: 1700 },
    ear:   { pose: { eyes: 'happy', ears: 'flat',   mouth: 1, blush: true },  sound: 'giggle', text: 'Hee hee!', ms: 1300 },
    face:  { pose: { eyes: 'wide',  ears: 'flat',   mouth: 1 },               sound: 'yelp',   text: 'Boop!', ms: 900 },
    belly: { pose: { eyes: 'happy', ears: 'up',     mouth: 2, blush: true },  sound: 'giggle', text: 'Hee hee!', ms: 1300 },
    tail:  { pose: { eyes: 'wide',  ears: 'flat',   mouth: 3, tail: 2 },      sound: 'yelp',   text: 'Mrrow!', ms: 1000 },
    paw:   { pose: { eyes: 'happy', ears: 'up',     mouth: 1, arms: 'wave' }, sound: 'hello',  text: 'Hi!', ms: 1400 }
  };

  function react(zone) {
    if (state === 'listening') return;   // don't record our own sound effects
    var r = REACTIONS[zone];
    if (!r) return;

    clearTimeout(reactionTimer);
    window.Audio2.stopPlayback();
    setState('reacting');
    window.Audio2.resume().then(function () { window.Audio2.sound[r.sound](); });
    // Start from a neutral pose so a reaction never inherits the previous
    // one's blush or raised paw; tail is left wherever it was.
    cat.set(Object.assign(
      { ears: 'up', eyes: 'open', mouth: 0, arms: 'down', blush: false },
      r.pose
    ));
    bubble(r.text, r.ms);
    say(r.text);
    reactionTimer = setTimeout(goIdle, r.ms);
  }

  cat.onZone(react);

  /* ---------------- controls ---------------- */

  function press(btn, fn) {
    btn.addEventListener('pointerdown', function () { btn.classList.add('pressed'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      btn.addEventListener(ev, function () { btn.classList.remove('pressed'); });
    });
    btn.addEventListener('click', function (e) { e.preventDefault(); fn(); });
  }

  press(talkBtn, onTalk);
  press(replayBtn, onReplay);
  press(voiceBtn, function () {
    voiceIndex = (voiceIndex + 1) % window.Audio2.voices.length;
    settings.voice = window.Audio2.voices[voiceIndex].id;
    voiceName.textContent = window.Audio2.voices[voiceIndex].name;
    save();
    window.Eink.note(1);
    if (lastBuffer && state !== 'listening') onReplay();
  });
  press($('#btn-refresh'), function () { window.Eink.flash(); });

  /* ---------------- settings sheet ---------------- */

  var sheet = $('#sheet');
  var optEink = $('#opt-eink');
  var optRefresh = $('#opt-refresh');
  var optMaxRec = $('#opt-maxrec');
  var optVad = $('#opt-vad');
  var optWake = $('#opt-wake');

  press($('#btn-settings'), function () {
    optEink.checked = window.Eink.enabled;
    optRefresh.value = String(settings.refreshEvery);
    optMaxRec.value = String(settings.maxRec);
    optVad.checked = settings.vad;
    optWake.checked = settings.wake;
    $('#diag').textContent = diagnostics();
    sheet.hidden = false;
    window.Eink.flash();
  });

  press($('#btn-close-sheet'), function () {
    sheet.hidden = true;
    window.Eink.flash();
  });

  optEink.addEventListener('change', function () { window.Eink.setEnabled(optEink.checked); });
  optRefresh.addEventListener('change', function () {
    settings.refreshEvery = parseInt(optRefresh.value, 10);
    window.Eink.setRefreshEvery(settings.refreshEvery);
    save();
  });
  optMaxRec.addEventListener('change', function () {
    settings.maxRec = parseInt(optMaxRec.value, 10); save();
  });
  optVad.addEventListener('change', function () { settings.vad = optVad.checked; save(); });
  optWake.addEventListener('change', function () {
    settings.wake = optWake.checked; save();
    if (settings.wake) requestWakeLock(); else releaseWakeLock();
  });

  function diagnostics() {
    var a = window.Audio2.info();
    return [
      'secure context: ' + a.secure,
      'capture: ' + (a.capture || 'not started'),
      'sample rate: ' + (a.sampleRate || '-'),
      'audio state: ' + a.state,
      'mic open: ' + a.mic,
      'e ink mode: ' + window.Eink.enabled,
      'screen: ' + window.innerWidth + '×' + window.innerHeight +
        ' @' + (window.devicePixelRatio || 1),
      navigator.userAgent
    ].join('\n');
  }

  /* ---------------- wake lock ---------------- */

  var wakeLock = null;

  function requestWakeLock() {
    if (!navigator.wakeLock || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (settings.wake) requestWakeLock();
      window.Eink.clearFlash();
      window.Eink.flash();
    } else {
      window.Audio2.stopPlayback();
    }
  });

  /* ---------------- boot ---------------- */

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  voiceIndex = Math.max(0, window.Audio2.voices.findIndex(function (v) {
    return v.id === settings.voice;
  }));
  voiceName.textContent = window.Audio2.voices[voiceIndex].name;
  window.Eink.setRefreshEvery(settings.refreshEvery);
  if (settings.wake) requestWakeLock();

  goIdle();
  window.Eink.clearFlash();
  window.Eink.flash();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
