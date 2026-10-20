# Migración de diseño de Gestión · CERRADA

El propietario aprueba el lote3 #267. Se publica con las seis comprobaciones y Vercel en verde sobre 61553d95a65c09afaedbcaa210d5bff3558bc348. Merge d688e654b742dbe86ad9463f8a8f8b90a49bce94; producción READY dpl_J9SdQzp3LeFm8kp1nRVmiNEz1DZG; bundle index-DHz0kr4n.js.

## Verificación real

Navegador autenticado: Soporte conserva cabecera, tabs, KPI, filtros y estado vacío correcto. Administración carga 5 usuarios, 5 activos y 3 administradores con tabs comunes. Configuración conserva las 14 secciones. En 390 px se ven logo y sello completos, incluida la línea «11.660 PRADO DEL REY (Cádiz)»; contain, máximo 100%, proporción y altura automática sin overflow que recorte; escritorio inspeccionado también. No se editaron usuarios, ajustes, datos ni credenciales.

[Soporte](design-gestion-closed-20261020/gestion-final-support-1280.png) · [Administración](design-gestion-closed-20261020/gestion-final-admin-1280.png) · [Logo y sello móvil](design-gestion-closed-20261020/gestion-final-settings-preview-390.png) · [Recibo](design-gestion-closed-20261020/receipt.json).

## Amazon: dato nuevo confirmado

Lecturas anteriores20 oct 21:07:57.684Z y 21:09:40.830Z. El evento Refund de Francia A13V1IB3VIYZZH se produjo20:35:38Z y se insertó/sincronizó21:08:10.923103Z. Su componente Refunded Sales es−13,99 € (IVA−2,33€): el impacto bruto+13,99 € coincide exactamente con239,44→253,43 € y 12→13 reembolsos. El job finances Francia ejecutó21:08:09.962237→21:08:11.139Z,68 filas,success. Otros marketplaces también sincronizaron comisiones/finanzas entre ambas lecturas. Es información nueva de finanzas, no evidencia de regresión visual; no procede rollback por ese incremento. Esto no sustituye la conciliación pendiente con Seller Central. Evidencia SQL de solo lectura, sin datos personales ni tokens, en recibo.

## Rollback

Antes de publicar quedó preparado el lote2: commit a03f10ca6e90f8d03765fbc4d90bba18bdee945d, deployment dpl_AvXMo7EGoQY32WAgU2JGhQpb14cX, index-lLeCVOf1.js. Restaurar ese deployment o revertir el merge d688e654 mediante PR y CI. No hay datos/SQL/Edge/Auth que revertir.

## Cierre y siguiente etapa

Fases 1, 2 y 3/lotes 1–3 cerradas con aprobación del propietario. Verificación final de todas las pantallas y guard sin cabeceras/KPI heredados fuera de sus propietarios, preservando carruseles analíticos aprobados, acciones y variantes. No se afirma eliminación de cada selector CSS histórico. Evidencia completa en #267 y docs/deploy/design-phase3-final-20261020. Se inicia Platform fase0: solo auditoría, capturas, mediciones y propuesta, sin publicación ni cambios funcionales. MFA no cambia ni se amplía.
