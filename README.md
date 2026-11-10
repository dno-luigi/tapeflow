# TapeFlow

A four-track field recorder built around a speed-adjusting wheel: the reel is the
control surface, so playback speed, direction and scratching are the same
gesture. Tracks carry modular tape effects (saturation, hiss, flutter per track
or as a master bus), and sessions can be bounced and shared across devices.

The app is Expo / React Native and runs on iOS, Android and the web from one
codebase.

## History: WRON → GitHub → Cloudflare

This project was generated on **WRON** and exported. The export kept the UI but
pointed every backend call at `wron.ai`: accounts (`lib/wron-auth.js`), session
sync (`lib/wron-db.js`) and the AI/notification helpers (`lib/wron-ai.js`), plus
artwork on WRON's Firebase bucket and a preview-error beacon in `ui/theme.js`.

The migration replaced all of that:

| Before (WRON)                              | Now                                                        |
| ------------------------------------------ | ---------------------------------------------------------- |
| `wron.ai/api/agent/…` auth + database      | `worker/index.js` + D1, same origin (`/api/…`)             |
| `lib/wron-auth.js`                         | `lib/auth.js` (email + password, bearer session tokens)    |
| `lib/wron-db.js`                           | `lib/db.js` (same offline queue, D1-backed transport)      |
| `lib/wron-ai.js`                           | `lib/reminders.js` (device-only local notifications)       |
| Artwork on the WRON Firebase bucket        | `assets/artwork/*.webp`, bundled and served from our origin |
| Preview error beacon to `wron.ai`          | removed; the screen boundary logs to the console           |
| Zip-extraction CI workflow                 | `.github/workflows/deploy-cloudflare.yml`                  |

## Layout

```
worker/index.js        Cloudflare Worker: /api/* routes, then the web build
db/schema.sql          D1 schema (users, auth_sessions, records)
lib/api.js             one fetcher, typed errors
lib/auth.js            sign up / in / out / delete, session on the device
lib/db.js              session rows with an offline write queue
lib/reminders.js       local notification scheduling
store/StudioContext.js studio state; AsyncStorage is the source of truth
screens/, components/  the deck, wheel, DJ mode, back panel, sessions
dist/                  build output (generated; not committed)
```

Data flow: the studio always writes to the device first. `lib/db.js` mirrors a
session row to D1 when someone is signed in; if nobody is, the write is queued on
the device and flushed after sign-in. Recording never needs an account.

## Run it locally

```bash
npm install

# 1. the API, on http://127.0.0.1:8787
npm run db:local          # create the local D1 tables (safe to re-run)
npm run worker:dev

# 2. the app, pointed at that API
EXPO_PUBLIC_API_BASE=http://127.0.0.1:8787 npx expo start --web
```

`EXPO_PUBLIC_API_BASE` is inlined at build time; leave it unset for the deployed
site, where the API is the same origin as the app.

To preview the production build instead, `npm run preview` builds the web bundle
and serves `dist/` through the Worker.

## Deploy to Cloudflare

One-time setup (needs a Cloudflare account, `npx wrangler login`):

```bash
npx wrangler d1 create tapeflow
# copy the printed database_id into wrangler.jsonc
npm run db:remote
npm run deploy
```

`npm run deploy` builds the Expo web app into `dist/` and uploads the Worker,
the assets and the `DB` binding. The Worker runs first for every request: `/api/*`
is answered by `worker/index.js`, everything else falls through to `ASSETS`, and
`not_found_handling: single-page-application` makes deep links load the app.

### Continuous deployment

`.github/workflows/deploy-cloudflare.yml` builds and deploys on every push to
`main`. Add these repository secrets:

| Secret                  | Where to get it                                             |
| ----------------------- | ----------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages → Account ID                                 |

Optionally set the `TAPEFLOW_URL` repository variable (e.g.
`https://tapeflow.example.workers.dev`); the workflow then smoke-tests
`/api/health` after deploying.

## API

All JSON, `Authorization: Bearer <token>` where a session is required. Errors are
`{ ok: false, error, details }` with a matching HTTP status.

| Route               | Body                              | Purpose                        |
| ------------------- | --------------------------------- | ------------------------------ |
| `POST /api/auth/signup`  | `{ email, password, name? }` | create an account, returns token |
| `POST /api/auth/signin`  | `{ email, password }`        | returns token                  |
| `POST /api/auth/signout` | —                            | revokes the token              |
| `POST /api/auth/me`      | —                            | the signed-in user             |
| `POST /api/auth/delete`  | —                            | deletes the account and its rows |
| `POST /api/db`           | `{ op, table, … }`           | `insert` / `update` / `delete` / `list` |
| `GET  /api/health`       | —                            | readiness                      |

Passwords are PBKDF2-SHA256 (100k iterations, per-user salt). Session tokens are
stored only as SHA-256 hashes and expire after 90 days. Row ownership comes from
the token, never from the request body.

## Known gaps after the migration

- **Google and Apple sign-in are removed.** They went through WRON's OAuth
  broker. Restoring them means registering an OAuth client and a callback scheme
  — a separate piece of work, not a flag.
- **The AI helpers are gone** (chat, vision, transcription, image generation).
  Nothing in the shipped UI imported them; they needed WRON's provider keys.
- **No privacy policy page.** The Back Panel's link pointed at WRON's policy and
  has been removed. Apple requires a reachable policy before submission.
- **Web recording needs an input device.** In a browser the deck records through
  `MediaRecorder` (via `expo-audio`), which needs a microphone and a secure
  context (https or localhost). A machine with no audio input — most cloud VMs, CI
  runners — gets `NotFoundError`; the deck says so in its legend and points at the
  **upload key** in the top bar, which brings an audio file in as a take at the
  tape head instead. That path needs no microphone at all.
- **`Alert` is shimmed on web.** `react-native-web` ships `Alert` as a no-op, so
  confirmations and errors were silent in a browser. `ui/native-shim.js` now maps
  them to the browser's `alert`/`confirm`, which is what makes "Delete session",
  sign-out and record failures visible on the web.
