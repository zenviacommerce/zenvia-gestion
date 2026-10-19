# Evidencia de sesiones Auth — 19 de octubre de 2026

Revisión de solo lectura de Supabase `sjkxxbedkkmgmqnvaqjh`, ventana explícita 10:00–14:30 UTC. Consultas a `auth_logs`, `auth_audit_logs`, `auth.sessions` y columnas no sensibles de `auth.mfa_factors`. No se modificaron configuración, factores, sesiones ni tokens. No se extrajeron secretos ni tokens.

## Hechos comprobados

- La ventana contiene 2.712 registros `auth_logs` y 34 registros `auth_audit_logs`.
- Para el usuario investigado se registraron llamadas `/logout` exitosas: HTTP 204 a las 12:49:43 y 12:55:42 UTC. Auditoría confirma los eventos `logout` (el segundo aparece a las 12:55:41).
- A las 12:49:49 hubo login con contraseña HTTP 200, seguido de challenge y verify TOTP HTTP 200 a las 12:50:06.
- A las 14:16:08 hubo login con contraseña HTTP 200; challenge y verify TOTP HTTP 200 a las 14:16:23.
- A las 14:20:53 hubo otro login con contraseña HTTP 200; challenge y verify TOTP HTTP 200 a las 14:21:15.
- Las dos sesiones existentes al consultar fueron creadas a las 14:16:08.115942 y 14:20:53.702720 UTC. Ambas tienen `aal=aal2`; sus actualizaciones fueron 14:16:23.909663 y 14:21:15.158616, respectivamente. Ambas tienen `not_after=null` y `refreshed_at=null`.
- Existen dos factores TOTP con estado `verified`, creados el 18 de octubre a las 21:52:41.306358 y 22:20:17.153037 UTC. El primero tiene última challenge el 19 de octubre a las 14:21:15.021415.

## Errores observados y límites de atribución

La consulta global de errores Auth de la ventana devuelve:

| Error | Endpoint / estado | Cantidad | Intervalo UTC |
|---|---|---:|---|
| `session_not_found` / Session not found | `/user` 403 | 63 | 12:49:54–13:12:03 |
| `refresh_token_not_found` / Invalid Refresh Token: Refresh Token Not Found | `/token` 400 | 1 | 14:16:02 |

Estos errores no se devolvieron en la consulta restringida a `user_id` o `auth_event.actor_id` del usuario. Son evidencia del proyecto y no deben atribuirse automáticamente a su navegador. El error de refresh ocurre seis segundos antes de su nuevo login, una proximidad temporal compatible con el incidente pero insuficiente para probar causalidad.

`token_revoked` aparece junto a `token_refreshed` durante refresh exitosos HTTP 200, y también junto a verify TOTP exitosos. Ese evento aislado no demuestra cierre de sesión ni expiración por MFA.

## Hipótesis del límite AAL1 de 15 minutos

No confirmada. Las herramientas disponibles no exponen lectura de configuración Auth del proyecto. No se inspeccionó el dashboard y no se verificó el valor de ese límite. La consulta de errores no encontró un motivo explícito de expiración AAL1; los logs muestran cierres por `/logout` anteriores y un refresh inexistente antes del login de las 14:16. Las sesiones actuales AAL2 no reconstruyen las sesiones anteriores eliminadas ni prueban qué originó la pérdida de sesión.

Los bundles pre-MFA y MFA y el despliegue de las 14:15 son contexto aportado por la investigación principal; esta revisión de Auth no verifica qué bundle cargó cada navegador ni relaciona el despliegue con un logout.

## Texto recomendado para el diario

> Tras publicar el frontend con MFA, se observó un nuevo login con contraseña a las 14:16:08 UTC y una verificación TOTP exitosa a las 14:16:23; la sesión resultante figura como AAL2. También se confirmó un segundo login y verificación TOTP a las 14:20:53–14:21:15. La causa de la pérdida de la sesión previa queda pendiente: la hipótesis de un límite de 15 minutos para sesiones AAL1 con factores MFA no está demostrada por los logs ni por una lectura de configuración. Hay cierres `/logout` exitosos a las 12:49 y 12:55, además de un `refresh_token_not_found` del proyecto a las 14:16:02 cuya atribución al navegador afectado no está confirmada.

## Referencia de semántica

La documentación oficial de sesiones señala que los límites de sesión se aplican al refrescar y que la limpieza de sesiones no implica terminación proactiva exacta al llegar al límite: https://supabase.com/docs/guides/auth/sessions . Esto impide inferir un logout exacto a los 15 minutos a partir de la opción de configuración por sí sola.
