import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import App from './App.jsx';

const siteIcon = document.querySelector('link[rel~="icon"]') || document.createElement('link');
siteIcon.setAttribute('rel', 'icon');
siteIcon.setAttribute('type', 'image/svg+xml');
siteIcon.setAttribute('href', '/brand/svg/buysell_icon_transparent.svg');
if (!siteIcon.parentNode) document.head.appendChild(siteIcon);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
