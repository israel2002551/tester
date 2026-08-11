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

function parseEmails(value, fallback) {
  return String(value || fallback || '')
    .split(',')
    .map(email => email.trim())
    .filter(Boolean);
}

function configWindowBridge(config) {
  return `
window.BUYSELL_CONFIG = {
  SB_URL,
  SB_KEY,
  EDGE_URL,
  CLAUDE_EDGE_URL,
  ADMIN_EMAIL,
  ADMIN_EMAILS,
  FLUTTERWAVE_PUBLIC_KEY,
  COMMISSION_AMOUNT,
  PLATFORM_FEE_PCT
};
window.SB_URL = SB_URL;
window.SB_KEY = SB_KEY;
window.EDGE_URL = EDGE_URL;
window.CLAUDE_EDGE_URL = CLAUDE_EDGE_URL;
window.ADMIN_EMAIL = ADMIN_EMAIL;
window.ADMIN_EMAILS = ADMIN_EMAILS;
window.FLUTTERWAVE_PUBLIC_KEY = FLUTTERWAVE_PUBLIC_KEY;
window.COMMISSION_AMOUNT = COMMISSION_AMOUNT;
window.PLATFORM_FEE_PCT = PLATFORM_FEE_PCT;
`;
}

if (hasEnvConfig) {
  const config = {
    SB_URL: process.env.VITE_SUPABASE_URL,
    SB_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    FLUTTERWAVE_PUBLIC_KEY: process.env.VITE_FLUTTERWAVE_PUBLIC_KEY || '',
    ADMIN_EMAIL: process.env.VITE_ADMIN_EMAIL || '',
    ADMIN_EMAILS: parseEmails(process.env.VITE_ADMIN_EMAILS, process.env.VITE_ADMIN_EMAIL),
    COMMISSION_AMOUNT: Number(process.env.VITE_COMMISSION_AMOUNT || 250000),
    PLATFORM_FEE_PCT: Number(process.env.VITE_PLATFORM_FEE_PCT || 0.03),
  };
  fs.writeFileSync(distConfig, `// Generated at build time from deploy environment variables.
const SB_URL = ${JSON.stringify(config.SB_URL)};
const SB_KEY = ${JSON.stringify(config.SB_KEY)};
const EDGE_URL = SB_URL + '/functions/v1';
const CLAUDE_EDGE_URL = EDGE_URL + '/smooth-handler';
const ADMIN_EMAIL = ${JSON.stringify(config.ADMIN_EMAIL)};
const ADMIN_EMAILS = ${JSON.stringify(config.ADMIN_EMAILS)};
const FLUTTERWAVE_PUBLIC_KEY = ${JSON.stringify(config.FLUTTERWAVE_PUBLIC_KEY)};
const COMMISSION_AMOUNT = ${JSON.stringify(config.COMMISSION_AMOUNT)};
const PLATFORM_FEE_PCT = ${JSON.stringify(config.PLATFORM_FEE_PCT)};
${configWindowBridge(config)}
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
${configWindowBridge({})}
`, 'utf8');
}
