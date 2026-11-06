const SESSION_SECONDS = 8 * 60 * 60;
const CSRF_SECONDS = 15 * 60;
const COOKIE_NAME = '__Host-vc_session';
const ALLOWED_PARENT = 'https://eanfoundershub.github.io';

const PUBLIC_VIDEO_REFS = new Set([
  'innovacion-abierta', 'oportunidades-innovacion', 'modelo-negocio-1', 'modelo-negocio-2',
  'medicion-impacto-1', 'medicion-impacto-2', 'comunicacion-narrativa-1', 'comunicacion-narrativa-2'
]);

function videoMap(env) {
  try {
    const map = JSON.parse(env.VIDEO_MAP);
    return map && typeof map === 'object' ? map : {};
  } catch { return {}; }
}

function videoKey(env, ref) {
  if (!PUBLIC_VIDEO_REFS.has(ref)) return null;
  const key = videoMap(env)[ref];
  return typeof key === 'string' && key.length > 0 && !key.includes('..') && !key.startsWith('/') ? key : null;
}

const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
const decode64url = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function sameSecret(a, b) {
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const x = new Uint8Array(left), y = new Uint8Array(right); let difference = 0;
  for (let index = 0; index < x.length; index++) difference |= x[index] ^ y[index];
  return difference === 0;
}

async function issueSession(secret) {
  const payload = base64url(encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, sid: crypto.randomUUID() })));
  return `${payload}.${base64url(await hmac(payload, secret))}`;
}

async function issueCsrf(video, secret) {
  const payload = base64url(encoder.encode(JSON.stringify({ video, exp: Math.floor(Date.now() / 1000) + CSRF_SECONDS, nonce: crypto.randomUUID() })));
  return `${payload}.${base64url(await hmac(payload, secret))}`;
}

async function verifyCsrf(token, video, secret) {
  if (!token) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = await hmac(payload, secret), actual = decode64url(signature);
  if (actual.length !== expected.length) return false;
  let difference = 0; for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  if (difference !== 0) return false;
  try {
    const value = JSON.parse(new TextDecoder().decode(decode64url(payload)));
    return value.video === video && value.exp > Date.now() / 1000 && typeof value.nonce === 'string';
  } catch { return false; }
}

async function readSession(request, secret) {
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = await hmac(payload, secret), actual = decode64url(signature);
  if (actual.length !== expected.length) return null;
  let difference = 0; for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  if (difference !== 0) return null;
  try { const value = JSON.parse(new TextDecoder().decode(decode64url(payload))); return value.exp > Date.now() / 1000 && typeof value.sid === 'string' ? value : null; } catch { return null; }
}

const securityHeaders = (contentType = 'text/html; charset=utf-8') => ({
  'Content-Type': contentType,
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; form-action 'self'; frame-ancestors ${ALLOWED_PARENT}`
});

function page(content, status = 200, bodyClass = '') {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{font-family:Poppins,Arial,sans-serif;color:#171716}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#055382,#47bec2);padding:20px}.box{width:min(440px,100%);background:#fff;border-radius:20px;padding:28px;box-shadow:0 18px 44px #002d4866}h1{font-size:22px;margin:0 0 8px;color:#055382}p{font-size:13px;line-height:1.6;color:#5d6972}label{display:block;font-size:12px;font-weight:800;margin:18px 0 7px}input,button{width:100%;min-height:48px;border-radius:11px;font:inherit}input{border:1px solid #ccd9de;padding:12px}button{margin-top:12px;border:0;background:#055382;color:#fff;font-weight:800;cursor:pointer}.error{color:#a33a32;font-weight:700}video{display:block;width:100%;height:100%;background:#111}body.player{display:block;padding:0;background:#111;min-height:0;height:100vh}</style></head><body class="${bodyClass}">${content}</body></html>`, { status, headers: securityHeaders() });
}

async function loginPage(video, env, error = '') {
  const csrf = await issueCsrf(video, env.SESSION_SECRET);
  return page(`<main class="box"><h1>Acceso a la grabación</h1><p>Ingresa una vez el código compartido por el equipo. La sesión permanecerá activa durante ocho horas.</p>${error ? `<p class="error">${error}</p>` : ''}<form method="post" action="/auth"><input type="hidden" name="video" value="${video}"><input type="hidden" name="csrf" value="${csrf}"><label for="code">Código de acceso</label><input id="code" name="code" type="password" required autocomplete="current-password" maxlength="128"><button type="submit">Ingresar y reproducir</button></form></main>`);
}

