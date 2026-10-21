// In index.ts, add after parsing the request body:
const clientIp = req.headers.get("x-forwarded-for") || "unknown";
const rateLimitKey = `ratelimit:${clientIp}`;

// Simple in-memory rate limiting (resets on function cold start)
// For production, use Supabase KV or Redis
const RATE_MAP = new Map<string, { count: number; reset: number }>();
const now = Date.now();
const entry = RATE_MAP.get(rateLimitKey);

if (entry && entry.reset > now) {
  if (entry.count >= 20) { // 20 messages per minute per IP
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again in a minute." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  entry.count++;
} else {
  RATE_MAP.set(rateLimitKey, { count: 1, reset: now + 60_000 });
}