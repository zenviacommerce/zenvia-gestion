# Ajuste visual bancario: preflight — 2026-10-21

El propietario confirmó #274 en producción: Cuenta principal predeterminada visible en General. Publicación de este ajuste autorizada tras capturas y CI verde, por separado de Platform C. Platform C #80 ya publicado en main ef88c498f73d21bb75acca84faad9c969299ad0f y dpl_FSe8msvo5D6Xwg4pDfbdFjaDvvfA READY; HTML/bundle público verificados.

## Baseline y rollback antes de tocar producción

Gestión: Vercel gestion.zenviacommerce.com apunta a dpl_7CSVhxQAduPuzzn2MDmBA2GE1Qji READY, commit e20260e9540debb368ed19a461e2a0c7ff9bcfab (#274), árbol923fecaf2a5a859c3d86e4b06efcabceaee7da72. El checkout aislado nuevo reproduce exactamente ese árbol (commit nativo d2c3e00). No se resetea el checkout anterior ni sus cambios preparados.

Si se detecta una regresión del ajuste visual: promover el deployment #274 dpl_7CSVhxQAduPuzzn2MDmBA2GE1Qji y revertir únicamente el ajuste frontend en main. Este lector ya entiende las cuentas múltiples y snapshots; no se vuelve al frontend anterior a #274. No hay migración SQL en el ajuste, ni necesidad de restaurar, borrar o modificar datos fiscales. Se conserva el esquema aditivo y todos los snapshots actuales.

Capturas antes desde baseline inmutable, a390/1280/1440, datos ficticios y red bloqueada. El arnés usa formularios/CSS reales y confirmación real en modal; los servicios de persistencia son exclusivamente memoria de prueba. No facturas/recibos/documentos reales, envíos, invitaciones ni operaciones PayPal; Auth/MFA intactos.
