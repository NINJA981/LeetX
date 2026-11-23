// LeetX GitHub sign-in broker. Holds the GitHub App client secret so the extension never does.
//   GET  /login?redirect=<extension redirect url>  -> sends the user to GitHub
//   GET  /callback?code&state                       -> swaps the code, returns tokens to the extension in the URL fragment
//   POST /refresh {refresh_token}                   -> returns a fresh token pair
// Secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, STATE_SECRET

const ALLOWED_REDIRECT = /^https:\/\/([a-p]{32}\.chromiumapp\.org|[a-z0-9-]+\.extensions\.allizom\.org)\/[\w\-./]*$/;
const enc = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return key;
}
async function sign(secret, payload) {
  const body = b64(enc.encode(JSON.stringify(payload)));
  const sig = b64(await crypto.subtle.sign('HMAC', await hmac(secret), enc.encode(body)));
  return `${body}.${sig}`;
}
async function verify(secret, token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmac(secret), unb64(sig), enc.encode(body));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(unb64(body)));
  return payload.exp > Date.now() ? payload : null;
}

async function githubToken(env, params) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  return res.json();
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/login') {
      const redirect = url.searchParams.get('redirect') || '';
      if (!ALLOWED_REDIRECT.test(redirect)) return new Response('Invalid redirect', { status: 400 });
      const state = await sign(env.STATE_SECRET, { redirect, n: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 });
      const auth = new URL('https://github.com/login/oauth/authorize');
      auth.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      auth.searchParams.set('redirect_uri', `${url.origin}/callback`);
      auth.searchParams.set('state', state);
      auth.searchParams.set('scope', 'repo');
      return Response.redirect(auth.toString(), 302);
    }

    if (url.pathname === '/callback') {
      const payload = await verify(env.STATE_SECRET, url.searchParams.get('state'));
      if (!payload || !ALLOWED_REDIRECT.test(payload.redirect)) return new Response('Invalid or expired state', { status: 400 });
      const code = url.searchParams.get('code');
      const back = new URL(payload.redirect);
      if (!code) {
        back.hash = new URLSearchParams({ error: url.searchParams.get('error') || 'access_denied' }).toString();
        return Response.redirect(back.toString(), 302);
      }
      const data = await githubToken(env, { code, redirect_uri: `${url.origin}/callback` });
      back.hash = new URLSearchParams(
        data.access_token
          ? { access_token: data.access_token, refresh_token: data.refresh_token || '', expires_in: String(data.expires_in || 0) }
          : { error: data.error || 'exchange_failed' },
      ).toString();
      return Response.redirect(back.toString(), 302);
    }

    if (url.pathname === '/refresh' && request.method === 'POST') {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return json({ error: 'missing_refresh_token' }, 400);
      const data = await githubToken(env, { grant_type: 'refresh_token', refresh_token });
      return data.access_token
        ? json({ access_token: data.access_token, refresh_token: data.refresh_token || '', expires_in: data.expires_in || 0 })
        : json({ error: data.error || 'refresh_failed' }, 401);
    }

    return new Response('LeetX auth broker', { status: 200 });
  },
};
