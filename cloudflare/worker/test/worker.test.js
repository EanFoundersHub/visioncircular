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
  AUTH_REQUIRED: 'false',
  ACCESS_CODE: 'codigo-prueba', SESSION_SECRET: 'secreto-de-prueba-con-longitud-suficiente',
  VIDEO_MAP: JSON.stringify({ 'innovacion-abierta': 'private/test.mp4' }),
  VIDEO_OVERRIDES: JSON.stringify({ 'fundraising-2': 'private/fundraising-2.mp4' }),
  LOGIN_LIMITER: limiter, MEDIA_LIMITER: limiter,
  VIDEOS: {
    head: async () => object(false),
    get: async (_key, options) => object(Boolean(options?.range))
  }
};
const authEnv = { ...env, AUTH_REQUIRED: 'true' };

async function login() {
  const page = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), authEnv);
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '127.0.0.1' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE, csrf })
  }), authEnv);
  return { response, cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

test('sirve el reproductor anónimo sin cookies ni formulario', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta'), env);
  assert.equal(response.status, 200);

  const player = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), env);
  const html = await player.text();
  assert.equal(player.status, 200);
  assert.match(html, /<video controls/);
  assert.doesNotMatch(html, /type="password"|type="email"|<form/i);
});

test('mantiene inaccesibles los identificadores no autorizados', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/private%2Ftest.mp4'), env);
  assert.equal(response.status, 404);
});

test('aplica el mapa privado de reemplazos y nuevos videos', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/fundraising-2'), env);
  assert.equal(response.status, 200);
});

test('deshabilita el endpoint de autenticación en modo anónimo', async () => {
  const response = await worker.fetch(new Request('https://worker.test/auth', { method: 'POST' }), env);
  assert.equal(response.status, 404);
});

test('permite revertir al modo autenticado', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta'), authEnv);
  assert.equal(response.status, 401);
});

test('rechaza código incorrecto sin emitir cookie', async () => {
  const page = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), authEnv);
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: 'incorrecto', csrf })
  }), authEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('Set-Cookie'), false);
});

test('acepta el formulario embebido desde GitHub Pages con CSRF válido', async () => {
  const page = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), authEnv);
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://eanfoundershub.github.io' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE, csrf })
  }), authEnv);
  assert.equal(response.status, 303);
});

test('acepta Origin null del iframe solo con CSRF firmado', async () => {
  const page = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), authEnv);
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE, csrf })
  }), authEnv);
  assert.equal(response.status, 303);
});

test('rechaza Origin null cuando falta el CSRF firmado', async () => {
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE })
  }), authEnv);
  assert.equal(response.status, 403);
});

test('rechaza orígenes ajenos aunque presenten un CSRF válido', async () => {
  const page = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta'), authEnv);
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://example.com' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE, csrf })
  }), authEnv);
  assert.equal(response.status, 403);
});

test('emite sesión protegida por ocho horas', async () => {
  const { response } = await login(); const cookie = response.headers.get('Set-Cookie');
  assert.equal(response.status, 303);
  assert.match(cookie, /Max-Age=28800/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/); assert.match(cookie, /Partitioned/);
});

test('sirve reproductor solo con sesión válida', async () => {
  const { cookie } = await login();
  const response = await worker.fetch(new Request('https://worker.test/player?video=innovacion-abierta', { headers: { Cookie: cookie } }), authEnv);
  assert.equal(response.status, 200); assert.match(await response.text(), /<video controls/);
});

test('responde rangos parciales anónimos para adelantar el video', async () => {
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta', { headers: { Range: 'bytes=2-5' } }), env);
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes'); assert.equal(await response.text(), '2345');
});

test('bloquea intentos cuando el limitador responde negativamente', async () => {
  const blocked = { ...authEnv, LOGIN_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await worker.fetch(new Request('https://worker.test/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ video: 'innovacion-abierta', code: authEnv.ACCESS_CODE })
  }), blocked);
  assert.equal(response.status, 429);
});

test('limita solicitudes anónimas por IP sin depender de Origin', async () => {
  let key;
  const blocked = {
    ...env,
    MEDIA_LIMITER: { limit: async value => { key = value.key; return { success: false }; } }
  };
  const response = await worker.fetch(new Request('https://worker.test/video/innovacion-abierta', {
    headers: { 'CF-Connecting-IP': '203.0.113.25', Origin: 'https://example.com' }
  }), blocked);
  assert.equal(response.status, 429);
  assert.equal(key, 'media:anonymous:203.0.113.25');
});
