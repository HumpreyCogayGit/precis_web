/* Precis page-loading animation, third concept ("workshop") -- behaviour.
 *
 * Pairs with crew.css, and is interchangeable with loader.js and sorter.js: it
 * defines the same window.PrecisLoader with the same mount / destroy contract,
 * so the app (main.jsx, NewsLoader.jsx) does not know or care which scene a
 * page loaded. pick.js loads exactly one of them per visit.
 *
 * The scene's motion is pure CSS -- the whole shift is a timetable of
 * keyframes in crew.css -- so the crew keep working if this file is slow to
 * arrive. JavaScript owns only what CSS cannot express: building the markup,
 * changing each card's tag between shifts, advancing the status copy, and
 * tearing the whole thing down once the app takes over.
 *
 *   PrecisLoader.mount(target?, options?)  -> handle
 *   PrecisLoader.destroy(target?, options?)
 *
 * It also self-mounts into #precis-loader / [data-precis-loader] on load, so a
 * host page needs nothing but the element, the stylesheet and this script.
 *
 * The teardown half of this file is deliberately a copy of the other scenes'
 * rather than a shared module: each scene has to stay three standalone files
 * that work from a file:// preview.
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

  /* Each worker brings their own run of tags, cool for the left column and
     warm for the right, so the finished board is not a patchwork. */
  var TAGS = {
    l: [
      { glyph: 'chip', tint: 'var(--cw-violet)' },
      { glyph: 'bolt', tint: 'var(--cw-blue)' },
      { glyph: 'nodes', tint: 'var(--cw-cyan)' },
      { glyph: 'pulse', tint: 'var(--cw-blue)' }
    ],
    r: [
      { glyph: 'shield', tint: 'var(--cw-red)' },
      { glyph: 'lock', tint: 'var(--cw-amber)' },
      { glyph: 'lens', tint: 'var(--cw-green)' },
      { glyph: 'world', tint: 'var(--cw-amber)' }
    ]
  };

  /* Overalls. The hard hats are all the same amber (crew.css). */
  var CREW_TINTS = { l: 'var(--cw-blue)', r: 'var(--cw-violet)', op: 'var(--cw-green)' };

  var KICKERS = [
    'Clocking in',
    'Stamping the stories',
    'Wheeling them over',
    'Laying out the page',
    'Assembling the brief'
  ];

  var CARD_COUNT = 6;
  /* Which card (0-based) becomes the Rising Now panel in the binding exit. */
  var RISING_CARD = 1;

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
  var BIND_PHASE_MS = 300;      // must match cw-bind-cam in crew.css
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
     hidden faces are drawn too -- leave one out and a rounded lid shows a hole
     straight through the box. */
  function box(className) {
    var node = el('div', 'cw-box ' + className);
    ['f-base', 'f-n', 'f-s', 'f-e', 'f-w'].forEach(function (face) {
      node.appendChild(el('i', face));
    });
    var top = el('i', 'f-top');
    node.appendChild(top);
    node.topFace = top;
    return node;
  }

  /* The press: a roller bench, the column behind it and the head that comes
     down on each card. */
  function buildPress(scene) {
    scene.appendChild(box('cw__bench'));

    var tower = box('cw__tower');
    tower.topFace.appendChild(el('span', 'cw__tower__dot'));
    var label = el('span', 'cw__tower__label');
    label.textContent = 'Precis';
    tower.topFace.appendChild(label);
    scene.appendChild(tower);

    scene.appendChild(box('cw__head'));
  }

  function buildBoard() {
    var board = box('cw__board');
    var top = board.topFace;

    top.appendChild(el('span', 'cw__perf'));
    for (var s = 1; s <= CARD_COUNT; s++) {
      top.appendChild(el('span', 'cw__slot cw__slot--' + s));
    }
    return board;
  }

  /* One of the crew: legs, torso, arms, head and hard hat, each a box. Sizes
     and the walk cycle are all in crew.css. */
  function buildFigure(tint, extraClass) {
    var figure = el('div', 'cw__figure' + (extraClass ? ' ' + extraClass : ''));
    figure.style.setProperty('--c', tint);

    ['cw__leg cw__leg--l', 'cw__leg cw__leg--r', 'cw__torso', 'cw__arm cw__arm--l',
      'cw__arm cw__arm--r', 'cw__noggin', 'cw__hat'].forEach(function (part) {
      figure.appendChild(box(part));
    });
    return figure;
  }

  /* A worker and their cart, animated as one unit. */
  function buildTeam(side) {
    var team = el('div', 'cw__team cw__team--' + side);
    team.appendChild(box('cw__cart'));
    team.appendChild(buildFigure(CREW_TINTS[side]));
    return team;
  }

  /* Cards are numbered as a two-column, three-row grid read left to right:
     odd cards are the left worker's, even the right's, and each pair shares a
     row -- the same numbering as the other two scenes. */
  function buildCard(index) {
    var side = index % 2 === 0 ? 'l' : 'r';
    var row = Math.floor(index / 2) + 1;
    var card = box(
      'cw__card cw__card--' + (index + 1) + ' cw__card--row-' + row + ' cw__card--to-' + side
    );

    var chip = el('span', 'cw__card__chip');
    var lines = el('span', 'cw__card__lines');
    lines.appendChild(el('i'));
    lines.appendChild(el('i'));

    card.topFace.appendChild(chip);
    card.topFace.appendChild(lines);

    var entry = { el: card, chip: chip, tags: TAGS[side], cursor: row - 1 };
    tagCard(entry);
    return entry;
  }

  function tagCard(entry) {
    var tag = entry.tags[entry.cursor % entry.tags.length];
    entry.cursor += 1;
    entry.chip.style.setProperty('--c', tag.tint);
    entry.chip.replaceChildren(svg(GLYPHS[tag.glyph]));
  }

  function buildScene() {
    var scene = el('div', 'cw__scene');

    scene.appendChild(el('span', 'cw__shadow'));
    scene.appendChild(el('span', 'cw__lane cw__lane--l'));
    scene.appendChild(el('span', 'cw__lane cw__lane--r'));

    buildPress(scene);
    scene.appendChild(buildFigure(CREW_TINTS.op, 'cw__figure--op'));
    scene.appendChild(buildBoard());
    scene.appendChild(buildTeam('l'));
    scene.appendChild(buildTeam('r'));

    // Cards are children of the scene, not of a cart or the board: each one
    // crosses all three surfaces, and the binding exit has to be able to keep
    // the cards while everything they sat on fades.
    var cards = [];
    for (var c = 0; c < CARD_COUNT; c++) {
      var entry = buildCard(c);
      cards.push(entry);
      scene.appendChild(entry.el);
    }

    var stage = el('div', 'cw__stage');
    stage.setAttribute('aria-hidden', 'true');
    stage.appendChild(scene);

    return { stage: stage, cards: cards };
  }

  function buildCopy(headline) {
    var copy = el('div', 'cw__copy');

    var kicker = el('p', 'cw__kicker');
    kicker.textContent = KICKERS[0];

    var h1 = el('h1', 'cw__headline');
    h1.innerHTML = headline;

    var progress = el('div', 'cw__progress');
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

    host.className = 'cw';
    // Left unset, the loader follows the OS via color-scheme; pass a theme to pin it.
    if (opts.theme) host.setAttribute('data-theme', opts.theme);
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-busy', 'true');
    host.setAttribute('aria-label', opts.label || 'Loading today’s brief');
    host.textContent = '';

    var brand = el('div', 'cw__brand');
    brand.setAttribute('aria-hidden', 'true');
    brand.innerHTML = 'Precis<b>.</b>';

    var scene = buildScene();
    var copy = buildCopy(opts.headline || 'Assembling today’s <span>edition.</span>');

    host.appendChild(brand);
    host.appendChild(scene.stage);
    host.appendChild(copy.copy);

    var timers = [];

    if (!reduced) {
      // Each time a card comes round again it is a different story, so it gets
      // the next tag from its worker's run. The swap happens on the iteration
      // boundary, where the card is transparent under the press.
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
    carrier.className = 'cw';
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

    var from = piece.getBoundingClientRect();
    var face = piece.querySelector('.f-top');
    if (!from.width || !face) return false;

    var ghost = el('div', 'cw-flight__piece');
    ghost.style.left = from.left + 'px';
    ghost.style.top = from.top + 'px';
    ghost.style.width = from.width + 'px';
    ghost.style.height = from.height + 'px';

    // Both classes: .cw-box gives the face its fill and radius, the piece's own
    // class its inner layout. The inline reset then strips what that class says
    // about where the piece sits in the scene, opacity included.
    var shell = el('div', 'cw-box ' + shellClass);
    shell.style.cssText =
      'position:absolute;inset:0;width:auto;height:auto;opacity:1;transform:none;animation:none;filter:none;';
    shell.appendChild(face.cloneNode(true));
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
    var flight = el('div', 'cw-flight');
    var theme = carrier.getAttribute('data-theme');

    if (theme) flight.setAttribute('data-theme', theme);
    flight.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flight);

    // The board first, so the cards are stacked above it all the way down.
    var board = carrier.querySelector('.cw__board');
    if (board && !launchGhost(flight, board, 'cw__board', sections.lead, 0)) dismissPiece(board);

    var cards = carrier.querySelectorAll('.cw__card');
    var rows = sections.rows || [];
    var nextRow = 0;
    for (var i = 0; i < cards.length; i++) {
      var target = i === RISING_CARD ? sections.rising : rows[nextRow++];
      var delay = BIND_CARD_LEAD_MS + i * BIND_STAGGER_MS;
      if (!launchGhost(flight, cards[i], 'cw__card', target, delay)) dismissPiece(cards[i]);
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
        // A bare list is taken as rows, for a caller with nothing else to offer.
        if (Array.isArray(sections)) sections = { rows: sections };
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
