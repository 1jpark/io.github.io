/**
 * worker.js — YOURLS multi-proxy for Cloudflare Workers
 *
 * Secrets are set in Cloudflare Dashboard → Workers → your-worker → Settings → Variables
 * as ENCRYPTED secrets (not plain text). They never appear in code or git history.
 *
 * Required secrets to add in the dashboard:
 *   YOURLS_TOKEN_J   → signature token for j.meson.kr
 *   YOURLS_TOKEN_G   → signature token for g.onni.me
 *   YOURLS_TOKEN_L   → signature token for l.meson.in
 *
 * Allowed origin: set ALLOWED_ORIGIN secret to your GitHub Pages URL
 *   e.g.  https://yourusername.github.io  or  https://yourdomain.com
 */

const SERVICES = {
  j: 'https://j.meson.kr/yourls-api.php',
  g: 'https://g.onni.me/yourls-api.php',
  l: 'https://l.meson.in/yourls-api.php',
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, corsHeaders);
    }

    // Resolve service
    const url  = new URL(request.url);
    const svc  = url.searchParams.get('svc') || '';
    const endpoint = SERVICES[svc];
    if (!endpoint) {
      return json({ error: `Unknown service '${svc}'. Use svc=j, g, or l.` }, 400, corsHeaders);
    }

    // Resolve token from encrypted secret
    const tokenMap = { j: env.YOURLS_TOKEN_J, g: env.YOURLS_TOKEN_G, l: env.YOURLS_TOKEN_L };
    const token = tokenMap[svc];
    if (!token) {
      return json({ error: `Secret not configured for service '${svc}'.` }, 500, corsHeaders);
    }

    // Parse incoming body
    const body = await request.text();
    const params = new URLSearchParams(body);
    const longUrl = params.get('url') || '';
    const keyword = params.get('keyword') || '';

    if (!longUrl || !isValidUrl(longUrl)) {
      return json({ error: 'A valid URL is required.' }, 400, corsHeaders);
    }

    // Forward to YOURLS
    const yourlsParams = new URLSearchParams({
      signature: token,
      action:    'shorturl',
      url:       longUrl,
      format:    'json',
    });
    if (keyword) yourlsParams.set('keyword', keyword);

    let yourlsResp;
    try {
      yourlsResp = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    yourlsParams.toString(),
      });
    } catch (e) {
      return json({ error: 'Could not reach the YOURLS service.' }, 502, corsHeaders);
    }

    const data = await yourlsResp.text();
    return new Response(data, {
      status:  200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function isValidUrl(s) {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); }
  catch { return false; }
}
