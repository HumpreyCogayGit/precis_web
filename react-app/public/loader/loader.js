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
  /* Which card (0-based) becomes the Rising Now panel in the binding exit: the
     top of the board's right column, the corner that panel sits in on the page. */
  var RISING_CARD = 1;
  var PULSES = [
    { tint: 'var(--pl-green)', delay: '0s' },
    { tint: 'var(--pl-blue)', delay: '1.5s' },
    { tint: 'var(--pl-amber)', delay: '3s' }
  ];

  var GLYPH_INTERVAL = 2200;
  var KICKER_INTERVAL = 2600;
  var FADE_MS = 420;
  var BURST_MS = 820;
  /* React's StrictMode mounts, tears down and remounts effects back to back in
     development. A loader that only existed for a few frames was never on
     screen, so bursting it would flash the exit animation on every dev reload.
     Below this age the exit is skipped and the loader just goes. */
  var MIN_VISIBLE_MS = 500;

  /* Binding exit: phase one flattens the camera, then the board and cards fly
     to the page sections they become, and only then is the page shown. */
  var BIND_PHASE_MS = 300;      // must match pl-bind-cam in loader.css
  var BIND_FLIGHT_MS = 480;
  /* The board leaves at once; the first card waits this long so the panel is
     visibly opening before rows start landing, then cards follow at the
     stagger. Six thrown at the same instant read as an explosion; one after
     another they read as something being laid out. */
  var BIND_CARD_LEAD_MS = 60;
  var BIND_STAGGER_MS = 25;
  var BIND_REVEAL_MS = 280;
  /* When the paper lifts off the page: just before the last card (of
     CARD_COUNT) settles, so the reveal overlaps the landing instead of waiting
     for a dead stop. */
  var BIND_REVEAL_AT =
    BIND_PHASE_MS + BIND_CARD_LEAD_MS + (CARD_COUNT - 1) * BIND_STAGGER_MS + BIND_FLIGHT_MS - 80;
  /* Leaves fast and settles slowly. The pieces are being *placed*, so each one
     should arrive at rest on its section rather than hit it at speed. */
  var BIND_EASE = 'cubic-bezier(0.6, 0, 0.2, 1)';

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
    carrier.className = 'pl';
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

  /* Fades out a piece of the scene that has nowhere to land. The Web Animations
     API on purpose: the piece is being held in place by a filling CSS animation,
     which an inline style cannot override but a script animation can. */
  function dismissPiece(node) {
    // A card is a child of the board, which is hidden once its clone has
    // launched; say so explicitly or the card vanishes with it, unfaded.
    node.style.visibility = 'visible';
    if (typeof node.animate === 'function') {
      node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    } else {
      node.style.visibility = 'hidden';
    }
  }

  /* Puts a clone of one piece of the scene -- the board or a card -- into the flight
     layer, exactly over the original, and records where it is to land. The
     original is hidden: from here on the clone is the piece.

     A clone, because the piece itself sits inside a transformed 3D scene and
     cannot be addressed in viewport coordinates. Returns false when there is
     nowhere to land, and the caller dismisses the piece instead. */
  function launchGhost(flight, piece, shellClass, target, delay) {
    if (!target) return false;

    var to = target.getBoundingClientRect();
    // A target scrolled out of view would send the piece off the screen, which
    // reads as throwing it away rather than landing it.
    if (!to.width || to.bottom < 0 || to.top > global.innerHeight) return false;

    // Measured off the lid, not the box: the lid is the surface being cloned,
    // and it sits nearer the camera than the box's own footprint does.
    // :scope, because the board's lid contains the cards, which have lids too.
    var face = piece.querySelector(':scope > .f-top');
    var from = face ? face.getBoundingClientRect() : null;
    if (!from || !from.width) return false;

    var ghost = el('div', 'pl-flight__piece');
    ghost.style.left = from.left + 'px';
    ghost.style.top = from.top + 'px';
    ghost.style.width = from.width + 'px';
    ghost.style.height = from.height + 'px';

    // Both classes: .pl-box gives the face its fill and radius, the piece's own
    // class its inner layout. The inline reset then strips what that class says
    // about where the piece sits in the scene, opacity included.
    var shell = el('div', 'pl-box ' + shellClass);
    shell.style.cssText =
      'position:absolute;inset:0;width:auto;height:auto;opacity:1;transform:none;animation:none;filter:none;';
    var lid = face.cloneNode(true);
    // The board's lid carries the cards and the desk block as children. The
    // cards fly on their own and the block is not coming, so its clone keeps
    // only what is printed on the board itself: perforations and slots.
    var extras = lid.querySelectorAll('.pl__card, .pl__machine, .pl__arrow, .pl__pill');
    for (var x = 0; x < extras.length; x++) extras[x].remove();
    shell.appendChild(lid);
    ghost.appendChild(shell);
    flight.appendChild(ghost);

    piece.style.visibility = 'hidden';

    // The box is animated, not scaled. Scaling to a table row's proportions
    // would smear the chip and rules across it; letting the box take the
    // target's real dimensions makes the piece *reflow* into that shape -- a
    // card's chip settles to row height and its rules draw out lengthwise,
    // while the board opens out into a panel with its slots still marked on it.
    ghost.setAttribute('data-to', [to.left, to.top, to.width, to.height].join(','));
    ghost.setAttribute('data-delay', delay);
    return true;
  }

  /* Phase two of the binding exit: the scene's light pieces become the page.
     The board opens out into the lead panel; the card at the top of its right
     column -- the corner the Rising Now panel sits in on the page -- becomes
     that panel; and the other five lay themselves down as the first rows of
     Top Stories, one after another. All of it happens over the loader's
     still-opaque paper, so nothing of the real page is seen until its
     stand-in is sitting on it.

     Returns the flight layer, or null if nothing could be bound. */
  function flyToSections(carrier, sections) {
    var flight = el('div', 'pl-flight');
    var theme = carrier.getAttribute('data-theme');

    if (theme) flight.setAttribute('data-theme', theme);
    flight.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flight);

    // Cards are collected before the board is launched, and launched after it:
    // the board's clone has to be underneath theirs all the way down, and
    // launching it hides the original, cards included, until each is dealt with.
    var cards = carrier.querySelectorAll('.pl__card');
    var board = carrier.querySelector('.pl__board');
    if (board && !launchGhost(flight, board, 'pl__board', sections.lead, 0)) {
      // Nowhere for the board to go: only its surface fades (see
      // .is-unbound in loader.css), since fading the box would take the cards.
      board.classList.add('is-unbound');
    }

    var rows = sections.rows || [];
    var nextRow = 0;
    for (var i = 0; i < cards.length; i++) {
      var target = i === RISING_CARD ? sections.rising : rows[nextRow++];
      var delay = BIND_CARD_LEAD_MS + i * BIND_STAGGER_MS;
      if (!launchGhost(flight, cards[i], 'pl__card', target, delay)) dismissPiece(cards[i]);
    }

    if (!flight.children.length) {
      flight.remove();
      return null;
    }

    // One forced reflow so the browser has the start boxes before the
    // transition is declared; without it both ends land in the same frame and
    // nothing animates.
    void flight.offsetWidth;

    var ghosts = flight.children;
    for (var g = 0; g < ghosts.length; g++) {
      var dest = ghosts[g].getAttribute('data-to').split(',');
      var move = BIND_FLIGHT_MS + 'ms ' + BIND_EASE + ' ' + ghosts[g].getAttribute('data-delay') + 'ms';

      ghosts[g].style.transition =
        'left ' + move + ', top ' + move + ', width ' + move + ', height ' + move;
      ghosts[g].style.left = dest[0] + 'px';
      ghosts[g].style.top = dest[1] + 'px';
      ghosts[g].style.width = dest[2] + 'px';
      ghosts[g].style.height = dest[3] + 'px';
    }

    return flight;
  }

  /* Plays the loader out, then removes it entirely -- a loader left in the DOM
     keeps aria-busy on the page and its animations on the compositor.
       explode: burst the scene apart and push the camera through it, for the
                hand-off to the real page.
       bind:    () => { lead, rising, rows }. Called one frame after the
                hand-off, once the page underneath has been laid out. The page
                names its sections and the scene decides which of its pieces
                becomes which: here the board opens into `lead`, one card
                becomes `rising`, and the other five land on the rows. A piece with no
                section, or one that is off-screen, just fades. Keeps the
                loader ignorant of the app: it is handed elements, never
                selectors.
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
        var sections = null;
        try {
          sections = opts.bind();
        } catch (error) {
          sections = null;
        }
        // The older per-card answer, [lead, rising, lead, row, row, row], is
        // still understood.
        if (Array.isArray(sections)) {
          sections = { lead: sections[0], rising: sections[1], rows: sections.slice(3) };
        }
        if (!sections) sections = {};

        var usable = Boolean(sections.lead || sections.rising);
        var rows = sections.rows || [];
        for (var i = 0; i < rows.length && !usable; i++) {
          if (rows[i]) usable = true;
        }

        // Nothing to bind to -- a search is active, or the edition is empty.
        if (!usable) {
          carrier.classList.add('is-bursting');
          global.setTimeout(function () { carrier.remove(); }, BURST_MS);
          return;
        }

        carrier.classList.add('is-binding');

        var flight = null;
        global.setTimeout(function () {
          flight = flyToSections(carrier, sections);
        }, BIND_PHASE_MS);

        // The paper and the stand-ins go together, so each real section comes
        // up exactly where, and exactly as, its stand-in fades.
        global.setTimeout(function () {
          carrier.classList.add('is-revealing');
          if (flight) {
            flight.style.transition = 'opacity ' + BIND_REVEAL_MS + 'ms ease';
            flight.style.opacity = '0';
          }
        }, BIND_REVEAL_AT);

        global.setTimeout(function () {
          carrier.remove();
          if (flight) flight.remove();
        }, BIND_REVEAL_AT + BIND_REVEAL_MS + 40);
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
