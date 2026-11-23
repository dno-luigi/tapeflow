// Radio: a playlist link, resolved into songs the reel can play.
//
// The page it points at is read by our own Worker (worker/radio.js): the browser
// cannot fetch open.spotify.com or audiomack.com directly (their CORS policy is
// not ours to change), and going through the Worker also keeps the matching of
// missing audio in one place instead of in the UI.
import { request } from './api';

// Parsing a playlist plus matching previews takes a handful of upstream calls,
// so this is allowed longer than an ordinary API request.
const RESOLVE_TIMEOUT_MS = 45000;

/**
 * Resolves a pasted link into `{ title, source, artwork, tracks }`.
 * Each track is `{ title, artist, artwork, url, duration, preview, page }`;
 * `url` is null when that song has no audio this app may play.
 */
export async function resolveRadio(link) {
  const data = await request('/api/radio/resolve', {
    body: { url: String(link || '').trim() },
    timeoutMs: RESOLVE_TIMEOUT_MS,
  });
  const playlist = data.playlist || null;
  if (!playlist || !Array.isArray(playlist.tracks)) {
    const err = new Error('That playlist came back empty.');
    err.code = 'empty_playlist';
    throw err;
  }
  return playlist;
}

// What the import can promise, said plainly where the link is pasted.
export const RADIO_SOURCES = [
  {
    id: 'spotify',
    label: 'SPOTIFY',
    detail: 'Playlist, album or track link · 30-second previews',
  },
  {
    id: 'audiomack',
    label: 'AUDIOMACK',
    // Said here, before anything is pasted: Audiomack's own streams are not
    // public, so what plays is a matched 30-second preview, never the full song.
    detail: 'Playlist, album or song link · 30-second previews matched from iTunes, not full songs',
  },
  {
    id: 'files',
    label: 'YOUR FILES',
    detail: 'An .m3u/.pls playlist or a direct audio link · plays in full',
  },
];

export const SOURCE_LABEL = {
  spotify: 'SPOTIFY',
  audiomack: 'AUDIOMACK',
  playlist: 'PLAYLIST FILE',
  audio: 'AUDIO LINK',
};

export default { resolveRadio, RADIO_SOURCES, SOURCE_LABEL };
