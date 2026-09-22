const fs = require('node:fs');
const { Resvg, initWasm } = require('@resvg/resvg-wasm');

// SVG is never served as SVG: a document that can carry script does not belong on
// this origin. Some sources (Xiaomi MiMo) publish nothing but SVG figures, though, so
// the proxy renders them to PNG and sends that instead. resvg does not execute
// script, and with no resolver attached it loads no external resource — only data:
// URIs embedded in the file — so rendering makes no network request of its own.
//
// Output is capped so a huge or extreme-aspect viewBox cannot become a pixel bomb:
// small figures render at 2x for sharpness, large ones scale down to fit.
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 2400;
const MAX_SCALE = 2;

let wasmReady = null;

function ensureWasm() {
  if (!wasmReady) {
    wasmReady = initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
      .catch((err) => {
        // A failed load is retried on the next request instead of poisoning the instance.
        wasmReady = null;
        throw err;
      });
  }
  return wasmReady;
}

async function rasterizeSvg(svg) {
  await ensureWasm();
  const options = { font: { loadSystemFonts: false } };
  const measured = new Resvg(svg, options);
  const { width, height } = measured;
  measured.free();

  if (!(width > 0) || !(height > 0)) {
    throw new Error('SVG has no drawable size');
  }

  const scale = Math.min(MAX_SCALE, MAX_WIDTH / width, MAX_HEIGHT / height);
  // Figures are drawn for a white page; a transparent PNG would lose its dark lines
  // and text against the dark theme's image tile.
  const resvg = new Resvg(svg, {
    ...options,
    background: '#ffffff',
    fitTo: { mode: 'zoom', value: scale },
  });
  try {
    const rendered = resvg.render();
    const png = Buffer.from(rendered.asPng());
    rendered.free();
    return png;
  } finally {
    resvg.free();
  }
}

module.exports = { rasterizeSvg };
