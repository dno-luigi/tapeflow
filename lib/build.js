// Which build is this? The stamp is written by scripts/build-stamp.mjs at the
// start of every build and of the dev server, so the number on the back panel
// and the first console line are the same thing the deploy shipped.
import { BUILD } from './buildInfo';

export const buildId = BUILD.id;
export const buildCommit = BUILD.commit;
export const buildBranch = BUILD.branch;
export const builtAt = BUILD.builtAt;

// `2026-11-23T04:12:07Z` reads more clearly as `2026-11-23 04:12Z` on a
// two-line panel; minutes are enough to compare two deploys by eye.
export const builtAtShort = `${builtAt.slice(0, 16).replace('T', ' ')}Z`;

export const buildLabel = `${buildId} · ${builtAtShort}`;

let logged = false;

// Once per page load, at the top of the console, so the live build can be
// checked without opening the back panel.
export function logBuildOnce() {
  if (logged) return;
  logged = true;
  const where = buildBranch ? ` (${buildBranch})` : '';
  try {
    console.info(`[TRNV] build ${buildId}${where} · ${builtAtShort}`);
  } catch (e) {
    /* a browser without a console must not stop the app */
  }
}
