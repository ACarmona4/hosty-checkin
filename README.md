# PlatHost — Pre-check-in

Web de pre-check-in para huéspedes: ingresan con **número de reserva + apellido**, confirman los datos que ya vienen de la reserva, completan el resto, fotografían su documento y firman las normas de estadía.

- **Frontend**: React 19 + Vite (`frontend/`)
- **Backend**: Python / FastAPI (`backend/`)
- **Base de datos**: PostgreSQL 17 en Docker (`docker-compose.yml`, puerto **5433**)
- **Lectura de pasaportes**: tesseract.js (OCR en el navegador) + validación ICAO 9303 en el servidor

## Arranque

```bash
docker compose up -d --wait                     # Postgres (crea también plathost_test)

cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

cd frontend
npm install && npm run dev                      # http://localhost:5173
```

Reservas de ejemplo (se crean al iniciar la API):

| Reserva  | Apellido | Huéspedes |
|----------|----------|-----------|
| `CS1102` | Perez    | 5 (titular + 4 acompañantes) |
| `CS0507` | Gómez    | 2 |

El apellido no distingue mayúsculas ni tildes. Para volver a probar desde cero: `cd backend && .venv/bin/python -m app.reset_demo`.

Pruebas: `cd backend && .venv/bin/python -m pytest` (usa la base `plathost_test`).

Producción: `npm run build` en `frontend/`; la API sirve `frontend/dist` en el mismo origen.

`GET /api/health` indica si la API conecta con la base de datos.

### Variables de entorno (backend)

| Variable | Default | Uso |
|---|---|---|
| `PLATHOST_DATABASE_URL` | `postgresql://plathost:plathost@localhost:5433/plathost` | Conexión Postgres |
| `PLATHOST_SECRET` | `dev-secret-change-me` | Firma de los tokens de sesión — **cambiar en producción** |
| `PLATHOST_ADMIN_KEY` | vacío (deshabilitado) | Header `X-Admin-Key` para `GET /api/admin/checkins` |
| `PLATHOST_UPLOADS_DIR` | `backend/data/uploads` | Fotos de documentos y firmas |

## Qué viene de la reserva y qué llena el huésped

| Campo del formato | Origen |
|---|---|
| Suite, check-in, check-out, N° de huéspedes, nombre y apellido del titular | **Reserva** (solo lectura) |
| Correo, WhatsApp | **Reserva**, precargados y editables |
| Tipo y número de documento, nacionalidad, fecha de nacimiento | Huésped — se **autocompletan** al escanear un pasaporte |
| País de residencia, motivo de visita, placa (opcional), contacto y teléfono de emergencia | Huésped |
| Acompañantes (uno por cada huésped adicional): nombre, documento, nacionalidad, nacimiento | Huésped — con pasaporte, el escaneo llena todo, incluido el nombre |
| Aceptación de normas, autorización de datos (Ley 1581 de 2012), firma | Huésped; la fecha es automática |

Las normas de estadía están en `backend/app/rules.json` (ES / EN / FR / DE).

## Tipos de documento

Definidos en un solo lugar, `backend/app/documents.py`, y aplicados tanto en el cliente como en el servidor:

| Código | Documento | Número | Reglas | Imagen |
|---|---|---|---|---|
| CC | Cédula de ciudadanía | 3–10 dígitos | ≥ 18 años, nacionalidad Colombia | Solo foto |
| TI | Tarjeta de identidad | 10–11 dígitos | 7–17 años, nacionalidad Colombia | Solo foto |
| CE | Cédula de extranjería | 3–10 dígitos | Nacionalidad ≠ Colombia | Solo foto |
| PA | Pasaporte | 5–20 alfanumérico | — | **Verificación MRZ** |

Al elegir CC o TI la nacionalidad se fija en Colombia. Cada huésped debe subir la foto del tipo de documento que declaró.

## Verificación del pasaporte

1. **Cámara** (`DocumentScanner.jsx`): se muestra un marco con la proporción del pasaporte y la franja del MRZ. Cada ~1,2 s se recorta esa franja, se pasa a escala de grises con contraste ajustado y se lee con tesseract.js (solo `A–Z 0–9 <`). Un cuadro solo se envía cuando sus dígitos de control de fechas cuadran localmente; si no, sigue escaneando. También existe el botón **Capturar** y la opción de **subir una foto** (se busca el MRZ en toda la imagen).
2. **Servidor** (`app/mrz.py`, `POST /api/documents/verify`), que es quien decide:
   - dígitos de control ICAO del número, nacimiento, vencimiento y compuesto,
   - que sea un pasaporte (MRZ TD3 con tipo `P`),
   - vigencia **hasta el check-out**,
   - fecha de nacimiento válida,
   - que el nombre coincida con el titular de la reserva o con el acompañante.
   Corrige confusiones típicas del OCR (`O/0`, `G/6`, relleno `<` leído como `L`…) sin relajar la validación: un dígito de control incorrecto siempre falla.
3. Resultado: `verified`, `review` (documento válido pero el nombre no coincide), `failed` o `unreadable`. En CC/TI/CE se guarda la foto como `captured` para revisión en recepción. Todas las imágenes quedan en `document_scans`.

> Esto comprueba que el MRZ es auténticamente consistente y corresponde al huésped; no detecta falsificaciones físicas. Los originales se siguen presentando en portería, como indican las normas.

### Cámara en celulares

`getUserMedia` exige **HTTPS** (o `localhost`). Para probar desde un teléfono en la red local, sirva el frontend con HTTPS (p. ej. `@vitejs/plugin-basic-ssl` y `npm run dev -- --host`) o detrás de un túnel HTTPS. tesseract.js descarga su motor y el modelo `eng` desde jsDelivr la primera vez; para no depender del CDN, copie esos archivos a `public/` y configure `workerPath`, `corePath` y `langPath` en `src/lib/ocr.js`.

## Pendiente para producción

- Almacenamiento de imágenes en un bucket privado en vez de disco local.
- Integrar la fuente real de reservas (PMS / channel manager) en lugar de `db.SEED`.
- Panel de recepción (hoy solo existe `GET /api/admin/checkins`).
- Límite de intentos en el login.
