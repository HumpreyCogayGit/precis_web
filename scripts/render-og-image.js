#!/usr/bin/env node
// One-off: renders assets/og-default.svg to react-app/public/og-default.png, the
// 1200x630 link-preview image. Run it again after editing the SVG and commit the PNG.
// resvg-wasm has no system fonts, so the fonts the SVG names are passed in:
//   node scripts/render-og-image.js "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf" \
//     /System/Library/Fonts/Supplemental/Arial.ttf "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
const fs = require('node:fs');
const path = require('node:path');
const { Resvg, initWasm } = require('@resvg/resvg-wasm');

async function main(fontPaths) {
  if (fontPaths.length === 0) {
    throw new Error('Pass the font files the SVG uses (see the header comment).');
  }

  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const root = path.resolve(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'assets', 'og-default.svg'), 'utf8');
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fontPaths.map((p) => fs.readFileSync(p)), loadSystemFonts: false },
  });
  const out = path.join(root, 'react-app', 'public', 'og-default.png');
  fs.writeFileSync(out, resvg.render().asPng());
  console.log(`wrote ${path.relative(root, out)}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
