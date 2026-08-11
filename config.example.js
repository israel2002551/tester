// Copy this file to config.js for local development only.
// In production, set the matching VITE_* variables in your deploy platform.

const SB_URL = 'https://your-project-ref.supabase.co';
const SB_KEY = 'your-supabase-anon-or-publishable-key';
const EDGE_URL = SB_URL + '/functions/v1';
const CLAUDE_EDGE_URL = EDGE_URL + '/smooth-handler';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_EMAILS = [ADMIN_EMAIL, 'second-admin@example.com'];

const FLUTTERWAVE_PUBLIC_KEY = 'FLWPUBK-your-public-key';
const COMMISSION_AMOUNT = 250000;
const PLATFORM_FEE_PCT = 0.03;

window.BUYSELL_CONFIG = {
  SB_URL,
  SB_KEY,
  EDGE_URL,
  CLAUDE_EDGE_URL,
  ADMIN_EMAIL,
  ADMIN_EMAILS,
  FLUTTERWAVE_PUBLIC_KEY,
  COMMISSION_AMOUNT,
  PLATFORM_FEE_PCT,
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
