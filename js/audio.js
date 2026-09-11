/* audio.js — microphone capture, voice mangling, and synthesised cat noises.
 *
 * No audio assets ship with this app: every meow, purr and giggle is generated
 * with oscillators at runtime. That keeps the whole toy a ~40 KB download,
 * which matters when the device it runs on is on family wifi and E Ink. */

(function () {
  'use strict';

  var ctx = null;
  var stream = null;
  var micNode = null;
  var capture = null;      // worklet node or script processor
  var captureMode = null;  // 'worklet' | 'script'

  var rec = null;          // active recording session

  var VOICES = [
    { id: 'kitten', name: 'Kitten', rate: 1.55, peak: [2400, 7, 6] },
    { id: 'cat',    name: 'Cat',    rate: 1.32, peak: [1800, 5, 4] },
    { id: 'lion',   name: 'Big Cat', rate: 0.72, shelf: [320, 6] },
    { id: 'robot',  name: 'Robot',  rate: 1.0,  ring: 42 },
    { id: 'echo',   name: 'Echo',   rate: 1.4,  delay: [0.13, 0.42] }
  ];

  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      ctx = new C();
    }
    return ctx;
  }

  function resume() {
    var c = ac();
    return c.state === 'suspended' ? c.resume() : Promise.resolve();
  }

  /* ---------------- microphone ---------------- */

  var WORKLET_SRC = [
    'class Cap extends AudioWorkletProcessor {',
    '  constructor(){ super(); this.buf = new Float32Array(2048); this.n = 0; }',
    '  process(inputs){',
    '    const ch = inputs[0] && inputs[0][0];',
    '    if (!ch) return true;',
    '    for (let i = 0; i < ch.length; i++) {',
    '      this.buf[this.n++] = ch[i];',
    '      if (this.n === this.buf.length) {',
    '        this.port.postMessage(this.buf.slice(0));',
    '        this.n = 0;',
    '      }',
    '    }',
    '    return true;',
    '  }',
    '}',
    'registerProcessor("cap", Cap);'
  ].join('\n');

  function openMic() {
    if (stream) return Promise.resolve();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('no-getusermedia'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    }).then(function (s) {
      stream = s;
      var c = ac();
      micNode = c.createMediaStreamSource(s);
      return buildCapture(c);
    });
  }

  function buildCapture(c) {
    if (c.audioWorklet) {
      var url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
      return c.audioWorklet.addModule(url).then(function () {
        URL.revokeObjectURL(url);
        capture = new AudioWorkletNode(c, 'cap');
        capture.port.onmessage = function (ev) { onChunk(ev.data); };
        captureMode = 'worklet';
        // A worklet with no output still needs a sink to be pulled.
        var silent = c.createGain();
        silent.gain.value = 0;
        capture.connect(silent).connect(c.destination);
      }).catch(function () {
        buildScriptCapture(c);
      });
    }
    buildScriptCapture(c);
    return Promise.resolve();
  }

  function buildScriptCapture(c) {
    // Deprecated but present everywhere, including older Boox Chromium builds.
    capture = c.createScriptProcessor(2048, 1, 1);
    capture.onaudioprocess = function (ev) {
      onChunk(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    captureMode = 'script';
    var silent = c.createGain();
    silent.gain.value = 0;
    capture.connect(silent).connect(c.destination);
  }

  function rms(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / a.length);
  }

  function onChunk(chunk) {
    if (!rec || rec.done) return;
    rec.chunks.push(chunk);
    rec.length += chunk.length;

    var level = rms(chunk);
    rec.peak = Math.max(rec.peak, level);
    if (rec.onLevel) rec.onLevel(level);

    var now = performance.now();

    // Voice-activity stop: only arm once we've actually heard something,
    // so a shy kid isn't cut off before they start.
    if (level > rec.speechThreshold) {
      rec.heard = true;
      rec.lastLoud = now;
    }
    if (rec.vad && rec.heard && (now - rec.lastLoud) > rec.silenceMs) {
      finish('silence');
    } else if ((now - rec.started) > rec.maxMs) {
      finish('limit');
    }
  }

  function finish(reason) {
    if (!rec || rec.done) return;
    rec.done = true;
    var session = rec;
    rec = null;
    if (micNode && capture) { try { micNode.disconnect(capture); } catch (e) {} }
    var buffer = toBuffer(session);
    session.resolve({ buffer: buffer, reason: reason, heard: session.heard });
  }

  function toBuffer(session) {
    var c = ac();
    var total = session.length;
    if (!total) return null;

    var flat = new Float32Array(total);
    var o = 0;
    session.chunks.forEach(function (ch) { flat.set(ch, o); o += ch.length; });

    // Trim leading/trailing quiet, then normalise.
    var gate = Math.max(session.peak * 0.08, 0.008);
    var start = 0, end = flat.length - 1;
    while (start < end && Math.abs(flat[start]) < gate) start++;
    while (end > start && Math.abs(flat[end]) < gate) end--;

    var pad = Math.round(c.sampleRate * 0.05);
    start = Math.max(0, start - pad);
    end = Math.min(flat.length - 1, end + pad);

    var len = end - start + 1;
    if (len < c.sampleRate * 0.12) return null;   // nothing but room tone

    var buf = c.createBuffer(1, len, c.sampleRate);
    var out = buf.getChannelData(0);
    var maxAbs = 0;
    for (var i = 0; i < len; i++) {
      var v = flat[start + i];
      out[i] = v;
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
    if (maxAbs > 0) {
      var gain = Math.min(0.92 / maxAbs, 8);
      for (var j = 0; j < len; j++) out[j] *= gain;
    }
    return buf;
  }

  function record(opts) {
    opts = opts || {};
    return resume().then(openMic).then(function () {
      if (rec) finish('restart');
      return new Promise(function (resolve) {
        rec = {
          chunks: [], length: 0, peak: 0, heard: false, done: false,
          started: performance.now(),
          lastLoud: performance.now(),
          maxMs: opts.maxMs || 6000,
          silenceMs: opts.silenceMs || 900,
          speechThreshold: opts.threshold || 0.035,
          vad: opts.vad !== false,
          onLevel: opts.onLevel,
          resolve: resolve
        };
        micNode.connect(capture);
      });
    });
  }

  function stop() { finish('manual'); }

  /* ---------------- playback with a silly voice ---------------- */

  var current = null;
  var current_osc = null;

  function play(buffer, voiceId, opts) {
    opts = opts || {};
    var c = ac();
    var voice = VOICES.filter(function (v) { return v.id === voiceId; })[0] || VOICES[0];

    stopPlayback();

    var src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = voice.rate;

    var node = src;

    if (voice.ring) {
      var mod = c.createGain();
      mod.gain.value = 0;
      var osc = c.createOscillator();
      osc.frequency.value = voice.ring;
      osc.connect(mod.gain);
      osc.start();
      node.connect(mod);
      node = mod;
      current_osc = osc;
    }
    if (voice.peak) {
      var pk = c.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = voice.peak[0];
      pk.Q.value = voice.peak[1];
      pk.gain.value = voice.peak[2];
      node.connect(pk);
      node = pk;
    }
    if (voice.shelf) {
      var ls = c.createBiquadFilter();
      ls.type = 'lowshelf';
      ls.frequency.value = voice.shelf[0];
      ls.gain.value = voice.shelf[1];
      node.connect(ls);
      node = ls;
    }

    var out = c.createGain();
    out.gain.value = 1;
    node.connect(out);

    if (voice.delay) {
      var d = c.createDelay(1);
      d.delayTime.value = voice.delay[0];
      var fb = c.createGain();
      fb.gain.value = voice.delay[1];
      out.connect(d); d.connect(fb); fb.connect(d); d.connect(c.destination);
    }

    var analyser = c.createAnalyser();
    analyser.fftSize = 512;
    out.connect(analyser);
    out.connect(c.destination);

    var data = new Uint8Array(analyser.fftSize);
    var timer = null;
    if (opts.onLevel) {
      // Sample fast, report slowly, and report the loudest sample in between.
      // The mouth can only redraw every mouthMs on E Ink; sampling at that
      // same rate just aliases against the syllables and the cat ends up
      // flapping on a fixed beat instead of following the voice.
      var emitEvery = window.Eink.mouthMs;
      var held = 0;
      var since = 0;
      var step = Math.min(45, emitEvery);
      timer = setInterval(function () {
        analyser.getByteTimeDomainData(data);
        var s = 0;
        for (var i = 0; i < data.length; i++) {
          var v = (data[i] - 128) / 128;
          s += v * v;
        }
        held = Math.max(held, Math.sqrt(s / data.length));
        since += step;
        if (since >= emitEvery) {
          opts.onLevel(held);
          held = 0;
          since = 0;
        }
      }, step);
    }

    var ended = false;
    src.onended = function () {
      if (ended) return;
      ended = true;
      if (timer) clearInterval(timer);
      current = null;
      if (current_osc) { try { current_osc.stop(); } catch (e) {} current_osc = null; }
      if (opts.onEnd) opts.onEnd();
    };

    current = src;
    src.start();
    return buffer.duration / voice.rate;
  }

  function stopPlayback() {
    if (current) {
      try { current.stop(); } catch (e) {}
      current = null;
    }
    if (current_osc) {
      try { current_osc.stop(); } catch (e) {}
      current_osc = null;
    }
  }

  /* ---------------- synthesised cat noises ---------------- */

  function env(g, t0, dur, peak, attack) {
    attack = attack || 0.03;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function meow(o) {
    o = o || {};
    var c = ac(), t = c.currentTime + 0.01;
    var dur = o.dur || 0.6;
    var base = o.base || 420;

    var osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.85, t + dur * 0.18);
    osc.frequency.linearRampToValueAtTime(base * 1.7, t + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(base * 0.9, t + dur);

    // A little vibrato is most of what makes it read as "animal".
    var lfo = c.createOscillator();
    lfo.frequency.value = 6.5;
    var lfoGain = c.createGain();
    lfoGain.gain.value = base * 0.035;
    lfo.connect(lfoGain).connect(osc.frequency);

    // Two formants: rough "ee" -> "ow".
    var f1 = c.createBiquadFilter();
    f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(900, t);
    f1.frequency.linearRampToValueAtTime(1700, t + dur * 0.25);
    f1.frequency.linearRampToValueAtTime(700, t + dur);

    var f2 = c.createBiquadFilter();
    f2.type = 'bandpass'; f2.Q.value = 8;
    f2.frequency.setValueAtTime(2300, t);
    f2.frequency.linearRampToValueAtTime(1500, t + dur);

    var g = c.createGain();
    env(g, t, dur, o.gain || 0.45, 0.05);

    osc.connect(f1).connect(g);
    osc.connect(f2).connect(g);
    g.connect(c.destination);

    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    return dur;
  }

  function noiseBuffer(seconds) {
    var c = ac();
    var len = Math.floor(c.sampleRate * seconds);
    var b = c.createBuffer(1, len, c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function purr(o) {
    o = o || {};
    var c = ac(), t = c.currentTime + 0.01;
    var dur = o.dur || 1.6;

    var src = c.createBufferSource();
    src.buffer = noiseBuffer(dur);

    var lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2;

    // ~26 Hz amplitude flutter is the purr.
    var trem = c.createGain();
    trem.gain.value = 0.5;
    var lfo = c.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 26;
    var lfoGain = c.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(trem.gain);

    var body = c.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 62;
    var bodyGain = c.createGain();
    bodyGain.gain.value = 0.12;

    var g = c.createGain();
    env(g, t, dur, o.gain || 0.5, 0.15);

    src.connect(lp).connect(trem).connect(g);
    body.connect(bodyGain).connect(trem);
    g.connect(c.destination);

    src.start(t); lfo.start(t); body.start(t);
    src.stop(t + dur); lfo.stop(t + dur); body.stop(t + dur);
    return dur;
  }

  function blips(freqs, step, type, gain) {
    var c = ac(), t = c.currentTime + 0.01;
    freqs.forEach(function (f, i) {
      var osc = c.createOscillator();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(f, t + i * step);
      osc.frequency.linearRampToValueAtTime(f * 1.25, t + i * step + step * 0.7);
      var g = c.createGain();
      env(g, t + i * step, step * 0.85, gain || 0.3, 0.01);
      osc.connect(g).connect(c.destination);
      osc.start(t + i * step);
      osc.stop(t + i * step + step);
    });
    return freqs.length * step;
  }

  var Sound = {
    meow: meow,
    purr: purr,
    yelp: function () { return meow({ base: 720, dur: 0.26, gain: 0.5 }); },
    chirp: function () { return blips([620, 760, 700], 0.09, 'triangle', 0.32); },
    giggle: function () { return blips([520, 660, 580, 720, 640], 0.11, 'triangle', 0.28); },
    hello: function () { return blips([480, 600, 540], 0.13, 'sine', 0.3); }
  };

  /* A stand-in for a recording: babble-shaped noise, so the whole
     playback path (voice effects, mouth animation, speaker) can be checked
     on a device before anyone grants microphone permission. */
  function demoBuffer() {
    var c = ac();
    var dur = 1.4;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    var syllable = c.sampleRate * 0.18;
    for (var i = 0; i < len; i++) {
      var t = i / c.sampleRate;
      var pos = (i % syllable) / syllable;
      var envelope = Math.sin(Math.PI * pos);            // one blob per syllable
      var f = 180 + 60 * Math.sin(t * 3.1);              // wobbling pitch
      var v = 0;
      for (var h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
      d[i] = v * 0.16 * envelope * envelope;
    }
    return buf;
  }

  window.Audio2 = {
    voices: VOICES,
    demoBuffer: demoBuffer,
    resume: resume,
    openMic: openMic,
    record: record,
    stop: stop,
    play: play,
    stopPlayback: stopPlayback,
    sound: Sound,
    info: function () {
      return {
        capture: captureMode,
        sampleRate: ctx ? ctx.sampleRate : null,
        state: ctx ? ctx.state : 'none',
        secure: window.isSecureContext,
        mic: !!stream
      };
    }
  };
})();
