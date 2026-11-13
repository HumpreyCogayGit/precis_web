/* Chooses which loading scene this visit gets, and loads it.
 *
 * public/loader/ holds three interchangeable scenes -- a stylesheet and a
 * script each, all defining the same window.PrecisLoader:
 *
 *   loader   the wire desk       preview: loader.html
 *   sorter   the sorting line    preview: sorter.html
 *   crew     the workshop        preview: crew.html
 *
 * One is picked at random on every page load. The boot splash and the app's
 * own loader (NewsLoader.jsx) both go through window.PrecisLoader, so they
 * always show the same scene within a visit.
 *
 * To pin one scene for everybody, leave only its name in SCENES. To look at a
 * particular one, add ?loader=<name> to the address.
 */
(function () {
  'use strict';

  var SCENES = ['loader', 'sorter', 'crew'];

  // The address can only choose from the list; it is never used as a path.
  var asked = /[?&]loader=([a-z]+)(?:&|$)/.exec(window.location.search);
  var name = asked && SCENES.indexOf(asked[1]) !== -1
    ? asked[1]
    : SCENES[Math.floor(Math.random() * SCENES.length)];

  /* document.write, on purpose. Written during parsing, these two tags behave
     exactly like the static <link> and <script> they replace: the stylesheet
     blocks rendering and the script runs before the app bundle, so
     window.PrecisLoader exists by the time main.jsx and NewsLoader look for
     it. Elements appended with the DOM API load asynchronously instead, and
     the app could then start before its loader had arrived -- with the boot
     splash mounting late and never being dismissed. This file is a plain
     same-origin parser-inserted script, which is the case document.write is
     still reliable for. */
  document.write(
    '<link rel="stylesheet" href="/loader/' + name + '.css" />' +
    '<script src="/loader/' + name + '.js"><\/script>'
  );
})();