async function authenticate(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = new Set([new URL(request.url).origin, ALLOWED_PARENT]);
  if (origin && origin !== 'null' && !allowedOrigins.has(origin)) return new Response('Solicitud no permitida: origen no autorizado', { status: 403, headers: securityHeaders('text/plain; charset=utf-8') });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await env.LOGIN_LIMITER.limit({ key: `login:${ip}` })).success) return page('<main class="box"><h1>Demasiados intentos</h1><p>Espera un minuto antes de volver a intentarlo.</p></main>', 429);
  const form = await request.formData(), video = String(form.get('video') || ''), code = String(form.get('code') || ''), csrf = String(form.get('csrf') || '');
  if (!videoKey(env, video)) return page('<main class="box"><h1>Grabación no válida</h1></main>', 404);
  if (!(await verifyCsrf(csrf, video, env.SESSION_SECRET))) return new Response('Solicitud no permitida: formulario inválido o vencido', { status: 403, headers: securityHeaders('text/plain; charset=utf-8') });
  if (!code || !(await sameSecret(code, env.ACCESS_CODE))) return loginPage(video, env, 'El código no es correcto.');
  const token = await issueSession(env.SESSION_SECRET);
  return new Response(null, { status: 303, headers: {
    Location: `/player?video=${encodeURIComponent(video)}`,
    'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`,
    ...securityHeaders()
  }});
}

async function player(request, env, video) {
  if (!videoKey(env, video)) return page('<main class="box"><h1>Grabación no encontrada</h1></main>', 404);
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return loginPage(video, env);
  return page(`<main><video controls autoplay playsinline preload="metadata" src="/video/${encodeURIComponent(video)}"></video></main>`, 200, 'player');
}

async function streamVideo(request, env, video) {
  const key = videoKey(env, video); if (!key) return new Response('No encontrado', { status: 404, headers: securityHeaders('text/plain; charset=utf-8') });
  const session = await readSession(request, env.SESSION_SECRET); if (!session) return new Response('Sesión requerida', { status: 401, headers: securityHeaders('text/plain; charset=utf-8') });
  if (!(await env.MEDIA_LIMITER.limit({ key: `media:${session.sid}` })).success) return new Response('Límite temporal alcanzado', { status: 429, headers: securityHeaders('text/plain; charset=utf-8') });
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader && !/^bytes=\d*-\d*$/.test(rangeHeader)) return new Response('Rango no válido', { status: 416, headers: { ...securityHeaders('text/plain; charset=utf-8'), 'Accept-Ranges': 'bytes' } });
  const object = request.method === 'HEAD' ? await env.VIDEOS.head(key) : await env.VIDEOS.get(key, rangeHeader ? { range: request.headers } : {});
  if (!object) return new Response('No encontrado', { status: 404, headers: securityHeaders('text/plain; charset=utf-8') });
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Type': 'video/mp4', ETag: object.httpEtag });
  object.writeHttpMetadata(headers);
  if (rangeHeader && object.range) {
    headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    headers.set('Content-Length', String(object.range.length));
  } else {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: rangeHeader ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    try {
      if (!env.ACCESS_CODE || !env.SESSION_SECRET || !env.VIDEO_MAP) return new Response('Servicio no configurado', { status: 503 });
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/auth') return authenticate(request, env);
      if (request.method === 'GET' && url.pathname === '/player') return player(request, env, url.searchParams.get('video') || '');
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/video/')) return streamVideo(request, env, decodeURIComponent(url.pathname.slice(7)));
      if (request.method === 'GET' && url.pathname === '/health') return new Response('ok', { headers: securityHeaders('text/plain; charset=utf-8') });
      return new Response('No encontrado', { status: 404, headers: securityHeaders('text/plain; charset=utf-8') });
    } catch (error) { console.error(error); return new Response('Error interno', { status: 500, headers: securityHeaders('text/plain; charset=utf-8') }); }
  }
};
