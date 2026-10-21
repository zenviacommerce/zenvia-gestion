# @zenvia/ui 0.1.0 — cierre de verificación y parada

Fecha: 21 de octubre de 2026 (Europe/Madrid).

PR de revisión: [#272](https://github.com/zenviacommerce/zenvia-gestion/pull/272), en borrador. Commit comprobado: `95891f9816313bfe11b7b910593689e267e200c5`.

**CI 6/6 en verde y Vercel preview en verde. No se fusiona ni se publica.**

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Build check | success | [Run 39611197668](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197668) |
| Build ZENVIA Gestión | success | [Run 39611197612](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197612) |
| Shared UI package and visual parity | success | [Run 39611197739](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197739) |
| Auth resilience tests | success | [Run 39611197850](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197850) |
| MFA visual review (Playwright) | success | [Run 39611197653](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197653) |
| MFA real integration (disposable Supabase) | success | [Run 39611197392](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39611197392) |

## Resultado

- 66/66 pares PNG idénticos byte a byte: 17 vistas a 390/1280/1440 px, incluidas continuaciones móviles. Sin máscaras ni tolerancias. La repetición en GitHub también pasa.
- Build correcto; suites locales completas: 271 Vitest y 1.243 Node/SQL. Consumidor externo del tarball con render SSR y tipos. Instalación limpia offline y revisión independiente sin bloqueadores.
- Cascada compilada idéntica al build anterior: CSS SHA-256 `6992810b25f970a5564de76beb863640afa35602a0133d9ca0c7e7d897110548`.
- Primer CI detectó una carrera del harness de maestros al consultar un portal todavía oculto. Corregida esperando el listbox asociado y su cierre; 9 casos antes y 9 después pasan, además de la CI completa. No se cambia el producto ni se relajan aserciones.
- Verificado al cierre: main sigue en `45441a470dd2ff30fc4d78020a0cc1309290bf6d`. No se ha hecho merge, tag, release, publicación del paquete, despliegue de producción, migración ni modificación de datos/MFA. La CI MFA utiliza su entorno desechable.
- Corrección manual informada por el propietario ya registrada en el diario: pedido 407-0024766-5208363 → MRW / Sendcloud; tracking 01009F045746. Esta tarea no repite ni modifica el pedido.

## Revisión y rollback

[Comparación completa](https://github.com/zenviacommerce/zenvia-gestion/blob/refactor/shared-ui-0.1.0/docs/deploy/ui-extraction-20261021/review/README.md). [Diario y rollback preparado](https://github.com/zenviacommerce/zenvia-gestion/blob/refactor/shared-ui-0.1.0/docs/deploy/ui-extraction-20261021/README.md).

Este recibo se conserva en la rama de auditoría para documentar los resultados del commit revisado sin invalidar su CI con otro commit documental. Ninguna rama se fusiona.

**PARADA SOLICITADA: revisión del propietario antes de publicar. Lote B de Platform todavía no iniciado.**
