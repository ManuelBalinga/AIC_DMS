#!/usr/bin/env node
/**
 * Derives a publishable copy of PROJECT_STATUS.html for hosting as an Artifact.
 *
 * The status page is a complete HTML document. An Artifact supplies its own
 * <!doctype>, <html>, <head> and <body>, so publishing the file as-is would nest
 * one document inside another. This lifts out the stylesheet and the body
 * content and leaves the wrapper behind.
 *
 * Mechanical on purpose. Retyping a 46 KB page to publish it risks silent
 * corruption, and a second hand-maintained copy would drift from the source the
 * first time somebody edited one and forgot the other. Run this, publish the
 * output, and the two are identical by construction.
 *
 *   npm run status:artifact
 *
 * Then publish build/status-artifact.html to the existing Artifact URL.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SOURCE = "PROJECT_STATUS.html";
const TARGET = "build/status-artifact.html";

/**
 * The name the page carries in an Artifact gallery, which is a different job
 * from the heading inside the document: among dozens of artifacts it has to
 * identify this one, so it is a name rather than a document title.
 */
const GALLERY_TITLE = "AIC Document Platform Status";

// Normalised to LF on read. A Windows checkout stores this file with CRLF and
// Node preserves it, so newlines inside the patterns below would fail to match
// and the theme rewrite would silently do nothing.
const source = readFileSync(SOURCE, "utf8").split("\r\n").join("\n");

const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const body = source.match(/<body>([\s\S]*?)<\/body>/)?.[1]?.trim();

if (!style || !body) {
  console.error(
    `${SOURCE} is not the expected shape: needs a <style> block and a <body>.`,
  );
  process.exit(1);
}

/**
 * Theme handling.
 *
 * The source answers `prefers-color-scheme` only. An Artifact viewer has three
 * states, because an explicit choice stamps `data-theme` on the root element and
 * the default "system" setting stamps nothing. Without handling both, picking a
 * theme in the viewer does nothing.
 *
 * The dark tokens are lifted verbatim rather than restated, so the two paths
 * cannot drift.
 */
const darkTokens = style.match(
  /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}\s*\}/,
)?.[1];

if (!darkTokens) {
  console.error(
    "Could not find the dark-theme token block. Aborting rather than publishing a page that works in only one theme.",
  );
  process.exit(1);
}

const themed =
  style.replace(
    // Guarded so an explicit light choice beats a dark operating system.
    /@media \(prefers-color-scheme: dark\) \{(\s*):root \{/,
    '@media (prefers-color-scheme: dark) {$1:root:not([data-theme="light"]) {',
  ) +
  "\n\n  /* Explicit theme choice from the viewer, same tokens as above. */\n" +
  `  :root[data-theme="dark"] {${darkTokens.trimEnd()}\n  }\n`;

const out = `<title>${GALLERY_TITLE}</title>\n\n<style>${themed}</style>\n\n${body}\n`;

// Verified rather than assumed: this transformation failed silently once
// already, and a page that ignores the viewer's theme choice still looks
// correct in whichever theme the author happened to be using.
for (const [needle, what] of [
  [':root:not([data-theme="light"])', "the prefers-color-scheme guard"],
  [':root[data-theme="dark"]', "the explicit dark-theme block"],
]) {
  if (!out.includes(needle)) {
    console.error(`Derivation failed: ${what} is missing from the output.`);
    process.exit(1);
  }
}

mkdirSync("build", { recursive: true });
writeFileSync(TARGET, out, "utf8");

const pills = (out.match(/class="pill/g) ?? []).length;
console.log(`${SOURCE} -> ${TARGET}`);
console.log(`  ${out.length} bytes, ${pills} status pills carried over`);
