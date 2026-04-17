# Badelco SOAT API

API para cotización y expedición de SOAT con despliegue en Railway.

## Cambios de seguridad aplicados

- Se eliminaron credenciales hardcodeadas del frontend para ingreso de aliados.
- El login de aliados ahora se valida en backend con `ALLY_LOGIN_USER` + `ALLY_LOGIN_PASSWORD_HASH`.
- Se implementó sesión temporal con token Bearer en memoria del servidor.
- La ruta `POST /api/expedir` ahora exige sesión válida de aliados.
- Se agregó rate-limit dedicado para `POST /api/auth/login`.
- Se bloquearon endpoints de debug en producción (`ENABLE_DEBUG_ENDPOINTS=false`).
- Se eliminaron respuestas que devolvían tokens completos en endpoints de prueba.

## Variables requeridas en Railway

Copiar desde `.env.example` y cargar en Railway Variables:

- `NODE_ENV=production`
- `PORT=3000`
- `ENABLE_DEBUG_ENDPOINTS=false`
- `ALLOWED_ORIGINS=https://badelco-soat-api-production.up.railway.app`
- `API_BASE_URL=https://pagoalafija.co/api/public`
- `SAME_API_BASE_URL=https://pagoalafija.co/api/public`
- `API_KEY=...`
- `SECRET_KEY=...`
- `AUTHTOKEN=...` (opcional si SAME permite generación dinámica estable)
- `SAME_API_KEY=...`
- `SAME_SECRET_KEY=...`
- `SAME_COD_PRODUCTO=63`
- `SAME_IND_PRUEBA=1`
- `ALLY_LOGIN_USER=...`
- `ALLY_LOGIN_PASSWORD_HASH=...`
- `SESSION_TTL_MINUTES=30`
- `NOTIFICATION_EMAIL=info@badelco.co`
- `SMTP_HOST=...`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=...`
- `SMTP_PASS=...`
- `SMTP_FROM=...`

## Generar hash de contraseña de aliados

1. En local, ejecuta:

```bash
npm run hash:password -- "TuPasswordSegura"
```

2. Copia el resultado (formato `salt:hash`) en `ALLY_LOGIN_PASSWORD_HASH`.
3. No guardes la contraseña plana en GitHub ni Railway.

## Paso a paso de despliegue (GitHub + Railway)

1. Confirma que tu rama en GitHub tenga estos cambios de seguridad.
2. En Railway, abre tu servicio `badelco-soat-api`.
3. Ve a Variables y crea/actualiza todas las variables de la sección anterior.
4. Verifica que `ALLOWED_ORIGINS` incluya solo tus dominios reales (sin comodines).
5. Asegura `ENABLE_DEBUG_ENDPOINTS=false`.
6. Despliega desde GitHub (Deploy latest commit).
7. Revisa logs de arranque y confirma:
   - Login aliados configurado: true
   - SAME API configurada: true
8. Prueba endpoints:
   - `GET /api/config`
   - `POST /api/auth/login`
   - `POST /api/cotizar`
   - `POST /api/expedir` (con Bearer token del login)
9. Valida en frontend:
   - El modal Aliados solicita login
   - No existen credenciales hardcodeadas en `index.html`
   - La expedición falla con 401 si no hay sesión

## Checklist de producción

- Rotar `API_KEY`, `SECRET_KEY`, `AUTHTOKEN` si estuvieron expuestos.
- Mantener `.env` fuera de Git.
- Activar monitoreo de logs y alertas de Railway.
- Revisar periódicamente `local-notifications/` si SMTP falla.
