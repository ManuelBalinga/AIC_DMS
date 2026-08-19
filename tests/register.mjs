/**
 * Installs the `@/*` resolve hook before any test module loads.
 *
 * Loaded with `node --import ./tests/register.mjs`, which runs early enough
 * that the hook is in place before the first `import` in a test file resolves.
 */

import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
