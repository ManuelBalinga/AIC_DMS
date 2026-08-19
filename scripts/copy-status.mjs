#!/usr/bin/env node
/**
 * Copies PROJECT_STATUS.html into `public/` so a deployment serves it.
 *
 * Runs as `prebuild`, which means the published page is rebuilt from the source
 * file on every deploy. The alternative — committing a second copy under
 * `public/` — creates two files that must be kept identical by hand, and the
 * published one would quietly go stale the first time somebody forgot.
 *
 * `public/status.html` is gitignored for the same reason: it is a build output,
 * not a source file.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const SOURCE = "PROJECT_STATUS.html";
const TARGET = "public/status.html";

if (!existsSync(SOURCE)) {
  // Not fatal: a checkout without the status page should still build.
  console.warn(`prebuild: ${SOURCE} not found, skipping status page copy.`);
  process.exit(0);
}

mkdirSync("public", { recursive: true });
copyFileSync(SOURCE, TARGET);

console.log(`prebuild: ${SOURCE} -> ${TARGET}`);
