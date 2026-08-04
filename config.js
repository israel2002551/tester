// ====================================================
//  SENSITIVE CONFIG — DO NOT COMMIT TO GIT
//  This file is .gitignored to protect your secrets.
//  It must be loaded BEFORE app.js in index.html.
// ====================================================

// ── Supabase ──────────────────────────────────────────
const SB_URL  = 'https://obzhlmzswthnorkiqemh.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9iemhsbXpzd3Robm9ya2lxZW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDE2NjgsImV4cCI6MjA4ODY3NzY2OH0.5I4Ln0913h0AH5z4e64QBVx88igcIwEaM0Lz11FqDvU';
const EDGE_URL = SB_URL + '/functions/v1';
const CLAUDE_EDGE_URL = `${EDGE_URL}/smooth-handler`;

// ── Admin ─────────────────────────────────────────────
const ADMIN_EMAIL = 'israelefe093@gmail.com';
const ADMIN_EMAILS = [
  ADMIN_EMAIL,
  'peaceomomofe34@gmail.com'
];

// ── Flutterwave ───────────────────────────────────────
// Replace this with your Flutterwave public key from Dashboard > API Keys.
const FLUTTERWAVE_PUBLIC_KEY = 'FLWPUBK-829243f43712c483b33a5ff1d6afa05f-X';

// ── Platform Fees ─────────────────────────────────────
const COMMISSION_AMOUNT = 250000; // ₦2,500 in kobo
const PLATFORM_FEE_PCT  = 0.03;   // 3% platform fee
