import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const htmlEntries = {
  main: 'index.html',
  product: 'product.html',
  products: 'products.html',
  upcoming: 'upcoming.html',
  privacy: 'privacy.html',
  terms: 'terms.html',
  marketing: 'marketing.html',
  'category-trending': 'category-trending.html',
  'category-phones': 'category-phones.html',
  'category-fashion': 'category-fashion.html',
  'category-home': 'category-home.html',
  'category-electronics': 'category-electronics.html',
  'category-beauty': 'category-beauty.html',
  'category-sports': 'category-sports.html',
  'category-dropship': 'category-dropship.html',
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: htmlEntries,
    },
  },
});
