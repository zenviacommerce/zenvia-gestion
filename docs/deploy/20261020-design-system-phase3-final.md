# Fase 3 · lote 3 y cierre de migración Gestión (NO PUBLICADO)

## Alcance y auditoría

El propietario aprueba #266 y pide preparar un último lote de Soporte, Configuración y Administración, con revisión antes de publicarlo. Auditoría AST de todos los TSX de pantallas/componentes: solo Admin, Settings, Support y la subpantalla Gmail conservaban pageHead crudo; Gmail además tres stat/stats crudos. Soporte y Admin tenían familias KPI especializadas fuera del detector inicial. Se incluye Gmail para que no quede un bloque activo heredado en Gastos. No se añaden funcionalidades ni cambios de escala o acceso.

## Aplicación

PageHeader común conserva títulos, descripciones y todos los botones/condiciones. Soporte y Administración adoptan KpiGrid/StatCard sin inferir avisos por nombres; las píldoras de estados/prioridad y auditoría conservan clases y datos. PageTabs común conserva ambos alcances de Soporte, Usuarios/Auditoría y todas las secciones de Configuración, asociadas a su panel. Configuración conserva el guard de cambios sin guardar y todos los componentes internos, incluyendo Seguridad sin cambios de Auth/MFA. FilterBar común aplica búsqueda separada y filtros iguales de una línea; Gmail conserva cuenta, periodo, selección e importación.

## Evidencia

Componentes/CSS reales, fixtures sintéticos, es-ES y red bloqueada. Antes/después a390/1280/1440 de Soporte, Administración/Usuarios, Administración/Auditoría, Configuración/General y Gmail, más segundo pantallazo móvil. Se mide primera fila; Configuración no tiene lista de registros: se informa primer bloque de ajustes. Se comparan KPI, tabs, primera fila, acciones y variantes semánticas; se cancela navegación con cambios sin guardar para comprobar conservación del formulario. No se crean tickets, usuarios, importaciones ni ajustes en producción.

## Protección final

Test nuevo de contrato observado en rojo con las cuatro pantallas heredadas y verde al migrarlas. Escanea todos los TSX, excluye solo los propietarios StatCard/PageHeader y prohíbe familias KPI anteriores; se retiran los permisos heredados de scripts/design-contract-legacy.json. Regresiones visuales de todas las fases en CI. Esto verifica ausencia de variantes activas de cabecera/KPI fuera de los componentes comunes, no eliminación de todo selector CSS histórico ni sustitución de carruseles analíticos especializados aprobados.

## Rollback y publicación

DETENER antes de fusionar/publicar. Rollback preparado al lote2 #266: main a03f10ca6e90f8d03765fbc4d90bba18bdee945d, deployment dpl_AvXMo7EGoQY32WAgU2JGhQpb14cX, bundle index-lLeCVOf1.js. Revert de este lote mediante PR/CI si se llegase a publicar. Sin cambios SQL, Edge, Auth ni datos. Platform se auditará después según el orden del propietario; no se altera el piloto MFA.

## Verificación y revisión

257/257 Vitest; 1224/1224 Node offline; build correcto; 15 escenarios antes y 15 después sin fallos. Revisión independiente sin críticos/importantes. Se corrigen observaciones menores: orientación responsive/teclado de tabs, foco al cancelar navegación asíncrona, colores decorativos de Gmail y cobertura de gmailStatus. Test de tabs observado en rojo y verde. La integración real Auth/Vault se verifica exclusivamente en CI desechable; el comando local indiscriminado intentó incluirla y se negó por falta del opt-in de fixture, sin tocar producción. La suite offline se ejecuta excluyendo ese runner.

[Galería y todas las alturas](design-phase3-final-20261020/README.md). Configuración: primer bloque de ajustes266→307px en móvil, por conservar descripciones. No se presenta como mejora de una lista inexistente.
