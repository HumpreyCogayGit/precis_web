/* Precis page-loading animation -- behaviour.
 *
 * Pairs with loader.css. The scene's cyclical motion is pure CSS, so the loader
 * still animates if this file is slow to arrive; JavaScript owns only the parts
 * CSS cannot express -- swapping the connector glyphs, advancing the status
 * copy, and tearing the whole thing down once the app takes over.
 *
 *   PrecisLoader.mount(target?, options?)  -> handle
 *   PrecisLoader.destroy(options?)
 *
 * It also self-mounts into #precis-loader / [data-precis-loader] on load, so a
 * host page needs nothing but the element, the stylesheet and this script.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* Source archetypes rather than real product marks: the reference clip cycles
     third-party logos, which a news reader has no licence to reproduce.
     Stroke-only shapes survive the ~22px the cube plate gives them; filled
     glyphs turn to mush at that size. */
  var GLYPHS = {
    world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
    wire: '<circle cx="6" cy="18" r="1.8" fill="currentColor" stroke="none"/><path d="M5 4a15 15 0 0 1 15 15M5 10a9 9 0 0 1 9 9"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    shield: '<path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    markets: '<path d="M4 16l5-5 3.5 3.5L20 7"/><path d="M15 7h5v5"/>',
    dish: '<path d="M4 20a12 12 0 0 1 12-12"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M14 4l6 6"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    lens: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L21 21"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>'
  };

  var GLYPH_ORDER = ['world', 'wire', 'chip', 'shield', 'markets', 'dish', 'bolt', 'doc', 'lens', 'pulse'];

  /* One accent per cube, held across glyph swaps so a given position keeps its
     identity while its contents rotate. */
  var NODE_TINTS = [
    'var(--pl-blue)',
    'var(--pl-amber)',
    'var(--pl-violet)',
    'var(--pl-green)',
    'var(--pl-cyan)',
    'var(--pl-red)',
    'var(--pl-blue)'
  ];

  var CARD_CHIPS = [
    { glyph: 'world', tint: 'var(--pl-blue)' },
    { glyph: 'markets', tint: 'var(--pl-green)' },
    { glyph: 'chip', tint: 'var(--pl-violet)' },
    { glyph: 'shield', tint: 'var(--pl-red)' },
    { glyph: 'wire', tint: 'var(--pl-amber)' },
    { glyph: 'pulse', tint: 'var(--pl-cyan)' }
  ];

  var KICKERS = [
    'Reading the wires',
    'Clustering the stories',
    'Ranking what changed',
    'Assembling the brief'
  ];

  var NODE_COUNT = 7;
  var CARD_COUNT = 6;
  var PULSES = [
    { tint: 'var(--pl-green)', delay: '0s' },
    { tint: 'var(--pl-blue)', delay: '1.5s' },
    { tint: 'var(--pl-amber)', delay: '3s' }
  ];

  var GLYPH_INTERVAL = 2200;
  var KICKER_INTERVAL = 2600;
  var LEAVE_MS = 420;

  function prefersReducedMotion() {
    return (
      typeof global.matchMedia === 'function' &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svg(paths) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = paths;
    return s;
  }

  /* Every solid in the scene is the same six-face box; only the depth, radius
     and face colours differ, and those come from CSS custom properties. The
     hidden faces are drawn too -- leave one out and the rounded lid shows a
     hole straight through the box. */
  function box(className) {
    var node = el('div', 'pl-box ' + className);
    ['f-base', 'f-n', 'f-s', 'f-e', 'f-w'].forEach(function (face) {
      node.appendChild(el('i', face));
    });
    var top = el('i', 'f-top');
    node.appendChild(top);
    node.topFace = top;
    return node;
  }

  function buildBoard() {
    var board = box('pl__board');
    var top = board.topFace;

    top.appendChild(el('span', 'pl__perf'));
    top.appendChild(el('span', 'pl__pill pl__pill--go'));
    top.appendChild(el('span', 'pl__pill pl__pill--stop'));

    // Ghost slots sit under the cards so the board never looks empty between
    // cycles -- the clip keeps the recesses visible the whole time.
    for (var s = 1; s <= CARD_COUNT; s++) {
      top.appendChild(el('span', 'pl__slot pl__at-' + s));
    }

    ['a', 'b', 'c'].forEach(function (key) {
      top.appendChild(el('span', 'pl__arrow pl__arrow--' + key));
    });

    for (var c = 0; c < CARD_COUNT; c++) {
      top.appendChild(buildCard(c));
    }

    top.appendChild(buildMachine());
    return board;
  }

  function buildCard(index) {
    var spec = CARD_CHIPS[index % CARD_CHIPS.length];
    var card = box('pl__card pl__card--' + (index + 1) + ' pl__at-' + (index + 1));

    var chip = el('span', 'pl__card__chip');
    chip.style.setProperty('--c', spec.tint);
    chip.appendChild(svg(GLYPHS[spec.glyph]));

    var lines = el('span', 'pl__card__lines');
    lines.appendChild(el('i'));
    lines.appendChild(el('i'));

    card.topFace.appendChild(chip);
    card.topFace.appendChild(lines);
    return card;
  }

  function buildMachine() {
    var machine = box('pl__machine');

    var mark = el('span', 'pl__machine__mark');
    mark.appendChild(svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 7.2l7 3.6M8.5 16.8l7-3.6"/>'));
    machine.topFace.appendChild(mark);

    var lid = box('pl__lid');
    lid.topFace.appendChild(el('span', 'pl__lid__dot'));
    var label = el('span', 'pl__lid__label');
    label.textContent = 'Precis';
    lid.topFace.appendChild(label);
    machine.topFace.appendChild(lid);

    return machine;
  }

  /* Seven cubes: three down the front-left edge, four along the front-right.
     Their positions live in loader.css; this only fills them. */
  function buildNodes(scene) {
    var glyphs = [];
    for (var i = 0; i < NODE_COUNT; i++) {
      var node = box('pl__node pl__node--' + (i + 1));

      var plate = el('span', 'pl__node__plate');
      var glyph = el('span', 'pl__node__glyph');
      glyph.style.setProperty('--c', NODE_TINTS[i % NODE_TINTS.length]);
      glyph.appendChild(svg(GLYPHS[GLYPH_ORDER[i % GLYPH_ORDER.length]]));

      plate.appendChild(glyph);
      node.topFace.appendChild(plate);
      scene.appendChild(node);

      glyphs.push({ el: glyph });
    }
    return glyphs;
  }

  function buildScene() {
    var scene = el('div', 'pl__scene');

    scene.appendChild(el('span', 'pl__shadow'));
    scene.appendChild(el('span', 'pl__rail'));

    PULSES.forEach(function (p) {
      var dot = el('span', 'pl__pulse');
      dot.style.setProperty('--c', p.tint);
      dot.style.animationDelay = p.delay;
      scene.appendChild(dot);
    });

    scene.appendChild(buildBoard());
    var glyphs = buildNodes(scene);

    var stage = el('div', 'pl__stage');
    stage.setAttribute('aria-hidden', 'true');
    stage.appendChild(scene);

    return { stage: stage, glyphs: glyphs };
  }

  function buildCopy(headline) {
    var copy = el('div', 'pl__copy');

    var kicker = el('p', 'pl__kicker');
    kicker.textContent = KICKERS[0];

    var h1 = el('h1', 'pl__headline');
    h1.innerHTML = headline;

    var progress = el('div', 'pl__progress');
    progress.setAttribute('aria-hidden', 'true');
    progress.appendChild(el('i'));

    copy.appendChild(kicker);
    copy.appendChild(h1);
    copy.appendChild(progress);

    return { copy: copy, kicker: kicker };
  }

  /* The page can hold more than one loader at a time: index.html mounts a boot
     splash before the bundle parses, and the app mounts its own while the first
     fetch is in flight. They are tracked separately so dismissing one cannot
     tear down the other. */
  var instances = [];

  function instanceFor(host) {
    for (var i = 0; i < instances.length; i++) {
      if (instances[i].root === host) return instances[i];
    }
    return null;
  }

  function resolve(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  function mount(target, options) {
    var opts = options || {};
    var host = resolve(target) || document.querySelector('#precis-loader, [data-precis-loader]');

    if (!host) return null;

    var existing = instanceFor(host);
    if (existing) return existing;

    var reduced = prefersReducedMotion();

    host.className = 'pl';
    // Left unset, the loader follows the OS via color-scheme; pass a theme to pin it.
    if (opts.theme) host.setAttribute('data-theme', opts.theme);
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-busy', 'true');
    host.setAttribute('aria-label', opts.label || 'Loading today’s brief');
    host.textContent = '';

    var brand = el('div', 'pl__brand');
    brand.setAttribute('aria-hidden', 'true');
    brand.innerHTML = 'Precis<b>.</b>';

    var scene = buildScene();
    var copy = buildCopy(opts.headline || 'Assembling today’s <span>edition.</span>');

    host.appendChild(brand);
    host.appendChild(scene.stage);
    host.appendChild(copy.copy);

    var timers = [];

    if (!reduced) {
      // Cubes are swapped one at a time on a rolling cursor, so the ring reads
      // as a queue being worked through rather than a synchronised blink. The
      // glyph pool is larger than the ring, so whatever comes off the belt next
      // is never already on a neighbouring cube.
      var nodeCursor = 0;
      var glyphCursor = NODE_COUNT;
      timers.push(
        global.setInterval(function () {
          var slot = scene.glyphs[nodeCursor % scene.glyphs.length];
          var next = GLYPH_ORDER[glyphCursor % GLYPH_ORDER.length];
          nodeCursor += 1;
          glyphCursor += 1;

          slot.el.classList.remove('is-swapping');
          void slot.el.offsetWidth; // restart the flip
          slot.el.classList.add('is-swapping');
          global.setTimeout(function () {
            slot.el.replaceChildren(svg(GLYPHS[next]));
          }, 230);
        }, GLYPH_INTERVAL / NODE_COUNT)
      );

      var kickerIndex = 0;
      timers.push(
        global.setInterval(function () {
          kickerIndex = (kickerIndex + 1) % KICKERS.length;
          copy.kicker.classList.add('is-fading');
          global.setTimeout(function () {
            copy.kicker.textContent = KICKERS[kickerIndex];
            copy.kicker.classList.remove('is-fading');
          }, 320);
        }, KICKER_INTERVAL)
      );
    }

    var handle = {
      root: host,
      timers: timers,
      destroy: function (destroyOptions) {
        return teardown(handle, destroyOptions);
      }
    };
    instances.push(handle);
    return handle;
  }

  /* Fades out, then removes the element entirely -- a loader left in the DOM
     keeps aria-busy on the page and its animations on the compositor.
     `keep` empties the mount point instead of removing it, for hosts such as
     React that own the element and will unmount it themselves. */
  function teardown(handle, options) {
    var index = instances.indexOf(handle);
    if (index === -1) return;
    instances.splice(index, 1);

    var opts = options || {};

    handle.timers.forEach(function (id) {
      global.clearInterval(id);
    });

    var root = handle.root;
    root.setAttribute('aria-busy', 'false');

    var dispose = function () {
      if (opts.keep) {
        root.className = '';
        root.removeAttribute('role');
        root.removeAttribute('aria-live');
        root.removeAttribute('aria-busy');
        root.removeAttribute('aria-label');
        root.textContent = '';
      } else {
        root.remove();
      }
    };

    if (opts.immediate || prefersReducedMotion()) {
      dispose();
      return;
    }

    root.classList.add('is-leaving');
    global.setTimeout(dispose, LEAVE_MS);
  }

  /* destroy(target?, options?) -- name a mount point to dismiss just that one,
     or pass options alone (or nothing) to dismiss every loader on the page. */
  function destroy(target, options) {
    var isTarget = typeof target === 'string' || (target && target.nodeType);

    if (isTarget) {
      var handle = instanceFor(resolve(target));
      if (handle) teardown(handle, options);
      return;
    }

    instances.slice().forEach(function (each) {
      teardown(each, target);
    });
  }

  var PrecisLoader = { mount: mount, destroy: destroy, GLYPHS: GLYPHS };
  global.PrecisLoader = PrecisLoader;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount();
    });
  } else {
    mount();
  }
})(window);
