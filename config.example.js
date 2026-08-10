// Copy this file to config.js for local development only.
// In production, set the matching VITE_* variables in your deploy platform.

const SB_URL = 'https://your-project-ref.supabase.co';
const SB_KEY = 'your-supabase-anon-or-publishable-key';
const EDGE_URL = SB_URL + '/functions/v1';
const CLAUDE_EDGE_URL = EDGE_URL + '/smooth-handler';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_EMAILS = [ADMIN_EMAIL];

const FLUTTERWAVE_PUBLIC_KEY = 'FLWPUBK-your-public-key';
const COMMISSION_AMOUNT = 250000;
const PLATFORM_FEE_PCT = 0.03;
