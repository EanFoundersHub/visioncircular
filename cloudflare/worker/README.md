# Gateway de videos con bucket privado

Worker de Cloudflare que reproduce de forma anónima las nueve grabaciones
autorizadas del bucket R2 `vision-circular-videos`. El bucket permanece privado:
no necesita `r2.dev`, dominio público ni credenciales en el navegador.

El acceso al Worker no es exclusivo del equipo. Cualquier persona que conozca o
descubra un identificador autorizado puede reproducir ese video.

## Seguridad

- `VIDEOS`: binding privado al bucket R2.
- Lista explícita de nueve identificadores públicos aceptados por el Worker.
- `VIDEO_MAP`: mapa privado entre referencias públicas y claves de objetos R2.
- `VIDEO_OVERRIDES`: altas y correcciones privadas que prevalecen sobre el mapa
  original, sin publicar nombres internos en GitHub.
- Límite de 600 solicitudes de medios por IP y minuto, suficientemente amplio
  para redes compartidas y útil para contener abuso básico.
- HTTP Range para reproducción y búsqueda dentro del video.
- CSP `frame-ancestors` restringida a `https://eanfoundershub.github.io`.
- No se usa `Origin`, `Referer` ni CORS como autenticación.

Los secretos y las rutas internas no se incluyen en Git ni en `catalogo.json`.

## Reversión a autenticación

El código anterior se conserva detrás de `AUTH_REQUIRED`. Para volver al código
compartido y las sesiones de ocho horas, cambiar `AUTH_REQUIRED` a `"true"` en
`wrangler.jsonc` y desplegar. Los secretos `ACCESS_CODE` y `SESSION_SECRET`
deben seguir configurados en Cloudflare. Las cookies vuelven a ser `HttpOnly`,
`Secure`, `SameSite=None` y `Partitioned`.

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

Configurar o rotar secretos sin escribirlos en archivos del repositorio. Los
dos primeros sólo se usan cuando `AUTH_REQUIRED=true`; se conservan para la
reversión:

```powershell
npx wrangler secret put ACCESS_CODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put VIDEO_MAP
npx wrangler secret put VIDEO_OVERRIDES
```

## Prueba manual

1. Abrir una ventana de incógnito, sin cookies previas.
2. Abrir la Biblioteca desde el ADMIN.
3. En **Grabación — Innovación Abierta**, pulsar **Ver grabación**.
4. Confirmar que el video inicia sin formulario, permite pausa, búsqueda y
   pantalla completa.
5. Repetir para los otros siete identificadores autorizados.

El endpoint `/health` no expone contenido. Las referencias fuera de la lista
explícita responden `404`; ninguna ruta interna de R2 se acepta como URL.

## Plan gratuito y límites

Antes del despliegue se verificaron las condiciones publicadas por Cloudflare:

- Workers Free: 100.000 solicitudes diarias y 10 ms de CPU por solicitud.
- R2 Free: 10 GB-mes de almacenamiento, 1 millón de operaciones Class A y
  10 millones de operaciones Class B al mes; la salida desde R2 no tiene cargo.
- El rate limiting de Workers es aproximado por ubicación de Cloudflare. Una IP
  compartida consume un único cupo y el límite no convierte el endpoint en
  acceso restringido.

Referencias oficiales:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/workers/configuration/secrets/
