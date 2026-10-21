# Hotfix: pausa de contratación PayPal — 21/10/2026

Autorizado por el propietario: publicar al pasar CI. Corrección completa en otra rama y detenida antes de producción.

Gestión conserva el catálogo visible, pero deshabilita Contratar/Activar con PayPal en mensual y anual. Aviso: «Estamos actualizando los precios; la contratación estará disponible en breve». La función de servicio también rechaza llamadas directas antes de acceder a sesión/red. No se cambia PayPal, ninguna suscripción, facturas, SQL ni MFA. Este hotfix bloquea el cliente de Gestión actualizado; la validación autoritativa del endpoint y los clientes antiguos se cubrirá en la corrección completa.

Validación local: reproducción roja (3 fallos esperados); después 3 tests nuevos verdes; suite Vitest completa 326/326; suite node 1244/1244; npm run build correcto; contrato de diseño correcto. Nuevos tests añadidos a CI.

Capturas previas de producción a 390/1280/1440 en 20261021-billing-checkout-pause/. Capturas posteriores y recibo de despliegue se añadirán al verificar producción.

Referencia y rollback preparados antes de publicar: main ee11f1d49855fc324376c91f7e3d9304b4dcdc33; Vercel dpl_Ea6nnkThkdvdtJGkfEWqguF2NBsh, https://zenvia-gestion-iryiwhmok-sergiorojasdiaz-7097.vercel.app. Preferir revert del commit del hotfix, con CI; rollback de Vercel solo ante regresión grave. Volver al despliegue anterior reabre la contratación discrepante. No hay rollback SQL/PayPal porque no hay cambios.

## Recibo de producción
- PR #276: seis workflows de CI correctos antes del merge. Commit main 3eaa170d1d5175ac598cc7663a5cbfcb378427db.
- Vercel READY: dpl_BF6FnzEMv44vsSveMHmahzU5QMfU, alias gestion.zenviacommerce.com, despliegue https://zenvia-gestion-6eusheyr4-sergiorojasdiaz-7097.vercel.app.
- Verificación autenticada en producción: aviso presente y botón Contratar con PayPal no habilitado. Capturas posteriores 390/1280/1440 junto a las previas; revisión visual móvil correcta. No se pulsó ningún botón de contratación.
- PayPal, suscripciones y MFA sin modificaciones. La corrección completa continúa en rama separada y no se publicará sin aprobación.
