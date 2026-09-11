/* eink.js — display mode, frame pacing, and ghost-busting full refreshes.
 *
 * E Ink panels do a partial update for small changes (fast, but leaves ghosts)
 * and a full update when the whole screen changes (slow, but clean). We can't
 * call the panel driver from a browser, so we approximate a full update by
 * covering the screen in solid black for a couple of frames — that forces the
 * controller into a full refresh on every Boox device I've seen. */

(function () {
  'use strict';

  var STORE_KEY = 'tc.eink';

  function detect() {
    var params = new URLSearchParams(location.search);
    if (params.has('eink')) return params.get('eink') !== '0';

    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (saved !== null) return saved === '1';

    var ua = navigator.userAgent.toLowerCase();
    if (/onyx|boox|eink|e-ink|kobo|remarkable|kindle/.test(ua)) return true;

    // Some e-paper browsers honestly report a slow update medium.
    try {
      if (window.matchMedia && matchMedia('(update: slow)').matches) return true;
    } catch (e) {}

    return false;
  }

  var Eink = {
    enabled: detect(),
    refreshEvery: 16,
    _changes: 0,
    _flashing: false,

    get frameMs() { return this.enabled ? 220 : 66; },

    /* Slowest mouth flap we allow while talking. On E Ink anything faster
       than ~5fps turns into a grey smear rather than a moving mouth. */
    get mouthMs() { return this.enabled ? 180 : 70; },

    setEnabled: function (on) {
      this.enabled = !!on;
      try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) {}
      this.apply();
      this.flash();
    },

    apply: function () {
      document.documentElement.classList.toggle('colour', !this.enabled);
    },

    setRefreshEvery: function (n) {
      this.refreshEvery = n | 0;
      this._changes = 0;
    },

    /* Call after any visible change. Weight bigger changes higher. */
    note: function (weight) {
      if (!this.enabled || !this.refreshEvery) return;
      this._changes += (weight || 1);
      if (this._changes >= this.refreshEvery) {
        this._changes = 0;
        this.flash();
      }
    },

    /* Solid black, then back to the page: black -> white is the biggest
       possible delta and reliably triggers a full panel refresh.
       Teardown is on a plain timer, never requestAnimationFrame — rAF is
       frozen in a hidden tab, which would leave the screen black until the
       user came back. */
    flash: function () {
      if (this._flashing || document.hidden || !document.body) return;
      this._flashing = true;
      var el = document.createElement('div');
      el.id = 'flash';
      document.body.appendChild(el);
      var self = this;
      setTimeout(function () {
        el.remove();
        self._flashing = false;
      }, self.enabled ? 150 : 70);
    },

    /* Belt and braces: drop any overlay a previous session left behind. */
    clearFlash: function () {
      var stray = document.getElementById('flash');
      if (stray) stray.remove();
      this._flashing = false;
    }
  };

  Eink.apply();
  window.Eink = Eink;
})();
