# Reetiquetado tras cancelación — 23/10/2026

Estado: en validación; no publicado. Estimación anunciada: 45–60 minutos. Base local 5fdb8fe; producción Gestión 64a09358e253bfb6c44e8de73cd8b01c117d4e57 (A+B), sin diferencias en aplicación tras la conciliación de migraciones.

## Registro

- Se recuperan únicamente los cambios de 2b aparcados en 3373eea, conservando A/B. El único conflicto corresponde a dos imports independientes: se conservan ambos. No se recupera la antigua galería.
- Rojo observado: 18 fallos / 3 casos verdes antes de implementar; faltaba el predicado y los handlers rechazaban los reemplazos. Verde focal: 21/21 tras aplicar la corrección.
- MRW: prueba real del handler con proveedor simulado, fallo de PDF y recuperación sin segunda transmisión: 1/1.
- Galería nueva contra A+B: 390/1280/1440, claro/oscuro, datos sintéticos y red externa bloqueada. Inventario: se mantienen acciones de pendientes y etiquetados; se sustituye el bloqueo de la expedición cancelada por Editar pedido y Preparar nueva etiqueta, que invoca el flujo existente.
- El harness se actualiza para importar el estado puro de informes y simular createPickupReports; no cambia la implementación B.

## Alcance y rollback preparado

Sin SQL, migraciones, reprocesados ni cambios a pedidos existentes. Sin envío, cancelación, factura, informe ni correo reales en pruebas. MFA piloto intacto.

NO publicar sin revisión de las capturas y autorización. Antes de cualquier despliegue futuro: tomar copia fresca de las cuatro Edge Functions de transporte y sus dependencias de producción; preservar mfa.ts/mfa-policy.ts de producción. Frontend base: dpl_9K2RvEJdTVrnMUKhA2u3t7Qv9GNw (mismos assets que B: dpl_CbsCXuosdtPzaPYQU9Q5WZKzTXuE). El rollback debe mantener el lector B y sus informes firmados; no revertir a una versión anterior a B.

Las correcciones A/B están publicadas y verificadas. PR291 (solo seis renombres byte idénticos, referencias y documentación) tiene seis checks verdes y despliegue READY dpl_9K2RvEJdTVrnMUKhA2u3t7Qv9GNw. Se verifica HTTP 200 y SHA256 de JS 37a855e993ad12d9842426b6582eab805c07358eacd8ec4ebbce93506594fb20 y CSS 1d8486aac28204a71993fdf6880bf0ac4768ec423a638b9020b1eec3f962f211, idénticos a B.

## Revisión independiente

Un hallazgo importante: al cambiar MRW/Envia → Sendcloud se conservaba la cuenta/proveedor anterior. Reproducido con cuatro regresiones rojas (cotización de ambos handlers y creación tras cada proveedor). Se resuelve una cuenta Sendcloud del workspace y se persiste proveedor/cuenta nuevos tras confirmación. Si cambia la cuenta, no se reutiliza un pedido remoto de la cuenta anterior. La prueba ejecuta también la creación del pedido remoto, con AbortSignal real en el VM. Sin otros hallazgos ni menores aplazados.

Primera suite completa: 649/649 Vitest, 116 archivos; build correcto. Tras la corrección de revisión se repetirá la suite. Deno 2.9.6 valida las cuatro funciones.

Incidencia local de verificación: cuatro pruebas Node fallaron porque el worktree parcial no incluía dos documentos y dos iconos ya presentes en main. Se restauran copias byte idénticas (hashes Git contrastados con el árbol remoto), sin cambios de producto ni exclusiones. Se repite Node completo.

Validación posterior al hallazgo: 25/25 focales, Node completo1284/1284, Deno y build correctos. Inspección de capturas: el texto informativo de cancelación usa el párrafo normal del sistema para mantener contraste en oscuro; no se presenta como error. Se regeneran las24capturas y se conserva el inventario.
