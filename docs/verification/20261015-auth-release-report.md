# Fase 2: revisión y plan de publicación

## Cambios

En auth-js 2.105.0, NETWORK_ERROR_CODES incluye 502/503/504 pero no 500. En refresh, ese 500 acababa como AuthApiError; _callRefreshToken elimina la sesión ante errores no recuperables. Clasificarlo únicamente en React era demasiado tarde.

La corrección actúa en el fetch usado por el cliente real, exclusivamente bajo /auth/v1/:

```ts
const response=await fetch(input,{...init,signal:controller.signal});
if(response.status>=500&&response.status<=599)
  throw new AuthRetryableFetchError(
    `Auth service temporarily unavailable (HTTP ${response.status})`,
    response.status,
  );
return response;
```

El SDK captura el error de transporte, lo vuelve a envolver como AuthRetryableFetchError con status 0 y conserva la sesión. El estado HTTP original sigue en el mensaje. classifyAuthError reconoce el nombre AuthRetryableFetchError como temporal.

Los HTTP 400 no se convierten: llegan íntegros al SDK, que invalida la sesión, borra la clave local y emite SIGNED_OUT. Se añadió clasificación invalid-session para status 400 + code invalid_grant; refresh_token_not_found ya estaba contemplado. No se fuerza setSession(null) por timeout.

## Evidencia

20/20 Vitest tests con SDK real y build correctos. Los dos tests adicionales responden al endpoint real /auth/v1/token?grant_type=refresh_token mediante fetch controlado con 400 refresh_token_not_found y 400 invalid_grant. Cada uno verifica una sola petición, un SIGNED_OUT, localStorage eliminado, getSession() null y ningún reintento tras 35 segundos.

PR existente reutilizada: https://github.com/zenviacommerce/zenvia-gestion/pull/214 . Ejecución Auth verde con los dos 400: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/38811717466 . La PR también incorpora después la adaptación de tres harnesses antiguos al nuevo bootstrap; 25 aserciones de esos harnesses pasan. Consultar el último SHA y Actions antes de aprobar.

Hosting observado: Vercel integrado con GitHub; vercel.json declara Vite, npm run build y dist. Los workflows de GitHub generan artefactos, no realizan el despliegue frontend directamente. Vercel bot confirma preview Ready: https://zenvia-gestion-git-feature-auth-res-aecea4-sergiorojasdiaz-7097.vercel.app . No se ha promovido a producción ni fusionado main.

## Desviaciones

La PR #214 ya estaba abierta como draft; se actualiza en vez de duplicarla. El workflow general de aplicación es rojo en 8 casos que también fallan en main 840e2f20 sin modificar: ambas ejecuciones tienen 985 tests, 977 correctos y 8 fallidos. Son seis casos Amazon, uno Gmail y uno Shopify, listados en auth-phase2-20261015.md de la rama Auth y en el informe final. No se ocultan, eliminan ni excluyen del workflow general.

El conector Vercel devuelve Project not found incluso con ID/team del bot, por lo que la rama de producción y los ajustes internos no se han podido comprobar por esa API. El despliegue de preview sí está acreditado por el estado y comentario del bot en GitHub. Antes de fusionar, confirmar la asociación de main al entorno de producción y el deployment anterior para rollback. No se ejecuta un despliegue alternativo para eludir esta limitación.

## Publicación, smoke test y rollback

Esperar confirmación explícita del usuario antes de merge/promoción de producción. Comprobar SHA final, checks y advertencias conocidas; verificar el despliegue de Vercel resultante y su asignación al dominio correcto. No desplegar Edge Functions Amazon desde main.

Smoke test de 2 minutos tras producción, con una cuenta real autorizada:

1. Ventana privada: contraseña incorrecta muestra error de credenciales; después login correcto llega a la empresa esperada.
2. Recargar y abrir una segunda pestaña: sesión y empresa conservadas, sin pedir login ni mostrar datos de otra empresa.
3. Logout: vuelve al acceso; recargar y abrir una ruta protegida no recupera la sesión anterior. Limpiar la pestaña privada al terminar.

No se provoca un fallo de Auth en producción. Los 500/504 y refresh inválidos ya tienen pruebas deterministas aisladas. Si no hay credenciales/sesión de prueba disponibles para la automatización, estos son los pasos que puede comprobar el usuario.

Rollback frontend: restaurar el deployment de producción anterior en Vercel o revertir la PR y publicar ese build, comprobando SHA/dominio. No hay migraciones DB en la PR de Auth. Mantener las correcciones de aislamiento SQL, que son independientes.

Final Auth commit: b86b0e70f185f6013ae775f7ff0f374256a6d9de. Latest Auth/build execution is green: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/38815209694 . General workflow remains red: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/38815209861 .

The 8 baseline failing test names (also reproduced on untouched main):

- forecast is a distinct estimate and selecting it shows actual month products
- manual orders-only sync returns the actual job IDs and keeps other sources unchanged
- Amazon series trends net profit rather than pre-Ads profit
- Amazon page retains live status and manual sync without external shortcuts
- orchestrator and worker are internal-only and worker claims bounded jobs atomically
- manual sync handles an immediately drained queue without leaving stale pending state
- Gmail checkboxes import a selected batch and advance through manual reviews
- full product table has 11 columns, scoped mapping action and works through the full list
