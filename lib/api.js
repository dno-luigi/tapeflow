// The one place the app talks to the server.
//
// The API is a Cloudflare Worker (worker/index.js) served from the same origin
// as the web build, so by default there is no base URL to configure. A native
// build or the Expo dev server points at the Worker instead:
//
//   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8787 npx expo start
//
// Expo inlines EXPO_PUBLIC_* variables at build time, which is why the value is
// read here rather than fetched at runtime.
const RAW_BASE =
  (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_API_BASE) || '';

export const API_BASE = String(RAW_BASE).replace(/\/+$/, '');

// A request that never returns is worse than one that fails: there is nothing
// to retry and nothing to read.
const DEFAULT_TIMEOUT_MS = 20000;

function statusMessage(status, fallback) {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status === 503) return 'The server is not ready yet. Try again shortly.';
  return fallback || 'Could not reach the server. Try again.';
}

/**
 * POST one JSON body to the API and return the parsed `{ ok: true, ... }`.
 *
 * Throws an Error carrying `.code` (the server's error name, or `network`) and
 * `.status`, so callers can branch on a code rather than on wording.
 */
export async function request(path, options) {
  const opts = options || {};
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method || 'POST',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || String(e.message || '').indexOf('Abort') >= 0);
    const lost = new Error(
      aborted
        ? 'That took too long. Check your connection and try again.'
        : 'Could not reach the server. Check your connection and try again.',
    );
    // No answer arrived, which is not the same as a refusal.
    lost.code = 'network';
    throw lost;
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok || !data || data.ok !== true) {
    const code = (data && data.error) || 'request_failed';
    const err = new Error((data && data.details) || statusMessage(res.status, opts.fallback));
    err.code = code;
    err.status = res.status;
    throw err;
  }

  return data;
}

export default { request, API_BASE };
