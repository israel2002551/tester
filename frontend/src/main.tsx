import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './lib/legacyCatalogBridge';
import './styles.css';
import './responsive.css';

const root = document.getElementById('root');
if (!root) throw new Error('BUYSELL application root was not found.');

createRoot(root).render(<StrictMode><App /></StrictMode>);
