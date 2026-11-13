/* Precis page-loading animation, second concept ("sorting line") -- behaviour.
 *
 * Pairs with sorter.css, and is a drop-in alternative to loader.js: it defines
 * the same window.PrecisLoader with the same mount / destroy contract, so the
 * app (main.jsx, NewsLoader.jsx) does not know or care which of the two a page
 * loaded. Load one pair or the other, never both.
 *
 * The scene's cyclical motion is pure CSS, so the loader still animates if this
 * file is slow to arrive; JavaScript owns only the parts CSS cannot express --
 * swapping glyphs, advancing the status copy, and tearing the whole thing down
 * once the app takes over.
 *
 *   PrecisLoader.mount(target?, options?)  -> handle
 *   PrecisLoader.destroy(target?, options?)
 *
 * It also self-mounts into #precis-loader / [data-precis-loader] on load, so a
 * host page needs nothing but the element, the stylesheet and this script.
 *
 * The teardown half of this file is deliberately a copy of loader.js's rather
 * than a shared module: each loader has to stay three standalone files that
 * work from a file:// preview, and going back to the other one has to be a
 * change of two paths with nothing else to untangle.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* Source archetypes rather than real product marks: a news reader has no
     licence to reproduce third-party logos. Stroke-only shapes survive the
     small plate they are printed on; filled glyphs turn to mush at that size. */
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
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    nodes: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 7.2l7 3.6M8.5 16.8l7-3.6"/>'
  };

  /* What sits on the source cubes: where stories come from. */
  var SOURCE_GLYPHS = ['world', 'wire', 'dish', 'doc', 'markets', 'lens'];

  var NODE_TINTS = [
    'var(--sl-blue)',
    'var(--sl-amber)',
    'var(--sl-green)',
    'var(--sl-cyan)'
  ];

  /* The two trays are the site's two topics, and a card's tag has to agree
     with the tray it is sorted into -- the gate would look broken otherwise.
     So each tray draws from its own pool, cool for AI and warm for security. */
  var TOPICS = {
    l: {
      label: 'AI',
      tint: 'var(--sl-violet)',
      tags: [
        { glyph: 'chip', tint: 'var(--sl-violet)' },
        { glyph: 'bolt', tint: 'var(--sl-blue)' },
        { glyph: 'nodes', tint: 'var(--sl-cyan)' },
        { glyph: 'pulse', tint: 'var(--sl-blue)' }
      ]
    },
    r: {
      label: 'Cyber',
      tint: 'var(--sl-red)',
      tags: [
        { glyph: 'shield', tint: 'var(--sl-red)' },
        { glyph: 'lock', tint: 'var(--sl-amber)' },
        { glyph: 'lens', tint: 'var(--sl-green)' },
        { glyph: 'shield', tint: 'var(--sl-amber)' }
      ]
    }
  };

  var KICKERS = [
    'Reading the wires',
    'Scanning the sources',
    'Tagging the stories',
    'Ranking what changed',
    'Assembling the brief'
  ];

  var NODE_COUNT = 4;
  var CARD_COUNT = 6;
  var FEED_TINTS = ['var(--sl-green)', 'var(--sl-blue)', 'var(--sl-amber)', 'var(--sl-cyan)'];

  var GLYPH_INTERVAL = 2200;
  var KICKER_INTERVAL = 2600;
  var FADE_MS = 420;
  var BURST_MS = 820;
  /* React's StrictMode mounts, tears down and remounts effects back to back in
     development. A loader that only existed for a few frames was never on
     screen, so bursting it would flash the exit animation on every dev reload.
     Below this age the exit is skipped and the loader just goes. */
  var MIN_VISIBLE_MS = 500;

  /* Binding exit: phase one flattens the camera, then the cards fly. */
  var BIND_PHASE_MS = 340;
  var BIND_FLIGHT_MS = 560;
  var BIND_CARRIER_MS = 700;
  /* Accelerating, not the usual ease-in-out: the card drifts off its slot and
     then rushes the last two thirds into the page. Phase one ends slow, so the
     two read as one continuous move that keeps gathering speed. */
  var BIND_EASE = 'cubic-bezier(0.55, 0.055, 0.675, 0.19)';

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
     hidden faces are drawn too -- leave one out and a rounded lid shows a hole
     straight through the box. */
  function box(className) {
    var node = el('div', 'sl-box ' + className);
    ['f-base', 'f-n', 'f-s', 'f-e', 'f-w'].forEach(function (face) {
      node.appendChild(el('i', face));
    });
    var top = el('i', 'f-top');
    node.appendChild(top);
    node.topFace = top;
    return node;
  }

  function buildBelt() {
    var belt = box('sl__belt');
    belt.topFace.appendChild(el('span', 'sl__tread'));
    return belt;
  }

  function buildTray(side) {
    var topic = TOPICS[side];
    var tray = box('sl__tray sl__tray--' + side);
    var top = tray.topFace;

    top.appendChild(el('span', 'sl__perf'));

    var label = el('span', 'sl__tray__label');
    label.style.setProperty('--c', topic.tint);
    label.textContent = topic.label;
    top.appendChild(label);

    for (var s = 1; s <= CARD_COUNT / 2; s++) {
      top.appendChild(el('span', 'sl__slot sl__slot--' + s));
    }
    return tray;
  }

  function buildGate(scene) {
    scene.appendChild(box('sl__post sl__post--l'));
    scene.appendChild(box('sl__post sl__post--r'));
    scene.appendChild(el('span', 'sl__scanline'));
    scene.appendChild(el('span', 'sl__curtain'));

    var beam = box('sl__beam');
    beam.topFace.appendChild(el('span', 'sl__beam__dot'));
    var label = el('span', 'sl__beam__label');
    label.textContent = 'Precis';
    beam.topFace.appendChild(label);
    scene.appendChild(beam);
  }

  /* Cards are numbered as a two-column, three-row grid read left to right:
     odd cards belong to the left tray, even to the right, and each pair shares
     a row. That is the same numbering as the wire desk's board, so a caller's
     bind targets mean the same thing under either loader. */
  function buildCard(index) {
    var side = index % 2 === 0 ? 'l' : 'r';
    var row = Math.floor(index / 2) + 1;
    var card = box(
      'sl__card sl__card--' + (index + 1) + ' sl__card--row-' + row + ' sl__card--to-' + side
    );

    var chip = el('span', 'sl__card__chip');
    var lines = el('span', 'sl__card__lines');
    lines.appendChild(el('i'));
    lines.appendChild(el('i'));

    card.topFace.appendChild(chip);
    card.topFace.appendChild(lines);

    var entry = { el: card, chip: chip, tags: TOPICS[side].tags, cursor: row - 1 };
    tagCard(entry);
    return entry;
  }

  function tagCard(entry) {
    var tag = entry.tags[entry.cursor % entry.tags.length];
    entry.cursor += 1;
    entry.chip.style.setProperty('--c', tag.tint);
    entry.chip.replaceChildren(svg(GLYPHS[tag.glyph]));
  }

  /* Four cubes, two either side of the head of the belt. Their positions live
     in sorter.css; this only fills them. */
  function buildNodes(scene) {
    var glyphs = [];
    for (var i = 0; i < NODE_COUNT; i++) {
      var feed = el('span', 'sl__feed sl__feed--' + (i + 1));
      var dot = el('span', 'sl__pulse');
      dot.style.setProperty('--c', FEED_TINTS[i % FEED_TINTS.length]);
      dot.style.animationDelay = i * 0.6 + 's';
      feed.appendChild(dot);
      scene.appendChild(feed);

      var node = box('sl__node sl__node--' + (i + 1));
      var plate = el('span', 'sl__node__plate');
      var glyph = el('span', 'sl__node__glyph');
      glyph.style.setProperty('--c', NODE_TINTS[i % NODE_TINTS.length]);
      glyph.appendChild(svg(GLYPHS[SOURCE_GLYPHS[i % SOURCE_GLYPHS.length]]));

      plate.appendChild(glyph);
      node.topFace.appendChild(plate);
      scene.appendChild(node);

      glyphs.push({ el: glyph });
    }
    return glyphs;
  }

  function buildScene() {
    var scene = el('div', 'sl__scene');

    scene.appendChild(el('span', 'sl__shadow'));
    var glyphs = buildNodes(scene);

    scene.appendChild(buildBelt());
    scene.appendChild(buildTray('l'));
    scene.appendChild(buildTray('r'));

    var cards = [];
    for (var c = 0; c < CARD_COUNT; c++) {
      var entry = buildCard(c);
      cards.push(entry);
      scene.appendChild(entry.el);
    }

    // After the cards in the tree, though depth -- not order -- decides what
    // covers what in a 3D scene; this just keeps the markup reading back to
    // front.
    buildGate(scene);

    var stage = el('div', 'sl__stage');
    stage.setAttribute('aria-hidden', 'true');
    stage.appendChild(scene);

    return { stage: stage, glyphs: glyphs, cards: cards };
  }

  function buildCopy(headline) {
    var copy = el('div', 'sl__copy');

    var kicker = el('p', 'sl__kicker');
    kicker.textContent = KICKERS[0];

    var h1 = el('h1', 'sl__headline');
    h1.innerHTML = headline;

    var progress = el('div', 'sl__progress');
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

    host.className = 'sl';
    // Left unset, the loader follows the OS via color-scheme; pass a theme to pin it.
    if (opts.theme) host.setAttribute('data-theme', opts.theme);
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-busy', 'true');
    host.setAttribute('aria-label', opts.label || 'Loading today’s brief');
    host.textContent = '';

    var brand = el('div', 'sl__brand');
    brand.setAttribute('aria-hidden', 'true');
    brand.innerHTML = 'Precis<b>.</b>';

    var scene = buildScene();
    var copy = buildCopy(opts.headline || 'Assembling today’s <span>edition.</span>');

    host.appendChild(brand);
    host.appendChild(scene.stage);
    host.appendChild(copy.copy);

    var timers = [];

    if (!reduced) {
      // Cubes are swapped one at a time on a rolling cursor, so they read as
      // feeds being worked through rather than a synchronised blink. The glyph
      // pool is larger than the set of cubes, so the next one in is never
      // already showing on a neighbour.
      var nodeCursor = 0;
      var glyphCursor = NODE_COUNT;
      timers.push(
        global.setInterval(function () {
          var slot = scene.glyphs[nodeCursor % scene.glyphs.length];
          var next = SOURCE_GLYPHS[glyphCursor % SOURCE_GLYPHS.length];
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

      // Each time a card comes round again it is a different story, so it gets
      // the next tag from its tray's pool. The swap happens on the iteration
      // boundary, where the card is transparent at the head of the belt.
      scene.cards.forEach(function (entry) {
        entry.el.addEventListener('animationiteration', function (event) {
          // The chip's own animations bubble through here too.
          if (event.target === entry.el) tagCard(entry);
        });
      });

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
      mountedAt: Date.now(),
      timers: timers,
      destroy: function (destroyOptions) {
        return teardown(handle, destroyOptions);
      }
    };
    instances.push(handle);
    return handle;
  }

  /* Hands the mount point back to whoever owns it, stripped of everything the
     loader put on it. */
  function releaseNode(node) {
    node.className = '';
    node.removeAttribute('role');
    node.removeAttribute('aria-live');
    node.removeAttribute('aria-busy');
    node.removeAttribute('aria-label');
    node.textContent = '';
  }

  /* Moves the scene onto a body-level element of our own. The caller's node is
     about to be unmounted by its framework, and the exit animation has to
     outlive it -- which it cannot do as that node's child. */
  function handOff(root) {
    var carrier = document.createElement('div');
    carrier.className = 'sl';
    if (root.hasAttribute('data-theme')) {
      carrier.setAttribute('data-theme', root.getAttribute('data-theme'));
    }
    // The page underneath is the live content now; this is only its send-off.
    carrier.setAttribute('aria-hidden', 'true');

    while (root.firstChild) carrier.appendChild(root.firstChild);
    document.body.appendChild(carrier);
    releaseNode(root);
    return carrier;
  }

  /* Phase two of the binding exit. Each card is left where it is and a clone
     is flown from its box to its target's, because the card itself sits inside
     a transformed 3D scene and cannot be addressed in viewport coordinates. */
  function flyToTargets(carrier, targets) {
    var cards = carrier.querySelectorAll('.sl__card');
    var flight = el('div', 'sl-flight');
    var theme = carrier.getAttribute('data-theme');

    if (theme) flight.setAttribute('data-theme', theme);
    flight.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flight);

    for (var i = 0; i < cards.length; i++) {
      var target = targets[i];
      if (!target) continue;

      var to = target.getBoundingClientRect();
      // A target scrolled out of view would send the card off the screen, which
      // reads as throwing it away rather than landing it.
      if (!to.width || to.bottom < 0 || to.top > global.innerHeight) continue;

      var from = cards[i].getBoundingClientRect();
      var face = cards[i].querySelector('.f-top');
      if (!from.width || !face) continue;

      var ghost = el('div', 'sl-flight__card');
      ghost.style.left = from.left + 'px';
      ghost.style.top = from.top + 'px';
      ghost.style.width = from.width + 'px';
      ghost.style.height = from.height + 'px';

      // Both classes: .sl-box gives the face its fill and radius, .sl__card its
      // padding and the chip layout inside. The inline reset then strips what
      // .sl__card says about riding the belt, opacity included.
      var shell = el('div', 'sl-box sl__card');
      shell.style.cssText =
        'position:absolute;inset:0;width:auto;height:auto;opacity:1;transform:none;animation:none;filter:none;';
      shell.appendChild(face.cloneNode(true));
      ghost.appendChild(shell);
      flight.appendChild(ghost);

      cards[i].style.visibility = 'hidden';

      // The box is animated, not scaled. Scaling to a table row's proportions
      // would smear the chip and rules across it; letting the box take the
      // target's real dimensions makes the card *reflow* into that shape --
      // the chip settles to row height and the rules draw out lengthwise,
      // while a panel target inflates the same card into a hero instead.
      ghost.setAttribute(
        'data-to',
        [to.left, to.top, to.width, to.height].join(',')
      );
    }

    if (!flight.children.length) {
      flight.remove();
      return;
    }

    // One forced reflow so the browser has the start boxes before the
    // transition is declared; without it both ends land in the same frame and
    // nothing animates.
    void flight.offsetWidth;

    var ghosts = flight.children;
    for (var g = 0; g < ghosts.length; g++) {
      var dest = ghosts[g].getAttribute('data-to').split(',');
      var move = BIND_FLIGHT_MS + 'ms ' + BIND_EASE;

      ghosts[g].style.transition =
        'left ' + move + ', top ' + move + ', width ' + move + ', height ' + move +
        ', opacity 220ms ease ' + (BIND_FLIGHT_MS - 220) + 'ms';
      ghosts[g].style.left = dest[0] + 'px';
      ghosts[g].style.top = dest[1] + 'px';
      ghosts[g].style.width = dest[2] + 'px';
      ghosts[g].style.height = dest[3] + 'px';
      // Handing over to the real element underneath, which is already in place.
      ghosts[g].style.opacity = '0';
    }

    global.setTimeout(function () {
      flight.remove();
    }, BIND_FLIGHT_MS + 140);
  }

  /* Plays the loader out, then removes it entirely -- a loader left in the DOM
     keeps aria-busy on the page and its animations on the compositor.
       explode: burst the scene apart and push the camera through it, for the
                hand-off to the real page.
       bind:    () => Element[]. Called one frame after the hand-off, once the
                page underneath has been laid out; card i flies to targets[i].
                Falsy entries and off-screen targets fall back to the burst's
                fade. Keeps the loader ignorant of the app: it is handed
                elements, never selectors.
       handoff: the mount point belongs to a framework; move the scene off it
                first so the exit can finish after that node is gone.
       immediate: no exit at all. */
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

    var reduced = prefersReducedMotion();
    var burst = Boolean(opts.explode) && !reduced && Date.now() - handle.mountedAt >= MIN_VISIBLE_MS;
    // An exit that was asked for but did not qualify is dropped, not downgraded
    // to a fade: the caller wanted the burst or nothing.
    var animate = !opts.immediate && !reduced && (opts.explode ? burst : true);

    if (!animate) {
      if (opts.handoff) releaseNode(root);
      else root.remove();
      return;
    }

    if (opts.handoff) root = handOff(root);

    if (burst && typeof opts.bind === 'function') {
      // Deferred one task before measuring: this runs inside the framework's
      // commit, where the page underneath is not in its final shape yet.
      // A timeout rather than requestAnimationFrame on purpose -- rAF does not
      // fire in a background tab, which would strand the loader on screen for
      // anyone who switched away while the edition loaded. Nothing here needs a
      // paint: getBoundingClientRect forces layout on its own.
      var carrier = root;
      global.setTimeout(function () {
        var targets = [];
        try {
          targets = opts.bind() || [];
        } catch (error) {
          targets = [];
        }

        var usable = false;
        for (var i = 0; i < targets.length; i++) {
          if (targets[i]) { usable = true; break; }
        }

        // Nothing to bind to -- a search is active, or the edition is empty.
        if (!usable) {
          carrier.classList.add('is-bursting');
          global.setTimeout(function () { carrier.remove(); }, BURST_MS);
          return;
        }

        carrier.classList.add('is-binding');
        global.setTimeout(function () {
          flyToTargets(carrier, targets);
        }, BIND_PHASE_MS);
        global.setTimeout(function () { carrier.remove(); }, BIND_CARRIER_MS);
      }, 0);
      return;
    }

    root.classList.add(burst ? 'is-bursting' : 'is-leaving');
    global.setTimeout(function () {
      root.remove();
    }, burst ? BURST_MS : FADE_MS);
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
