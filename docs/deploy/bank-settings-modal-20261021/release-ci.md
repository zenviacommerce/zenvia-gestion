# Cuentas bancarias: CI final y publicación autorizada

2026-10-21. PR #275. Head bd12d20ffede41facbaaff0daf2e2bf6dd134130, árbol28a8c81833ca43ada5c0a04494eadd4f44329e53 idéntico al árbol local verificado,97 archivos/78PNG con hashes comprobados. Fuente de producto62883c3, evidencia9f19070.

Los seis workflows y siete checks terminaron success; estado Vercel success.323/323 pruebas Vitest finales locales y build. Revisión independiente final sin hallazgos,27 escenarios offline con105 capturas brutas y60retendidas +18antes, fuentes/imágenes verificadas. Estilos calculados a390/1280/1440 iguales a General (etiquetas12/800; inputs14/400); sin overflow.

```json
[
  {
    "name": "Vercel Preview Comments",
    "conclusion": "success",
    "url": "https://vercel.com/github"
  },
  {
    "name": "build",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320866/job/119497353960"
  },
  {
    "name": "real-auth-vault",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320804/job/119497352870"
  },
  {
    "name": "package-and-parity",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320722/job/119497352723"
  },
  {
    "name": "auth-tests",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320657/job/119497352138"
  },
  {
    "name": "build",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320681/job/119497352005"
  },
  {
    "name": "screenshots",
    "conclusion": "success",
    "url": "https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39679320691/job/119497351880"
  }
]
```

Autorización explícita del propietario: publicar si coincide con el estilo y CI verde, después de C y separado. Ambas condiciones cumplidas. Platform C #80 ya publicado/verificado.

Rollback comprobado inmediatamente antes de producción: dpl_7CSVhxQAduPuzzn2MDmBA2GE1Qji READY, gestion.zenviacommerce.com, main e20260e9540debb368ed19a461e2a0c7ff9bcfab (#274). Volver a promover ese deployment y revertir solo este ajuste frontend. Se conserva lector compatible con cuentas/snapshots; sin SQL, migraciones, borrado/restauración de datos ni cambios Auth/MFA. No documentos reales de prueba.

Decisión documentada: las cinco otras colecciones se revisan y anotan para migración posterior, conservando sus distintos contratos de persistencia. Coste: permanecen temporalmente como excepciones al patrón lista+modal.
