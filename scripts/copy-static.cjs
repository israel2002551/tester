const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');
const files = [
  'app.js',
  'sw.js',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  '_redirects',
  '404.html',
];

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(dist, file));
}

const localConfig = path.join(root, 'config.js');
const distConfig = path.join(dist, 'config.js');
const hasEnvConfig = process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY;

if (hasEnvConfig) {
  const config = {
    SB_URL: process.env.VITE_SUPABASE_URL,
    SB_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    FLUTTERWAVE_PUBLIC_KEY: process.env.VITE_FLUTTERWAVE_PUBLIC_KEY || '',
    ADMIN_EMAIL: process.env.VITE_ADMIN_EMAIL || '',
    COMMISSION_AMOUNT: Number(process.env.VITE_COMMISSION_AMOUNT || 250000),
    PLATFORM_FEE_PCT: Number(process.env.VITE_PLATFORM_FEE_PCT || 0.03),
  };
  fs.writeFileSync(distConfig, `// Generated at build time from deploy environment variables.
const SB_URL = ${JSON.stringify(config.SB_URL)};
const SB_KEY = ${JSON.stringify(config.SB_KEY)};
const EDGE_URL = SB_URL + '/functions/v1';
const CLAUDE_EDGE_URL = EDGE_URL + '/smooth-handler';
const ADMIN_EMAIL = ${JSON.stringify(config.ADMIN_EMAIL)};
const ADMIN_EMAILS = ADMIN_EMAIL ? [ADMIN_EMAIL] : [];
const FLUTTERWAVE_PUBLIC_KEY = ${JSON.stringify(config.FLUTTERWAVE_PUBLIC_KEY)};
const COMMISSION_AMOUNT = ${JSON.stringify(config.COMMISSION_AMOUNT)};
const PLATFORM_FEE_PCT = ${JSON.stringify(config.PLATFORM_FEE_PCT)};
`, 'utf8');
} else if (fs.existsSync(localConfig)) {
  fs.copyFileSync(localConfig, distConfig);
} else {
  fs.writeFileSync(distConfig, `// Missing deployment config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
const SB_URL = '';
const SB_KEY = '';
const EDGE_URL = '';
const CLAUDE_EDGE_URL = '';
const ADMIN_EMAIL = '';
const ADMIN_EMAILS = [];
const FLUTTERWAVE_PUBLIC_KEY = '';
const COMMISSION_AMOUNT = 250000;
const PLATFORM_FEE_PCT = 0.03;
`, 'utf8');
}
