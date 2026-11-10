// The app's artwork, bundled with the app.
//
// These were remote URLs on the WRON asset bucket; they are now files in
// assets/artwork, so the web build on Cloudflare serves them from the same
// origin and the app does not depend on anyone else's storage.
//
// Use these exact keys — a key that is not in this object is undefined at
// runtime, and anything built from it renders nothing at all.
export const ART = {
  // scene — Welcome: full-screen background behind title, subtitle and Get started
  welcomeBackground: require('../assets/artwork/welcome-background.webp'),
  // scene — Welcome, full-bleed background
  welcomePhoto: require('../assets/artwork/welcome-photo.webp'),
  // scene — Deck, full-bleed ground for the whole main screen
  deckPlate: require('../assets/artwork/deck-plate.webp'),
  // object — Deck and DJ Mode, both reels (scaled and rotated)
  reelFull: require('../assets/artwork/reel-full.webp'),
  // object — Deck channel strips, four faders
  faderCap: require('../assets/artwork/fader-cap.webp'),
  // object — Deck channel strips, four pan knobs
  panKnob: require('../assets/artwork/pan-knob.webp'),
  // object — Deck (master VU pair above strips), Back Panel
  vuMeter: require('../assets/artwork/vu-meter.webp'),
  // object — Deck transport row, record key in glowing and dark states
  recordKey: require('../assets/artwork/record-key.webp'),
  // scene — Back Panel, full-bleed ground
  rearPlate: require('../assets/artwork/rear-plate.webp'),
};

export const ART_META = {
  welcomeBackground: {
    width: 960,
    height: 2080,
    aspectRatio: 0.46153846153846156,
  },
};
