// How much tape one reel holds.
//
// The reel is 40 minutes long, and two quite different places need that number:
// the deck, which stops the tape at the end of it, and the radio import, which
// lays a playlist out on the same reel and stops when the songs no longer fit.
// Two copies of it drifted apart the moment one of them changed, so both read it
// from here.
export const TAPE_SECONDS = 2400;

export default { TAPE_SECONDS };
