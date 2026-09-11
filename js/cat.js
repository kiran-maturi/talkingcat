/* cat.js — a 1-bit cartoon cat drawn as SVG.
 *
 * Every pose variant exists in the DOM from the start; posing just toggles
 * `display` on a handful of groups. That keeps each animation frame down to
 * two or three attribute writes, which matters a lot on E Ink: the fewer
 * pixels that change, the smaller the partial refresh the panel has to do. */

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var MARKUP = [
    // ---- tail (behind everything) ----
    '<g id="tail-0"><path class="stroke" style="stroke-width:20" d="M280 470 C 352 470 366 408 332 378"/></g>',
    '<g id="tail-1"><path class="stroke" style="stroke-width:20" d="M280 465 C 356 452 376 366 336 322"/></g>',
    '<g id="tail-2"><path class="stroke" style="stroke-width:20" d="M280 462 C 348 438 388 392 352 336"/></g>',

    // ---- body ----
    // Rounded bottom corners: the raised-paw pose uncovers them.
    '<path class="filled" d="M108 478 C 100 378 132 300 200 300 C 268 300 300 378 292 478'
    + ' Q 292 505 262 505 L 138 505 Q 108 505 108 478 Z"/>',
    '<ellipse class="stroke" style="stroke-width:5" cx="200" cy="408" rx="56" ry="70"/>',

    // ---- paws ----
    '<g id="arms-down">',
    '  <ellipse class="filled" cx="160" cy="484" rx="38" ry="27"/>',
    '  <ellipse class="filled" cx="240" cy="484" rx="38" ry="27"/>',
    '  <path class="stroke" style="stroke-width:5" d="M148 482 v18 M160 480 v20 M172 482 v18"/>',
    '  <path class="stroke" style="stroke-width:5" d="M228 482 v18 M240 480 v20 M252 482 v18"/>',
    '</g>',
    '<g id="arms-wave">',
    // Waves with the left paw: the tail lives on the right and the two
    // shapes collide there at every tail position.
    '  <path class="stroke" style="stroke-width:22" d="M120 424 C 92 404 78 368 84 340"/>',
    '  <ellipse class="filled" cx="84" cy="320" rx="33" ry="29"/>',
    '  <path class="stroke" style="stroke-width:5" d="M71 303 v14 M84 300 v16 M97 303 v14"/>',
    '  <ellipse class="filled" cx="240" cy="484" rx="38" ry="27"/>',
    '  <path class="stroke" style="stroke-width:5" d="M228 482 v18 M240 480 v20 M252 482 v18"/>',
    '</g>',

    // ---- ears (drawn under the head so the join is hidden) ----
    '<g id="ears-up">',
    '  <path class="filled" d="M100 132 L 96 28 L 178 74 Z"/>',
    '  <path class="filled" d="M300 132 L 304 28 L 222 74 Z"/>',
    '  <path class="accent" d="M111 108 L 109 50 L 154 76 Z"/>',
    '  <path class="accent" d="M289 108 L 291 50 L 246 76 Z"/>',
    '</g>',
    '<g id="ears-perked">',
    '  <path class="filled" d="M104 130 L 88 6 L 180 70 Z"/>',
    '  <path class="filled" d="M296 130 L 312 6 L 220 70 Z"/>',
    '  <path class="accent" d="M113 102 L 104 34 L 155 69 Z"/>',
    '  <path class="accent" d="M287 102 L 296 34 L 245 69 Z"/>',
    '</g>',
    '<g id="ears-flat">',
    '  <path class="filled" d="M104 126 L 30 88 L 128 62 Z"/>',
    '  <path class="filled" d="M296 126 L 370 88 L 272 62 Z"/>',
    '  <path class="accent" d="M97 111 L 56 90 L 110 76 Z"/>',
    '  <path class="accent" d="M303 111 L 344 90 L 290 76 Z"/>',
    '</g>',

    // ---- head ----
    '<circle class="filled" cx="200" cy="190" r="120"/>',

    // ---- eyes ----
    '<g id="eyes-open">',
    '  <ellipse class="filled" cx="152" cy="178" rx="28" ry="32"/>',
    '  <ellipse class="filled" cx="248" cy="178" rx="28" ry="32"/>',
    '  <circle class="ink" cx="152" cy="180" r="14"/>',
    '  <circle class="ink" cx="248" cy="180" r="14"/>',
    '  <circle class="paper" cx="146" cy="172" r="5"/>',
    '  <circle class="paper" cx="242" cy="172" r="5"/>',
    '</g>',
    '<g id="eyes-wide">',
    '  <ellipse class="filled" cx="152" cy="176" rx="33" ry="39"/>',
    '  <ellipse class="filled" cx="248" cy="176" rx="33" ry="39"/>',
    '  <circle class="ink" cx="152" cy="178" r="9"/>',
    '  <circle class="ink" cx="248" cy="178" r="9"/>',
    '</g>',
    '<g id="eyes-happy">',
    '  <path class="stroke" d="M124 186 Q 152 150 180 186"/>',
    '  <path class="stroke" d="M220 186 Q 248 150 276 186"/>',
    '</g>',
    '<g id="eyes-blink">',
    '  <path class="stroke" d="M124 172 Q 152 200 180 172"/>',
    '  <path class="stroke" d="M220 172 Q 248 200 276 172"/>',
    '</g>',

    // ---- muzzle, nose, whiskers ----
    '<path class="stroke" style="stroke-width:5" d="M152 252 L 62 232 M150 266 L 54 266 M152 280 L 62 300"/>',
    '<path class="stroke" style="stroke-width:5" d="M248 252 L 338 232 M250 266 L 346 266 M248 280 L 338 300"/>',
    '<path class="accent" style="stroke:var(--ink);stroke-width:5;stroke-linejoin:round"',
    '      d="M180 222 Q 200 215 220 222 Q 214 240 200 247 Q 186 240 180 222 Z"/>',

    // ---- mouth, one group per openness level ----
    '<g id="mouth-0">',
    '  <path class="stroke" d="M200 247 v15 M200 262 Q 180 286 160 264 M200 262 Q 220 286 240 264"/>',
    '</g>',
    '<g id="mouth-1">',
    '  <path class="stroke" d="M200 247 v11"/>',
    '  <ellipse class="ink" cx="200" cy="270" rx="19" ry="12"/>',
    '</g>',
    '<g id="mouth-2">',
    '  <path class="stroke" d="M200 247 v6"/>',
    '  <ellipse class="ink" cx="200" cy="274" rx="29" ry="21"/>',
    '  <ellipse class="tongue" cx="200" cy="286" rx="15" ry="8"/>',
    '</g>',
    '<g id="mouth-3">',
    '  <ellipse class="ink" cx="200" cy="276" rx="38" ry="28"/>',
    '  <ellipse class="tongue" cx="200" cy="290" rx="19" ry="11"/>',
    '</g>',

    // ---- blush hatching (happy only; hatching survives 1-bit, fills don't) ----
    '<g id="blush">',
    '  <path class="stroke" style="stroke-width:5" d="M106 216 l 14 12 M120 210 l 14 12 M134 204 l 14 12"/>',
    '  <path class="stroke" style="stroke-width:5" d="M294 216 l -14 12 M280 210 l -14 12 M266 204 l -14 12"/>',
    '</g>',

    // ---- tap zones, always last so they sit on top ----
    '<rect class="hit" data-zone="ear"   x="40"  y="0"   width="320" height="76"/>',
    '<rect class="hit" data-zone="head"  x="80"  y="76"  width="240" height="120"/>',
    '<rect class="hit" data-zone="face"  x="100" y="196" width="200" height="112"/>',
    '<rect class="hit" data-zone="tail"  x="284" y="300" width="116" height="200"/>',
    '<rect class="hit" data-zone="belly" x="112" y="308" width="176" height="148"/>',
    '<rect class="hit" data-zone="paw"   x="100" y="456" width="200" height="64"/>'
  ].join('\n');

  var GROUPS = {
    ears:  ['ears-up', 'ears-perked', 'ears-flat'],
    eyes:  ['eyes-open', 'eyes-wide', 'eyes-happy', 'eyes-blink'],
    mouth: ['mouth-0', 'mouth-1', 'mouth-2', 'mouth-3'],
    tail:  ['tail-0', 'tail-1', 'tail-2'],
    arms:  ['arms-down', 'arms-wave']
  };

  function createCat(svg) {
    svg.innerHTML = MARKUP;

    var el = {};
    Object.keys(GROUPS).forEach(function (k) {
      GROUPS[k].forEach(function (id) { el[id] = svg.querySelector('#' + id); });
    });
    el.blush = svg.querySelector('#blush');

    var pose = {};

    function pick(group, id) {
      GROUPS[group].forEach(function (candidate) {
        el[candidate].style.display = (candidate === id) ? '' : 'none';
      });
    }

    var api = {
      /* Apply a partial pose. Only the parts that actually changed are
         written, so an idle blink costs one style write, not thirty. */
      set: function (next) {
        var changed = 0;

        if (next.ears !== undefined && next.ears !== pose.ears) {
          pose.ears = next.ears; pick('ears', 'ears-' + next.ears); changed += 2;
        }
        if (next.eyes !== undefined && next.eyes !== pose.eyes) {
          pose.eyes = next.eyes; pick('eyes', 'eyes-' + next.eyes); changed += 1;
        }
        if (next.mouth !== undefined && next.mouth !== pose.mouth) {
          pose.mouth = next.mouth; pick('mouth', 'mouth-' + next.mouth); changed += 1;
        }
        if (next.tail !== undefined && next.tail !== pose.tail) {
          pose.tail = next.tail; pick('tail', 'tail-' + next.tail); changed += 1;
        }
        if (next.arms !== undefined && next.arms !== pose.arms) {
          pose.arms = next.arms; pick('arms', 'arms-' + next.arms); changed += 2;
        }
        if (next.blush !== undefined && next.blush !== pose.blush) {
          pose.blush = next.blush;
          el.blush.style.display = next.blush ? '' : 'none';
          changed += 1;
        }

        if (changed) window.Eink.note(changed);
        return changed;
      },

      get: function () { return Object.assign({}, pose); },

      onZone: function (handler) {
        svg.addEventListener('pointerup', function (ev) {
          var zone = ev.target && ev.target.getAttribute('data-zone');
          if (zone) handler(zone, ev);
        });
      }
    };

    api.set({ ears: 'up', eyes: 'open', mouth: 0, tail: 0, arms: 'down', blush: false });
    return api;
  }

  window.createCat = createCat;
})();
