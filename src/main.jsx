import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import './redesign.css';
import App from './App.jsx';
import PwaInstallPrompt from './components/PwaInstallPrompt.jsx';
import { isProtectedMarketplaceRoute } from './lib/auth.js';

// `index.html` starts hidden so a direct seller/dashboard/order route cannot
// paint private UI while the persisted Supabase session is being restored.
if (isProtectedMarketplaceRoute()) document.body.classList.add('auth-pending');
else document.body.classList.remove('auth-pending');

const siteIcon = document.querySelector('link[rel~="icon"]') || document.createElement('link');
siteIcon.setAttribute('rel', 'icon');
siteIcon.setAttribute('type', 'image/svg+xml');
siteIcon.setAttribute('href', '/brand/svg/buysell_icon_transparent.svg');
if (!siteIcon.parentNode) document.head.appendChild(siteIcon);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaInstallPrompt />
  </React.StrictMode>,
);
