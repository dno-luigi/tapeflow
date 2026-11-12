// The deck is a recorder, so a stray pull-down must never reload it mid-take.
//
// On the web, dragging from the top of the page is the platform's own refresh
// gesture: it throws the page away, and with it an open take and whatever is armed.
// These rules turn that gesture off and stop the document itself from
// rubber-banding. Everything that scrolls inside the app is its own scroll view, so
// the page behind it never needs to move.
import { Platform } from 'react-native';

const CSS = `
html, body, #root { overscroll-behavior: none; overscroll-behavior-y: contain; }
html, body { height: 100%; overflow: hidden; }
#root { display: flex; height: 100%; }
`;

export function lockPage() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('tapeflow-page-lock')) return;
  const style = document.createElement('style');
  style.id = 'tapeflow-page-lock';
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
  // Some engines only read the property off the elements themselves.
  const els = [document.documentElement, document.body];
  els.forEach((el) => {
    if (!el || !el.style) return;
    try {
      el.style.overscrollBehavior = 'none';
      el.style.overscrollBehaviorY = 'contain';
    } catch (e) {
      /* older engine; the style sheet above is the one that counts */
    }
  });
}

export default lockPage;
