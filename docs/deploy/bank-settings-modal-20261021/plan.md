# Configuración: cuentas bancarias con lista y modal

## Alcance aprobado

Después de publicar Platform C, desplegar este ajuste de Gestión por separado. La vista en reposo de Cuentas bancarias muestra la lista y Añadir cuenta. Alta y edición usan FormModal de @zenvia/ui con alias, IBAN, BIC/SWIFT y titular opcionales, Usar por defecto y Cancelar/Guardar. Eliminar conserva la confirmación real en modal y los documentos históricos. Se usan la sección, etiquetas, grid de tres columnas, controles, lista, badge y botones existentes en Configuración. IBAN agrupado de cuatro en cuatro solo al mostrarlo; no alterar validación, almacenamiento, defaults, snapshots ni emisiones.

## Tareas y responsables

1. Root: capturas antes desde el árbol publicado e20260e9540debb368ed19a461e2a0c7ff9bcfab (nativo d2c3e00), con datos ficticios y red bloqueada.
2. Implementación: panel bancario, selector compartido y pruebas de interacción; regla del sistema de diseño. Sin tocar API/SQL/Auth/MFA ni operaciones financieras reales. Revisar otras colecciones y documentar las diferencias de persistencia; este ajuste no convierte esos otros cinco formularios.
3. Root: capturas después a 390/1280/1440, listados vacío/poblado, alta/edición/cancelación/eliminación y selector en factura/recibo/Shopify. Revisión independiente y CI verde del head exacto.
4. Root: registrar rollback al frontend publicado #274, publicar esta rama separada y verificar el deployment y dominio. Publicación ya autorizada si coincide con el estilo.

## Decisión de alcance

La petición de otras secciones pide revisarlas y establecer la regla. Se auditan métodos de pago, reglas de envío, formatos de paquete, pesos por SKU y alias de proveedores. Sus migraciones quedan registradas como trabajo posterior porque combinan guardado por borrador y operaciones inmediatas distintas; no son necesarias para corregir bancos. El coste de esta decisión es mantener temporalmente esas cinco excepciones al nuevo patrón.

## Evidencia y seguridad

Pruebas existentes de fiscalidad/snapshots y formularios de documentos deben seguir pasando. No se cambia la base de datos. La cuenta principal en producción ya ha sido confirmada por el propietario. No emitir facturas, recibos ni documentos reales en las pruebas.
