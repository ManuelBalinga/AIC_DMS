#!/usr/bin/env node
/**
 * Reads the palette out of `src/app/globals.css` and checks every pairing the
 * interface actually renders, in both themes.
 *
 * It parses the stylesheet rather than carrying its own copy of the values,
 * because a checker with a second copy of the palette passes forever after
 * somebody edits the first one. If a token is renamed here without being
 * renamed there, this fails loudly instead of quietly checking nothing.
 *
 * Thresholds are WCAG 2.2: 4.5:1 for body text (1.4.3), 3:1 for the boundary
 * of something you can operate (1.4.11). The tier that failed in review was
 * `ink-faint`, which had been assumed rather than measured.
 */

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** Pull `--color-x: #hex` pairs out of a slice of the stylesheet. */
function palette(slice) {
  const out = {};
  for (const [, name, hex] of slice.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[name] = hex;
  }
  return out;
}

const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
if (darkAt === -1) {
  console.error("No dark block found in globals.css — has the theme structure changed?");
  process.exit(1);
}

const light = palette(css.slice(0, darkAt));
// Dark redefines only what changes, so it inherits the rest of the light scale.
const dark = { ...light, ...palette(css.slice(darkAt)) };

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const [r, g, b] = hex.slice(1).match(/../g).map((h) => parseInt(h, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, floor] — every pairing the app puts on screen. */
const PAIRS = [
  ["ink", "surface", 4.5],
  ["ink", "canvas", 4.5],
  ["ink", "surface-sunk", 4.5],
  ["ink-soft", "surface", 4.5],
  ["ink-soft", "canvas", 4.5],
  ["ink-soft", "surface-sunk", 4.5],
  ["ink-faint", "surface", 4.5],
  ["ink-faint", "canvas", 4.5],
  ["ink-faint", "surface-sunk", 4.5],
  ["accent-ink", "accent", 4.5],
  // Control boundaries stand alone, so they answer to 1.4.11 rather than 1.4.3.
  ["control", "surface", 3],
  ["control", "surface-sunk", 3],
  ["accent", "surface", 3],
];

let failures = 0;

for (const [themeName, theme] of [
  ["light", light],
  ["dark", dark],
]) {
  console.log(`\n${themeName}`);
  for (const [fg, bg, floor] of PAIRS) {
    if (!theme[fg] || !theme[bg]) {
      console.log(`  MISSING  ${fg} on ${bg} — token not found in the stylesheet`);
      failures += 1;
      continue;
    }
    const ratio = contrast(theme[fg], theme[bg]);
    const ok = ratio >= floor;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(5)} : 1  (needs ${floor})  ${fg} on ${bg}`,
    );
  }
}

console.log(
  failures === 0
    ? `\nAll ${PAIRS.length * 2} pairings clear their threshold.`
    : `\n${failures} pairing${failures === 1 ? "" : "s"} below threshold.`,
);

process.exit(failures === 0 ? 0 : 1);
