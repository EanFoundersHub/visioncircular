# Gateway privado de videos

Worker de Cloudflare que reproduce las ocho grabaciones privadas del bucket R2
`vision-circular-videos`. El bucket no necesita `r2.dev`, dominio público ni
credenciales en el navegador.

## Seguridad

- `VIDEOS`: binding privado al bucket R2.
- `ACCESS_CODE`: código compartido, almacenado como secreto del Worker.
- `SESSION_SECRET`: firma HMAC-SHA256 de sesiones con vencimiento de ocho horas.
- `VIDEO_MAP`: mapa privado entre referencias públicas y claves de objetos R2.
- Cookie `HttpOnly`, `Secure`, `SameSite=None` y `Partitioned` para permitir el
  reproductor dentro del ADMIN sin guardar tokens en `localStorage`.
- Límite de cinco intentos de acceso por IP y minuto.
- Límite de 300 solicitudes de medios por sesión y minuto.
- Validación de la cookie firmada en cada solicitud del reproductor y del video.
- HTTP Range para reproducción y búsqueda dentro del video.
- CSP `frame-ancestors` restringida a `https://eanfoundershub.github.io`.

Los secretos y las rutas internas no se incluyen en Git ni en `catalogo.json`.

## Despliegue

Requiere un Account API Token limitado a la cuenta y a Workers. Como el Worker
se crea por primera vez, el token necesita Workers Admin; para despliegues
posteriores basta Workers Editor. Un binding R2 no requiere permisos directos
adicionales sobre el bucket.

```powershell
$env:CLOUDFLARE_API_TOKEN = '<token>'
$env:CLOUDFLARE_ACCOUNT_ID = '<account-id>'
npm install
npm test
npm run check
npx wrangler deploy
```

Configurar o rotar secretos sin escribirlos en archivos del repositorio:

```powershell
npx wrangler secret put ACCESS_CODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put VIDEO_MAP
```

## Prueba manual

1. Abrir la Biblioteca desde el ADMIN.
2. En **Grabación — Innovación Abierta**, pulsar **Abrir reproductor seguro**.
3. Introducir el código compartido.
4. Confirmar reproducción, pausa y búsqueda dentro del video.
5. Cerrar el navegador o esperar ocho horas para que expire la sesión.

El endpoint `/health` no expone contenido. Una solicitud directa a `/video/...`
sin una sesión válida responde `401`.

## Plan gratuito y límites

Antes del despliegue se verificaron las condiciones publicadas por Cloudflare:

- Workers Free: 100.000 solicitudes diarias y 10 ms de CPU por solicitud.
- R2 Free: 10 GB-mes de almacenamiento, 1 millón de operaciones Class A y
  10 millones de operaciones Class B al mes; la salida desde R2 no tiene cargo.
- El rate limiting de Workers es aproximado por ubicación de Cloudflare y no
  reemplaza la autenticación del servidor.

Referencias oficiales:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/workers/configuration/secrets/
