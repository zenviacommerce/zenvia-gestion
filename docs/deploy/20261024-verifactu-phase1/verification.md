# Evidencia de verificación — fase 1

Sin ejecución de SQL mutante en producción. Código probado con datos sintéticos y estructura obtenida por catálogo; ninguna factura real emitida.

- Revisión independiente: dos Important reproducidos y corregidos con RED→GREEN (totales de cabecera manipulables; R1 en factura standard sin original). Revisión de correcciones sin Critical/Important abiertos. Core 21/21 revisados independientemente; ampliado después para impedir escritura directa service_role del contador de recibos.
- Cuatro suites fiscales/lifecycle: 96/96 GREEN antes del último endurecimiento de contador; resultado final actualizado a continuación.
- Build local: `npm run build` GREEN; aviso preexistente de tamaño del bundle, sin errores TypeScript.
- Diseño/fixtures: 16/16 en seis suites de primitivas, tabs, settings y representación de logo/PDF legacy, sin cambiar generadores PDF.
- PostgreSQL 17 real, workflow [40079614657](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/40079614657), commit 6cff8af65aa3e5b054c4628db9975f0f6db22aa1: gate GREEN. 20 clientes simultáneos → números consecutivos, SHA-256 y cadena sin bifurcación; 20 reintentos simultáneos → una emisión; dos series → una cadena; rollback → no consume número/registro; ambos órdenes de carrera edición/emisión coherentes; tenant/MFA/archivo privado/emisión directa rechazados. Los ERROR de PostgreSQL de intentos prohibidos son aserciones negativas esperadas.
- Capturas before/after: componentes reales, mocks sintéticos, ninguna conexión de backend; HTML con procedencia explícita y CSS compartido en esta carpeta. Workflow reproduce PNG desktop/móvil con Playwright fijado 1.58.2 y red externa bloqueada.

La suite global inicial encontró solo archivos locales faltantes en el checkout reconstruido, no cambios del producto. Se restauraron exactamente desde main los fixtures binarios, vendor JS, docs y snapshots ya existentes, sin incluirlos como cambios de la PR. La repetición de los seis suites afectados se registra abajo; no se ocultan fallos ni se presentan como regresiones corregidas por código fiscal.

Rollback probado: restaura función guard y reservas del borrador antes de activación; rechaza destrucción del esquema tras actividad. No se afirma igualdad byte a byte de ACL/manifests/timestamps: updated_at del borrador puede avanzar con migración/reversión. Después de uso, solo kill switch y conservación.
