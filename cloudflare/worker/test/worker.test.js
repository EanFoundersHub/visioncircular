import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const limiter = { limit: async () => ({ success: true }) };
const bytes = new TextEncoder().encode('0123456789');
function object(range) {
  const offset = range ? 2 : 0, length = range ? 4 : bytes.length;
  return {
    size: bytes.length,
    httpEtag: '"test"',
    body: bytes.slice(offset, offset + length),
    range: range ? { offset, length } : undefined,
    writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); }
  };
}
const env = {
  ACCESS_CODE: 'codigo-prueba', SESSION_SECRET: 'secreto-de-prueba-con-longitud-suficiente',
  VIDEO_MAP: JSON.stringify({ 'innovacion-abierta': 'private/test.mp4' }),
  LOGIN_LIMITER: limiter, MEDIA_LIMITER: limiter,
  VIDEOS: {
    head: async () => object(false),
    get: async (_key, options) => object(Boolean(options?.range))
  }
};

async function login() {
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '127.0.0.1' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: env.ACCESS_CODE })
  }), env);
  return { response, cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

test('rechaza video sin sesión', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta'), env);
  assert.equal(response.status, 401);
});

test('rechaza código incorrecto sin emitir cookie', async () => {
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: 'incorrecto' })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('Set-Cookie'), false);
});

test('emite sesión protegida por ocho horas', async () => {
  const { response } = await login(); const cookie = response.headers.get('Set-Cookie');
  assert.equal(response.status, 303);
  assert.match(cookie, /Max-Age=28800/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/); assert.match(cookie, /Partitioned/);
});

test('sirve reproductor solo con sesión válida', async () => {
  const { cookie } = await login();
  const response = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta', { headers: { Cookie: cookie } }), env);
  assert.equal(response.status, 200); assert.match(await response.text(), /<video controls/);
});

test('responde rangos parciales para búsqueda del video', async () => {
  const { cookie } = await login();
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta', { headers: { Cookie: cookie, Range: 'bytes=2-5' } }), env);
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes'); assert.equal(await response.text(), '2345');
});

test('bloquea intentos cuando el limitador responde negativamente', async () => {
  const blocked = { ...env, LOGIN_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: env.ACCESS_CODE })
  }), blocked);
  assert.equal(response.status, 429);
});
