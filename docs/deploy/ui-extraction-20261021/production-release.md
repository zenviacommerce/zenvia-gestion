# Publicación PR #272 — verificación de producción

21-10-2026. Publicación expresamente autorizada por el propietario; rollback documentado antes del merge.

- PR #272 fusionada por squash: `5e90cb6fc6e1997ca4dd3376e3c6e15e06573699`.
- Vercel producción `dpl_Bn7hL8R6vYWkqefn8qsud3ARhfvy`, estado READY, dominio gestion.zenviacommerce.com y commit coincidente.
- HTML público sirve `index-Cus23HhV.js` y `index-KrPt1wkg.css`; ambos descargados correctamente. CSS SHA-256 `6992810b25f970a5564de76beb863640afa35602a0133d9ca0c7e7d897110548`, idéntico al anterior.
- Navegador del propietario: recarga manteniendo acceso; Resumen, Pedidos y Facturación cargan; primitivas compartidas y acciones visibles. Consola: cero errores capturados durante este smoke. No se emiten ni editan facturas, etiquetas ni documentos reales.
- Captura parcial de Pedidos sin datos de destinatarios: production-smoke.png.
- Rollback inmediato: proyecto `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv` → deployment anterior `dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe`, commit `45441a470dd2ff30fc4d78020a0cc1309290bf6d`; alternativa revert del squash en Git. No se ha necesitado rollback.
- MFA/configuración/Auth/Edge/SQL sin modificaciones de esta publicación. La sesión del piloto continúa accesible; esto no sustituye su futura ampliación.

Siguiente paso autorizado: Platform lote B, sin publicar hasta revisión de capturas. Prioridad nueva y diagnóstico de tracking conservados en release-preflight.md y ../20261021-tracking-diagnosis.md; la implementación de tracking espera a terminar Platform.
