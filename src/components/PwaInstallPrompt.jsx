import { useEffect, useState } from 'react';

const DISMISS_KEY = 'bs_pwa_install_dismissed_at';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
let serviceWorkerRegistrationPromise = null;

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIosDevice() {
  const userAgent = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes('Mac') && window.navigator.maxTouchPoints > 1);
}

function isInstallDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (!dismissedAt) return false;
    if (Date.now() - dismissedAt < DISMISS_DURATION_MS) return true;
    window.localStorage.removeItem(DISMISS_KEY);
  } catch (_) {
    // Storage is optional for this non-essential convenience prompt.
  }
  return false;
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch (_) {
    // The install prompt remains usable when storage is unavailable.
  }
}

function clearDismissal() {
  try {
    window.localStorage.removeItem(DISMISS_KEY);
  } catch (_) {
    // Nothing else is needed if storage is unavailable.
  }
}

export function registerBuySellServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).then(registration => {
      registration.update().catch(() => {});
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return registration;
    }).catch(error => {
      serviceWorkerRegistrationPromise = null;
      console.info('BUYSELL app install is unavailable in this browser:', error?.message || error);
      return null;
    });
  }
  return serviceWorkerRegistrationPromise;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const iosDevice = isIosDevice();
    setIos(iosDevice);
    if (!isStandalone()) registerBuySellServiceWorker();

    const showIfAvailable = event => {
      event.preventDefault();
      setDeferredPrompt(event);
      if (!isInstallDismissed() && !isStandalone()) setVisible(true);
    };
    const onInstalled = () => {
      clearDismissal();
      setInstalled(true);
      setDeferredPrompt(null);
      setVisible(false);
      setShowManualSteps(false);
    };
    const iosTimer = iosDevice && !isStandalone() && !isInstallDismissed()
      ? window.setTimeout(() => setVisible(true), 1800)
      : null;

    window.addEventListener('beforeinstallprompt', showIfAvailable);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', showIfAvailable);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  useEffect(() => {
    window.bsShowPwaInstall = () => {
      if (isStandalone()) return false;
      setVisible(true);
      return true;
    };
    return () => { delete window.bsShowPwaInstall; };
  }, []);

  const dismiss = () => {
    rememberDismissal();
    setVisible(false);
    setShowManualSteps(false);
  };

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);
      if (choice?.outcome === 'accepted') {
        clearDismissal();
        setVisible(false);
      } else {
        rememberDismissal();
        setVisible(false);
      }
      return;
    }
    setShowManualSteps(true);
  };

  if (!visible || installed) return null;

  const title = showManualSteps
    ? ios ? 'Add BUYSELL from Safari' : 'Install from your browser menu'
    : 'Install the BUYSELL app';
  const subtitle = showManualSteps
    ? ios
      ? 'Tap Share, then choose Add to Home Screen. BUYSELL will open like an app.'
      : 'Open your browser menu and choose Install app or Add to Home screen.'
    : 'Keep shopping, selling, and tracking orders from your home screen.';

  return (
    <aside className="bs-pwa-install" aria-label="Install BUYSELL app" role="dialog">
      <div className="bs-pwa-install__brand" aria-hidden="true">
        <img src="/brand/png/buysell_icon_green.png" alt="" />
      </div>
      <div className="bs-pwa-install__copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="bs-pwa-install__actions">
        {!showManualSteps ? (
          <button type="button" className="bs-pwa-install__primary" onClick={install}>
            <i className="fa-solid fa-download" aria-hidden="true" /> Install
          </button>
        ) : null}
        <button type="button" className="bs-pwa-install__dismiss" onClick={dismiss} aria-label="Dismiss app install message">
          {showManualSteps ? 'Got it' : <i className="fa-solid fa-xmark" aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}
