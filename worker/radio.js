/**
 * TapeFlow radio — turn a playlist link into a reel.
 *
 * A playlist is imported as a list of songs; the app lays them end to end on one
 * tape so the wheel plays, spins, slows and scratches through it.
 *
 * Where the audio comes from, and why:
 *   Spotify    The public embed page ships each track's 30-second preview MP3.
 *              Full tracks are DRM-locked to Spotify's own player, so a 30s
 *              preview is what any third-party player can honestly play.
 *   Audiomack  The public embed page ships the track list. Audiomack's stream
 *              URLs are signed by their OAuth API and are not public, so each
 *              song is matched to a 30-second preview from the iTunes catalogue
 *              and songs that cannot be matched are left without audio rather
 *              than replaced with the wrong song.
 *   M3U / audio links  Played in full: these are files the person already has.
 *
 * Everything here is a public page or a public search API. Nothing is proxied
 * through a paid account and no stream protection is worked around.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const FETCH_TIMEOUT_MS = 12000;
// A reel is a mixtape, not a library: this many songs keeps a page's worth of
// players sensible and finishes the import well inside the request timeout.
const MAX_TRACKS = 24;
const PREVIEW_SECONDS = 30;

function failure(error, details, status) {
  return { status: status || 400, body: { ok: false, error, details: details || error } };
}

async function getText(url, accept) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: controller ? controller.signal : undefined,
      redirect: 'follow',
    });
    if (!res.ok) {
      const err = new Error('upstream_' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getJson(url) {
  const text = await getText(url, 'application/json');
  return JSON.parse(text);
}

function tidy(value) {
  // Spotify's artist strings use non-breaking spaces between names.
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (whole, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 ? String.fromCharCode(n) : whole;
    });
}

// ── which service is this link? ────────────────────────────────────────────

function parseTarget(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  // Spotify app links: spotify:playlist:ID
  const uri = /^spotify:(playlist|album|track):([A-Za-z0-9]+)$/.exec(input);
  if (uri) return { service: 'spotify', kind: uri[1], id: uri[2] };

  let url;
  try {
    url = new URL(input.indexOf('//') < 0 && !/^https?:/i.test(input) ? 'https://' + input : input);
  } catch (e) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    // /playlist/ID, /album/ID, /track/ID — and the /intl-xx/ prefixed forms.
    const clean = parts[0] === 'intl-xx' || /^intl-/.test(parts[0]) ? parts.slice(1) : parts;
    if (clean.length >= 2 && ['playlist', 'album', 'track'].indexOf(clean[0]) >= 0) {
      return { service: 'spotify', kind: clean[0], id: clean[1] };
    }
    return null;
  }

  if (host === 'audiomack.com') {
    // /<artist>/playlist/<slug>, /<artist>/album/<slug>, /<artist>/song/<slug>
    if (parts.length >= 3 && ['playlist', 'album', 'song'].indexOf(parts[1]) >= 0) {
      return { service: 'audiomack', artist: parts[0], kind: parts[1], slug: parts.slice(2).join('/') };
    }
    return null;
  }

  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(url.pathname)) {
    return { service: 'audio', url: url.toString() };
  }
  if (/\.(m3u|m3u8|pls|txt)(\?|#|$)/i.test(url.pathname)) {
    return { service: 'playlist-file', url: url.toString() };
  }
  return null;
}

// ── Spotify ────────────────────────────────────────────────────────────────

function spotifyTracks(entity) {
  if (!entity) return [];
  const entityArt = entity.coverArt && entity.coverArt.sources && entity.coverArt.sources[0]
    ? entity.coverArt.sources[0].url
    : null;
  const list = Array.isArray(entity.trackList)
    ? entity.trackList
    : entity.entityType === 'track' || String(entity.uri || '').indexOf('spotify:track:') === 0
      ? [entity]
      : [];
  return list
    .filter((t) => t && (t.title || t.name))
    .map((t) => {
      const preview = t.audioPreview && t.audioPreview.url ? t.audioPreview.url : null;
      const uri = String(t.uri || '');
      const page = uri.indexOf('spotify:') === 0
        ? 'https://open.spotify.com/' + uri.split(':').slice(1).join('/')
        : null;
      return {
        title: tidy(t.title || t.name || 'Untitled'),
        artist: tidy(t.subtitle || t.artist || ''),
        artwork: (t.coverArt && t.coverArt.sources && t.coverArt.sources[0] && t.coverArt.sources[0].url) || entityArt,
        url: preview,
        duration: preview ? PREVIEW_SECONDS : Math.max(1, Math.round((Number(t.duration) || 0) / 1000)) || PREVIEW_SECONDS,
        preview: !!preview,
        page,
      };
    });
}

async function resolveSpotify(target) {
  const html = await getText('https://open.spotify.com/embed/' + target.kind + '/' + target.id);
  const match = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('spotify_layout');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    throw new Error('spotify_layout');
  }
  const state = data && data.props && data.props.pageProps && data.props.pageProps.state;
  const entity = (state && state.data && state.data.entity) || null;
  const tracks = spotifyTracks(entity);
  if (!tracks.length) throw new Error('spotify_empty');
  const art = entity && entity.coverArt && entity.coverArt.sources && entity.coverArt.sources[0];
  return {
    title: tidy((entity && (entity.name || entity.title)) || 'Spotify playlist'),
    source: 'spotify',
    artwork: art ? art.url : null,
    tracks,
  };
}

// ── Audiomack ──────────────────────────────────────────────────────────────

function audiomackTracks(html) {
  // The embed page renders one row per song: an index, the title, the artist and
  // a link to the song. The class hashes change between builds, so only the
  // stable parts of each class name are matched.
  const row = new RegExp(
    '>(\\d+)<!-- -->\\.' + // 1: position
      '|<p class="[^"]*text_weight-700[^"]*text_noOfLines-1[^"]*">([^<]{1,300})</p>' + // 2: title
      '|music-showcase-list_textArtist[^"]*"><a[^>]*>([^<]{1,200})</a>' + // 3: artist
      '|href="https://audiomack\\.com/([^"]+/song/[^"]+)"', // 4: song page
    'g'
  );
  const found = new Map();
  let current = 0;
  let m = row.exec(html);
  while (m) {
    if (m[1]) {
      current = Number(m[1]);
      if (!found.has(current)) found.set(current, {});
    } else if (current) {
      const entry = found.get(current) || {};
      if (m[2] && !entry.title) entry.title = tidy(decodeEntities(m[2]));
      else if (m[3] && !entry.artist) entry.artist = tidy(decodeEntities(m[3]));
      else if (m[4] && !entry.page) entry.page = 'https://audiomack.com/' + m[4];
      found.set(current, entry);
    }
    m = row.exec(html);
  }
  return Array.from(found.keys())
    .sort((a, b) => a - b)
    .map((n) => found.get(n))
    .filter((t) => t && t.title);
}

function pageTitle(html, fallback) {
  // The embed's <title> is the platform's own boilerplate ("Audiomack - Music
  // platform…"), which is no use as a reel name. The playlist's cover carries
  // the real one as "<playlist> by <owner>".
  const cover = /alt="([^"]{1,160}?) by [^"]{1,120}"/i.exec(html);
  if (cover) return decodeEntities(cover[1]).trim() || fallback;
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]{1,200})"/i.exec(html);
  const clean = (value) =>
    decodeEntities(value)
      .replace(/\s*[-|]\s*Audiomack.*$/i, '')
      .replace(/\s*by [^|]{1,120}$/i, '')
      .trim();
  if (og) {
    const title = clean(og[1]);
    if (title && !/^audiomack$/i.test(title)) return title;
  }
  const tag = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html);
  if (tag) {
    const title = clean(tag[1]);
    if (title && !/audiomack/i.test(title)) return title;
  }
  return fallback;
}

async function resolveAudiomack(target) {
  const url = 'https://audiomack.com/embed/' + target.artist + '/' + target.kind + '/' + target.slug;
  const html = await getText(url);
  const tracks = audiomackTracks(html);
  if (!tracks.length) throw new Error('audiomack_empty');
  return {
    title: pageTitle(html, target.slug.replace(/-/g, ' ')),
    source: 'audiomack',
    artwork: null,
    tracks: tracks.map((t) => ({
      title: t.title,
      artist: t.artist || '',
      artwork: null,
      url: null,
      duration: null,
      preview: true,
      page: t.page || null,
    })),
  };
}

// ── 30-second previews from the public iTunes catalogue ─────────────────────

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(feat[^)]*\)|\[[^\]]*\]|\(with[^)]*\)/g, ' ')
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalise(value).split(' ').filter(Boolean));
}

// How much of `wanted` the candidate contains. 1 is a perfect containment.
function coverage(wanted, candidate) {
  const a = tokens(wanted);
  if (!a.size) return 0;
  const b = tokens(candidate);
  let hit = 0;
  a.forEach((t) => {
    if (b.has(t)) hit += 1;
  });
  return hit / a.size;
}

function looksLikeSameSong(item, wanted) {
  return (
    coverage(wanted.title, item.trackName) >= 0.75 &&
    (coverage(wanted.artist, item.artistName) >= 0.5 || coverage(item.artistName, wanted.artist) >= 0.75)
  );
}

async function previewFor(wanted) {
  const term = (wanted.title + ' ' + wanted.artist).trim();
  if (!term) return null;
  const query =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(term) +
    '&media=music&entity=song&limit=6';
  let data;
  try {
    data = await getJson(query);
  } catch (e) {
    return null;
  }
  const results = (data && data.results) || [];
  const hit = results.find((item) => item && item.previewUrl && looksLikeSameSong(item, wanted));
  if (!hit) return null;
  return {
    url: hit.previewUrl,
    artwork: String(hit.artworkUrl100 || '').replace(/\/100x100bb\./, '/300x300bb.') || null,
    duration: PREVIEW_SECONDS,
  };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let cursor = 0;
  const workers = [];
  const count = Math.min(limit, list.length);
  for (let w = 0; w < count; w += 1) {
    workers.push(
      (async () => {
        while (cursor < list.length) {
          const i = cursor;
          cursor += 1;
          try {
            out[i] = await fn(list[i], i);
          } catch (e) {
            out[i] = null;
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  return out;
}

async function fillPreviews(tracks) {
  const trimmed = tracks.slice(0, MAX_TRACKS);
  const filled = await mapLimit(trimmed, 4, async (track) => {
    if (track.url) return track;
    const hit = await previewFor(track);
    if (!hit) return track;
    return {
      ...track,
      url: hit.url,
      artwork: track.artwork || hit.artwork,
      duration: track.duration || hit.duration,
      preview: true,
    };
  });
  return filled.map((track) => ({
    ...track,
    duration: Math.max(2, Number(track.duration) || PREVIEW_SECONDS),
    preview: !!track.preview,
  }));
}

// ── playlist files and plain audio links ───────────────────────────────────

function resolveUrlMaybe(value, base) {
  try {
    return new URL(value, base).toString();
  } catch (e) {
    return null;
  }
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Audio';
    return decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, '')).replace(/[_+]+/g, ' ').trim() || 'Audio';
  } catch (e) {
    return 'Audio';
  }
}

function parseM3U(text, base) {
  const out = [];
  let pending = null;
  text.split(/\r?\n/).forEach((line) => {
    const l = line.trim();
    if (!l) return;
    if (l.charAt(0) === '#') {
      if (/^#EXTINF:/i.test(l)) {
        const meta = l.replace(/^#EXTINF:/i, '');
        const comma = meta.indexOf(',');
        const seconds = Number(comma >= 0 ? meta.slice(0, comma) : meta);
        pending = {
          duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
          title: comma >= 0 ? meta.slice(comma + 1).trim() || null : null,
        };
      }
      return;
    }
    const url = resolveUrlMaybe(l, base);
    if (!url || !/^https?:/i.test(url)) return;
    out.push({
      title: (pending && pending.title) || nameFromUrl(url),
      artist: '',
      artwork: null,
      url,
      duration: (pending && pending.duration) || null,
      preview: false,
      page: null,
    });
    pending = null;
  });
  return out;
}

function parsePLS(text, base) {
  const out = [];
  text.split(/\r?\n/).forEach((line) => {
    const m = /^\s*File\d*\s*=\s*(.+)$/i.exec(line);
    if (!m) return;
    const url = resolveUrlMaybe(m[1].trim(), base);
    if (!url || !/^https?:/i.test(url)) return;
    out.push({ title: nameFromUrl(url), artist: '', artwork: null, url, duration: null, preview: false, page: null });
  });
  return out;
}

function parseBareUrls(text, base) {
  const out = [];
  text.split(/\r?\n/).forEach((line) => {
    const l = line.trim();
    if (!l || l.charAt(0) === '#' || /\s/.test(l)) return;
    if (!/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(l) && !/^https?:\/\//i.test(l)) return;
    const url = resolveUrlMaybe(l, base);
    if (!url || !/^https?:/i.test(url)) return;
    out.push({ title: nameFromUrl(url), artist: '', artwork: null, url, duration: null, preview: false, page: null });
  });
  return out;
}

async function resolvePlaylistFile(target) {
  const text = await getText(target.url, 'audio/x-mpegurl,audio/mpegurl,text/plain,*/*');
  const lower = target.url.toLowerCase();
  const tracks = /\.pls(\?|#|$)/.test(lower)
    ? parsePLS(text, target.url)
    : /\.m3u8?(\?|#|$)/.test(lower)
      ? parseM3U(text, target.url)
      : parseBareUrls(text, target.url);
  if (!tracks.length) throw new Error('playlist_empty');
  return {
    title: nameFromUrl(target.url) || 'Playlist',
    source: 'playlist',
    artwork: null,
    tracks: tracks.slice(0, MAX_TRACKS).map((t) => ({
      ...t,
      duration: Math.max(2, Number(t.duration) || PREVIEW_SECONDS),
    })),
  };
}

function resolveSingleAudio(target) {
  return {
    title: nameFromUrl(target.url) || 'Audio',
    source: 'audio',
    artwork: null,
    tracks: [
      {
        title: nameFromUrl(target.url) || 'Audio',
        artist: '',
        artwork: null,
        url: target.url,
        duration: PREVIEW_SECONDS,
        preview: false,
        page: null,
      },
    ],
  };
}

// ── the route's whole job ──────────────────────────────────────────────────

const MESSAGES = {
  unsupported_link:
    'That link is not a Spotify or Audiomack playlist, or an m3u/audio file. Paste the playlist page link.',
  spotify_empty: 'That Spotify playlist came back empty.',
  spotify_layout: 'Spotify answered in a shape this app does not read. Try the playlist link again.',
  audiomack_empty: 'That Audiomack page had no songs on it.',
  playlist_empty: 'That playlist file had no playable links in it.',
  no_network: 'Could not reach the playlist service. Check the link and try again.',
};

export async function resolvePlaylist(link) {
  const target = parseTarget(link);
  if (!target) return failure('unsupported_link', MESSAGES.unsupported_link);

  let playlist;
  try {
    if (target.service === 'spotify') playlist = await resolveSpotify(target);
    else if (target.service === 'audiomack') playlist = await resolveAudiomack(target);
    else if (target.service === 'playlist-file') playlist = await resolvePlaylistFile(target);
    else playlist = resolveSingleAudio(target);
  } catch (e) {
    const reason = String((e && e.message) || e);
    const known = MESSAGES[reason];
    console.error('[radio] resolve failed', target.service, reason);
    return failure(known ? reason : 'upstream_failed', known || MESSAGES.no_network, 502);
  }

  // Audiomack (and Spotify links whose preview is missing) get a 30-second
  // preview from the public catalogue. A song that cannot be matched keeps
  // `url: null` and says so, instead of playing something else.
  const tracks = await fillPreviews(playlist.tracks || []);
  const playable = tracks.filter((t) => t.url);

  return {
    status: 200,
    body: {
      ok: true,
      playlist: {
        title: String(playlist.title || 'Radio reel').trim().slice(0, 80),
        source: playlist.source,
        artwork: playlist.artwork || null,
        total: tracks.length,
        playable: playable.length,
        tracks,
      },
    },
  };
}

export default { resolvePlaylist };
