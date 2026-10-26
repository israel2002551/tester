// Smooth page-to-page flow using the View Transitions API. Browsers without it
// (or users who prefer reduced motion) get the same instant update as before.

const PRODUCT_MEDIA_NAME = 'bs-product-media';

function motionAllowed() {
  return typeof document !== 'undefined'
    && typeof document.startViewTransition === 'function'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Runs a synchronous DOM update inside a view transition when possible. */
export function runViewTransition(update) {
  if (!motionAllowed()) {
    update();
    return;
  }
  try {
    const transition = document.startViewTransition(update);
    // A quick second navigation skips the first transition; that rejection is
    // expected and the DOM update has still been applied.
    transition.ready.catch(() => {});
    transition.finished.finally(clearProductMediaNames);
  } catch (_) {
    update();
  }
}

function clearProductMediaNames() {
  document.querySelectorAll('[data-bs-vt-media]').forEach((element) => {
    element.style.viewTransitionName = '';
    delete element.dataset.bsVtMedia;
  });
}

/**
 * Names the photo of the product card a shopper taps, so the transition can
 * grow it into the product page's main image (named in refresh.css).
 */
export function installProductMediaHandoff() {
  if (typeof document === 'undefined' || installProductMediaHandoff.installed) return;
  installProductMediaHandoff.installed = true;

  document.addEventListener('click', (event) => {
    const card = event.target.closest?.('.prod-card, .cat-product-card, .recent-item');
    if (!card || event.target.closest('button:not(.recent-item)')) return;
    // View transition names must be unique; on a product page the gallery
    // image already carries the name, so related-product taps just crossfade.
    if (document.querySelector('.product-gallery-slide:first-child img')) return;
    const media = card.querySelector('img');
    if (!media) return;
    clearProductMediaNames();
    media.style.viewTransitionName = PRODUCT_MEDIA_NAME;
    media.dataset.bsVtMedia = 'true';
  }, true);

  // Coming back through the browser cache must not leave a stale name behind.
  window.addEventListener('pageshow', clearProductMediaNames);
}

/** Gives the legacy marketplace tabs (Shop, Orders, Support) the same flow. */
export function enhanceLegacyTabs() {
  const original = window.switchBuyerTab;
  if (typeof original !== 'function' || original.bsViewTransition) return;
  const wrapped = function switchBuyerTabWithTransition(...args) {
    let result;
    runViewTransition(() => {
      result = original.apply(this, args);
    });
    return result;
  };
  wrapped.bsViewTransition = true;
  window.switchBuyerTab = wrapped;
}
