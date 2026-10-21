# Cuentas bancarias: publicación verificada — 2026-10-21

PR #275 fusionada con autorización explícita, main ee11f1d49855fc324376c91f7e3d9304b4dcdc33. El árbol de merge28a8c81833ca43ada5c0a04494eadd4f44329e53 coincide exactamente con el árbol local/PR validado. Vercel dpl_Ea6nnkThkdvdtJGkfEWqguF2NBsh READY; gestion.zenviacommerce.com apunta al mismo commit. Despliegue separado y posterior a Platform #80 (ef88c498 / dpl_FSe8msvo5D6Xwg4pDfbdFjaDvvfA).

CI previa del head bd12d20ffede41facbaaff0daf2e2bf6dd134130: seis workflows/siete checks success más estado Vercel success. Local final323/323 Vitest y build; revisión independiente final aprobada, hallazgos corregidos.78 PNG390/1280/1440,27 escenarios después,105brutas/60retenidas +18antes; estilos calculados y fuentes/imágenes verificadas.

Comprobación pública de HTML, JS y CSS servido:

```json
{
  "domain": "https://gestion.zenviacommerce.com",
  "htmlStatus": 200,
  "asset": "/assets/index-yg3r8FYy.js",
  "assetStatus": 200,
  "assetSha256": "553178d1292e30a17b3a43fe05bfa5a4d72f28038845ff75f2ae6238203f9fae",
  "cssAsset": "/assets/index-Bkg9fQOZ.css",
  "cssStatus": 200,
  "cssSha256": "b167daba623d1307a94230793b5d79243d3bddd76153110acbdb9ad68dcc782a",
  "bankUiTerms": {
    "bankAccountDialog": true,
    "bankAccountModal": true,
    "Nueva cuenta bancaria": true,
    "Editar cuenta bancaria": true,
    "Añadir cuenta": true,
    "Eliminar cuenta bancaria": true
  },
  "settingsFieldRegularWeight": true,
  "deployment": "dpl_Ea6nnkThkdvdtJGkfEWqguF2NBsh",
  "commit": "ee11f1d49855fc324376c91f7e3d9304b4dcdc33",
  "scope": "Public deployment and served JS/CSS verification; no authenticated production interactions or data writes"
}
```

La verificación de producción confirma deployment/commit/dominio y contenido público servido. Las interacciones bancarias, documentos y confirmaciones se probaron con datos ficticios/red bloqueada; no se hicieron escrituras autenticadas de producción ni se emitieron documentos reales. El propietario puede comprobar su lista y abrir/cancelar el editor en Configuración→General. No cambios SQL/migraciones/Auth/MFA/dependencias ni datos fiscales; se conservan snapshots y lector compatible.

Rollback anotado antes de publicar: promover dpl_7CSVhxQAduPuzzn2MDmBA2GE1Qji (#274, main e20260e9540debb368ed19a461e2a0c7ff9bcfab) y revertir solo este ajuste frontend. No restaurar/borrar esquema ni snapshots. [CI y preflight](release-ci.md).

Decisión de alcance y coste: se añade la regla lista+modal al sistema de diseño y se auditan métodos de pago, reglas de envío, formatos de paquete, pesos por SKU y alias de proveedores. Sus migraciones quedan separadas por sus diferentes contratos de persistencia; permanecen temporalmente cinco excepciones documentadas. No se alteran credenciales/OAuth de integraciones ni ajustes escalares.

Orden vigente después de cerrar Platform y este ajuste: pendientes de Gestión con seguimiento de envíos primero; MFA y Amazon solo después. No se ha adelantado ese backlog durante este despliegue.
