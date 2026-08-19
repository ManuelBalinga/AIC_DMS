/**
 * Module resolve hook that teaches plain Node the `@/*` path alias.
 *
 * The application's imports are written as `@/modules/rag/chunk`, which Next
 * resolves from `tsconfig.json`. Node has no such notion, so without this the
 * tests could only reach modules that import nothing — which is to say, almost
 * nothing worth testing.
 *
 * Deliberately a resolve hook rather than a test-runner dependency: the whole
 * suite then runs on Node alone, and the tests exercise the real source files
 * rather than a bundler's transformation of them.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

/** Extension-less specifiers are the norm in the app; Node requires the file. */
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const relative = specifier.slice(2);

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = new URL(`${relative}${suffix}`, SRC);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate.href, context);
    }
  }

  throw new Error(
    `Could not resolve "${specifier}" under ${fileURLToPath(SRC)}. ` +
      `Tried: ${CANDIDATE_SUFFIXES.map((s) => `${relative}${s}`).join(", ")}`,
  );
}
