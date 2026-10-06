# Indicadores de importación con el motor actual

Publicación solicitada el 6 de octubre de 2026: frontend de Zenvia Gestión, manteniendo el motor actual y sin migraciones ni nuevos endpoints en producción.

- Indicadores globales para archivo/cámara, lotes de gastos, ventas, Gmail y tarifas. Las revisiones muestran un icono de documento, no un spinner de procesamiento.
- Los modales conservan candidatos al cerrarse; los módulos de importación visitados y Gmail permanecen montados al navegar, separados por usuario/empresa.
- Los lectores, las reglas fiscales y las integraciones originales permanecen intactos. La selección de nuevos documentos se bloquea mientras se está analizando el lote actual.
- Con este motor de navegador, cerrar la pestaña o recargar interrumpe los procesos y descarta revisiones no guardadas. La cola de servidor y Ollama se mantienen en la rama separada `feat/persistent-imports`.

Validación: compilación TypeScript/Vite correcta; aceptación React/DOM correcta (navegar, completar análisis oculto, recuperar revisión y finalizar indicador); suite completa 784 pruebas, 758 correctas y 26 fallos existentes. Base exacta: 783 pruebas, 757 correctas y los mismos 26 fallos; ninguno nuevo. No se hizo una importación autenticada de documentos del usuario durante esta validación.

La publicación anterior estaba en el commit `d6ad0c0d28f3df45da2d87bbd121b05193210650`, despliegue Vercel `dpl_CAuYEq2jmC8qcrGiW5yWf7VzErpr`. Ese despliegue se conserva como referencia de reversión. Destino: proyecto `zenvia-gestion`, dominio `gestion.zenviacommerce.com`; no Zenvia Platform.
