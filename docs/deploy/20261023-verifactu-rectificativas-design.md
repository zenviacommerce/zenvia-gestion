# VERI*FACTU y rectificativas completas — diseño para revisión

23 de octubre de 2026. Estado: PROPUESTA, SIN IMPLEMENTAR. Responsable de aprobación: propietario de Zenvia. No habilita remisión real ni solicita certificados por chat.

## Decisión propuesta

Construir un núcleo fiscal único en Gestión, exclusivamente VERI*FACTU para los obligados de territorio común que entren en su ámbito, con registros inmutables, encadenamiento por obligado e instalación, outbox transaccional y un servicio aislado para custodiar certificados y comunicarse con AEAT. Platform administra capacidades y salud con permisos actuales; no comparte certificados entre clientes. Las rectificativas forman parte del núcleo antes de cualquier automatización Shopify.

Se recomienda **PostgreSQL + Edge Functions Deno para autorización y orquestación + pasarela fiscal aislada para mTLS**. React/Vite en Vercel presenta y descarga documentos, sin claves privadas ni facultad de emitir por escritura directa. Es una propuesta técnica del ingeniero, no una decisión ya aprobada por el propietario.

| Alternativa | Ventaja | Coste o límite |
|---|---|---|
| Certificado en Vault y uso directo por Edge Functions | Menos infraestructura | La identidad que puede descifrar secretos tiene una superficie amplia; requiere demostrar soporte mTLS, límites y aislamiento del runtime desplegado |
| Servicio fiscal aislado y KMS, recomendado | Claves fuera del frontend y del runtime general, permisos y destinos acotados | Nuevo servicio, operación, coste y prueba de recuperación; proveedor y presupuesto se aprueban antes de contratar |
| Proveedor fiscal externo | Reduce desarrollo del protocolo | Dependencia, coste por uso, contrato de encargado, exportación y portabilidad; no elimina la responsabilidad del fabricante |

No se implementa modalidad NO VERI*FACTU, ni se la activa automáticamente si falla Internet. Una baja de conexión crea una incidencia de remisión, conserva registros y reintenta. Un cambio futuro de modalidad exige otro diseño.

## Marco verificado y condiciones de entrada

La disposición final primera del RDL 15/2025 mantiene la adaptación antes del **1/1/2027 para los sujetos del art. 3.1.a** y **1/7/2027 para el resto**. Se ha contrastado el texto consolidado de RD 1007/2023 y BOE original, sin basar el calendario en anuncios. El plazo de fabricantes conserva la regla de nueve meses desde la Orden HAC/1177/2024; AEAT identifica el 29/7/2025. La ampliación para usuarios no equivale a permiso para vender ahora un SIF sin adaptar. [S1, S2, S3, S13]

Antes de habilitar ZENVIA COMMERCE SL: el asesor debe confirmar por escrito obligado/NIF, territorio, sujeción a Sociedades, **no inclusión en SII**, regímenes, series, rectificativas y fecha de comienzo. No consta evidencia suficiente en esta sesión para afirmar su situación censal. Los contribuyentes incluidos en SII están excluidos del RRSIF; el alta del cliente conserva el fundamento de inclusión o exclusión. No se envían automáticamente por VERI*FACTU operaciones de otro ámbito. [S10]

El RD exige altas, anulaciones, huella y trazabilidad, y declaración responsable del productor. La opción VERI*FACTU se mantiene al menos hasta terminar el año de su primer envío efectivo. No exige firma electrónica individual de los registros; el certificado autentica la transmisión. El registro reglamentario de eventos de NO VERI*FACTU no es obligatorio en la modalidad elegida. Por decisión de producto se mantiene auditoría interna inmutable de emisión, corrección, credenciales, remisión, exportación e incidencias. [S2, S3, S8, S9]

La remisión de registros a AEAT y la entrega de factura electrónica al comprador tienen finalidades y reglas distintas. El núcleo no presume consentimiento del cliente por activar VERI*FACTU. [S2, S4]

## Estado actual comprobado

Base de aplicación: main `ca8a595c6558356e766168fd51dd0ef78ef3ae66`, publicación de logística #297. Lectura de producción a las **13:53:57 UTC**: 29 facturas de venta en el proyecto, 1 borrador ordinario, 2 emitidas ordinarias y 26 cobradas ordinarias; ninguna rectificativa en ese recuento. Es inventario, no autorización de migración. Se repetirá por tenant, serie y ejercicio antes de cualquier actuación sobre documentos.

| Evidencia en repositorio | Consecuencia del diseño |
|---|---|
| `src/pages/SalesInvoicesCore.tsx` permite «Eliminar factura» en issued y edición condicionada por allowEditIssuedInvoices | Retirar ambas acciones y sus rutas masivas; protección efectiva en DB |
| RPC existentes `reopen_sales_invoice`, `delete_reversible_sales_invoice` | Revocar/bloquear para documentos emitidos; revisar wrappers MFA y todos sus callers |
| `create_rectifying_invoice(uuid)` y modelo standard/rectifying con una referencia | Extender a R1–R5, S/I, vínculos múltiples y sucesivos; no partir de cero |
| `issue_sales_invoice(uuid)`, líneas y numeración actuales | Hacer una emisión fiscal transaccional y bloquear bypass de tabla/RPC |
| `src/services/salesInvoicePdf.ts` y `SendInvoiceModal.tsx` | Congelar representación y servir el PDF archivado; Gmail consume ese PDF |
| `save_shopify_order_invoice`, `source_order_key`, `shopifyInvoiceCore` | Reutilizar idempotencia y reconciliación de importes; toda emisión atraviesa el mismo núcleo |
| Migraciones de demo reset y limpieza de emitidas | No pueden borrar documentos fiscales reales; separar entorno demo y bloquear el bypass de mantenimiento |

Huellas de definiciones observadas: reopen `37de2bfee716ff3ec12a694ea47dfe02`; delete reversible `a08991f23100d33bd05cc5fe5ea5b1e5`; rectificativa `30070950a0502278bfab5d63a915821b`; emisión `3ab4902e0991311503486058931cfed5`. La fase 0 debe inventariar también las políticas, triggers, importadores, exportadores y versiones privadas actuales, sin dar por hecho que las migraciones antiguas reflejan la definición activa.

## Modelo y aislamiento propuestos

Nombres orientativos para el diseño, no DDL listo para ejecutar:

| Entidad | Datos y restricciones principales |
|---|---|
| `fiscal_obligations` | owner, identidad fiscal versionada, ámbito/SII acreditado, modalidad, fecha efectiva y autorización; no deducir obligado solo del usuario conectado |
| `fiscal_installations` | obligado, ambiente test/live e identificadores SIF/instalación estables conforme XSD; versión de producto y declaración |
| `fiscal_chain_heads` | clave obligado+instalación+ambiente, último registro/hash/secuencia; bloqueo serial de creación |
| `fiscal_records` | alta/anulación/subsanación como nuevo registro, secuencia, identidad factura, snapshot, campos hash, texto de entrada, huella, anterior, versión esquema y XML exacto; append only |
| `invoice_fiscal_snapshots` | emisor/receptor, líneas, impuestos, moneda, fechas, referencias, plantilla y activos; inmutable al emitir |
| `invoice_rectifications` | rectificativa, originales o rectificativas previas, R1–R5, S/I, motivo, importes originales/correctos/diferencia y desglose por impuesto; sin ciclos |
| `fiscal_outbox` | registro, destino, estado operativo, próximo intento, lease/token, idempotency key; no almacenar credenciales |
| `fiscal_delivery_attempts` | intento inmutable, huella de petición/respuesta, hora, resultado global y de línea, códigos/CSV e identificador AEAT cuando existan |
| `fiscal_events` | actor, autorización, acción, objeto, motivo y tiempo del servidor; cadena interna separada de la cadena de facturación |
| `fiscal_certificate_versions` | solo metadatos públicos, fingerprint, vigencia, obligado y referencia opaca del custodio; sin P12 ni contraseña en DB de aplicación |
| `invoice_artifacts` | PDF y XML archivados, hashes, tamaño, versión de plantilla, almacenamiento privado y política de retención |

Todas las claves y FK relevantes incluyen owner/obligado; RLS y permisos de Facturación vigentes, con pruebas cruzadas entre clientes. Los helpers privilegiados viven en private, search_path vacío, sin EXECUTE a PUBLIC. El worker obtiene tareas por RPC estrecha y no recibe permisos generales de escritura fiscal. Autorización, permiso y MFA se verifican en el servidor: **no se amplía ni altera el piloto MFA actual**. Platform ve métricas sin contenido fiscal por defecto; soporte excepcional, justificado, temporal y auditado.

Una cadena no se divide por serie, canal o ejercicio. Una factura Shopify y una manual del mismo obligado/instalación comparten el encadenamiento de altas y anulaciones. Test/live y obligados distintos nunca comparten cabecera. Un despliegue o rotación del certificado no reinicia la cadena.

## Emisión, huella y consistencia

1. El usuario revisa el borrador y solicita emisión con clave de idempotencia y revisión esperada. El servidor calcula importes en decimal exacto, identifica ámbito y certificado utilizable y valida las condiciones fiscales. JavaScript Number no es la autoridad de los importes.
2. Una transacción bloquea borrador, serie y cabecera de cadena en orden fijo. Comprueba que no cambió la revisión; reserva número, congela snapshot y genera alta y outbox. El snapshot y el alta son simultáneos o anteriores a que el documento se considere expedido. No hay llamada de red dentro del bloqueo.
3. Se guardan la entrada exacta del hash y el XML versionado junto al registro. La misma transacción avanza cabecera, guarda el evento y confirma la emisión. Un rollback transaccional no deja una factura emitida sin alta ni una tarea sin registro. Una repetición devuelve el mismo documento; no consume otro número.
4. El PDF se produce exclusivamente desde el snapshot y sus activos congelados; generación recuperable e idempotente. Si falla el render, sigue existiendo la factura y se muestra «PDF pendiente», sin volver a emitir ni renumerar. Se archiva un artefacto definitivo con hash; los envíos y descargas posteriores usan ese artefacto.
5. La cola inicia la remisión inmediatamente tras el commit y la mantiene durante incidencias. Se separan estado documental, cobro/entrega al cliente y estado AEAT; un HTTP 200 no significa aceptación fiscal.

La huella usa SHA-256 sobre la concatenación de campos AEAT, no sobre el PDF, JSON serializado o XML completo. Alta: IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal, ImporteTotal, Huella anterior y FechaHoraHusoGenRegistro. Anulación usa los tres campos de factura anulada, Huella anterior y FechaHoraHusoGenRegistro. Se aplican orden y nombres oficiales, valores vacíos, recorte de extremos, UTF-8, representación numérica consistente con XML y salida hexadecimal mayúscula de 64 caracteres. El primer registro se identifica explícitamente y también tiene huella. [S5]

Se guardan los bytes calculados y el offset horario; no se recalcula el pasado con una configuración nueva. Tests con los vectores oficiales publicados, decimales, tildes, espacios, cambio de horario Madrid, primer registro, mezcla alta/anulación y concurrencia. Hash y encadenamiento detectan alteraciones; **no sustituyen controles contra un administrador con acceso total**. Copia externa inmutable, permisos separados y comprobación de integridad completan esa defensa.

## Remisión, respuestas y correcciones del registro

La pasarela usa SOAP/XML y autenticación mTLS con certificado del obligado o representación acreditada. Fase 0 debe descargar desde el portal oficial y fijar con SHA-256 el WSDL, XSD, validaciones y ejemplos exactos. En esta revisión se han leído la descripción de servicio 1.0.3 (28/7/2025), hash 0.1.2 y especificación QR; algunos enlaces antiguos de WSDL/errores devuelven páginas de redirección sin el contrato. Eso impide declarar validado el adaptador antes de resolverlos. No se inventan códigos a partir de proveedores terceros. [S6, S7]

| Resultado | Comportamiento propuesto |
|---|---|
| Correcto por línea | Guardar recepción y correlación; estado Aceptado |
| Aceptado con errores | Documento conservado, aviso y tarea de subsanación; no marcarlo como totalmente correcto |
| Rechazo de validación | Conservar intento y registro, explicar error; corrección explícita mediante nuevo registro conforme contrato |
| Timeout, desconexión o respuesta incompleta | Resultado desconocido; consulta/reintento del mismo registro e identidad, sin nueva factura |
| Duplicado | Conciliar identidad y contenido/consulta AEAT; no asumir que cualquier duplicado acredita nuestra versión |
| Lote con resultados distintos | Procesar cada línea; no elevar estado global del lote a todas las facturas |
| Certificado caducado/revocado o error de representación | Pausar ese destino, alertar al propietario; otros tenants siguen trabajando |

Inicialmente lotes pequeños, con una tarea activa por cadena y lease con token de comparación para descartar respuestas de trabajadores antiguos. Entrega al menos una vez; el efecto fiscal debe reconciliarse de forma idempotente. Respetar TiempoEsperaEnvio y límites del contrato; backoff con dispersión para transporte y alertas por edad/cantidad. El operador puede reintentar, consultar o preparar subsanación, nunca editar el XML emitido. Un registro posterior conserva como anterior el último generado según las reglas del contrato, no el último aceptado por conveniencia. La resolución de desconocidos es conservadora para no multiplicar documentos. [S6]

**Tres operaciones distintas:** rectificativa corrige la factura; subsanación corrige información remitida según el procedimiento; anulación registra un alta que no debía existir, con motivo y vínculo. Devolver mercancía o cancelar un pedido ya facturado no dispara automáticamente una anulación fiscal. `Subsanacion`, `RechazoPrevio` y `SinRegistroPrevio` se deciden mediante reglas versionadas y ejemplos oficiales, con pruebas de cada rama. Rechazo o anulación nunca habilitan eliminación ni reciclaje de número.

## Rectificativas completas en Facturación

| Código | Selección fiscal que debe quedar documentada |
|---|---|
| R1 | Error fundado en derecho y supuestos del art. 80.Uno, Dos y Seis LIVA |
| R2 | Concurso de acreedores, art. 80.Tres |
| R3 | Crédito incobrable, art. 80.Cuatro |
| R4 | Resto de causas, incluyendo correcciones no monetarias cuando proceda |
| R5 | Rectificación de facturas simplificadas |

Tipos del catálogo oficial L2 y modos S/I de L3. [S3] El asistente ofrece motivo y referencias; el tipo lo confirma el usuario y las causas sensibles R2/R3 requieren revisión del asesor. No asignar R4 a toda devolución por defecto.

Por **diferencias I** se documenta el incremento o reducción, positivo o negativo. Por **sustitución S** se presentan los importes correctos y los importes rectificados por separado; se propone la opción de un único documento con ambos bloques. Ejemplo propio de prueba: original base 100, IVA 21, total 121; corrección a base 80, IVA 16,80, total 96,80. I: base −20, IVA −4,20, total −24,20. S: base correcta 80 e IVA 16,80, base rectificada 100 y cuota rectificada 21. El impacto económico neto es −24,20, no +96,80 de venta adicional. [S11]

La interfaz permite rectificación parcial/total, varios originales del mismo obligado y rectificar una rectificativa; conserva enlaces, motivo, fechas y desglose. Se validan jurisdicción, moneda e impuestos y se evitan ciclos, cruces de clientes no justificados y doble devolución accidental. Correcciones de datos sin cambio de importe deben ser posibles: se elimina la regla actual que rechaza toda rectificativa de total cero. No se exige que todas las rectificativas sean negativas.

Serie propia y numeración transaccional. Original, rectificativas y versiones documentales permanecen consultables. Se separa «rectificada parcialmente/totalmente» del estado de cobro; no marcar el original íntegramente resuelto por la primera rectificativa parcial ni impedir una segunda corrección válida. Notas de crédito, saldos y pagos se concilian en un libro de movimientos, sin sobrescribir originales. Una rectificativa no genera un reembolso bancario o PayPal automático.

Nueva navegación: Tabs compartidas de @zenvia/ui para Facturas / Rectificativas / Borradores / Remisión; buscador y «Añadir filtro» compartidos y badges de documento/remisión separados. Acciones visibles por permiso y estado: editar/eliminar solo borrador; emitir, rectificar, consultar registro/AEAT, descargar PDF/XML y reintentar si procede. Antes de publicación: inventario de acciones, búsqueda/filtros y ancho de pestañas; capturas 390/1440 y 2560 si cambia ancho. Esta propuesta no modifica UI ni requiere capturas ficticias.

## Certificado de la sociedad: carga, custodia y rotación

El propietario **ya tiene** el certificado. No se le pide ni por chat ni por correo. El flujo futuro será Configuración → Facturación → Certificado, solo propietario autorizado, con verificación reforzada disponible sin ampliar el piloto MFA a otros usuarios.

1. El backend autoriza una sesión de carga de un solo uso y duración corta, ligada a owner, obligado, ambiente y custodio. Formulario sin analítica de contenido, sin URL con secretos y sin persistencia en navegador.
2. El propietario selecciona el P12/PFX y escribe su contraseña en ese formulario. Se transmiten solo al servicio aislado por TLS; no pasan por logs de Edge, tablas públicas, repositorio ni trazas de errores. El frontend no recupera después el P12, contraseña o clave privada.
3. El custodio verifica cadena, vigencia, usos, correspondencia de clave y representación del obligado. Un certificado de representante puede identificar también a una persona: no basta comparar a ciegas el NIF del subject. Comprueba autorización de representación y capacidad en pruebas AEAT. Se muestran solo razón/NIF autorizados, emisor, fingerprint, fechas y resultado saneado.
4. Clave/P12 cifrados con DEK propia y cifrado de envoltura KMS, contexto owner+obligado+versión. Identidad de runtime mínima para descifrar; la aplicación conserva solo referencia opaca. Vault puede guardar referencias/credenciales de servicio, no es por sí solo un HSM ni evita que un rol autorizado pueda descifrar.
5. La clave importada puede estar en memoria del proceso para mTLS: se minimiza su vida y se desactiva volcado/log de cuerpos. No prometer «no exportable» por cifrar un P12; un HSM necesitaría compatibilidad real y validación adicional. Operación aislada con salida solo a endpoints AEAT permitidos, sin función de firma arbitraria accesible al cliente.
6. Rotación por nueva versión: validar y probar, activar atómicamente para nuevos intentos y cerrar leases antiguos de forma segura. No cambiar huellas ni cadena. Conservar metadatos y política de destrucción de claves antiguas; la lectura/exportación de facturas no depende de conservar una clave de transporte caducada. Alertas propuestas a 60/30/7 días, con responsable y registro de revocación inmediata.

La pasarela vuelve a comprobar que el obligado de la tarea corresponde al certificado, aunque la petición venga autenticada del worker. Una URL suministrada por el navegador nunca decide el destino mTLS. Test y live usan permisos y endpoints distintos; el botón de «probar conexión» nunca crea una factura real. El proveedor KMS/compute, región, presupuesto, contrato y procedimiento de recuperación son decisiones de infraestructura pendientes de aprobación, antes de contratar o desplegar.

## Conservación, inmutabilidad y recuperación

La protección reside en DB, no solo en ocultar botones: triggers y privilegios impiden UPDATE/DELETE del núcleo fiscal, sus líneas/snapshots y artefactos emitidos, incluso mediante RPC antigua o cascada. El estado comercial/cobros vive fuera del snapshot fiscal. Mantenimiento y demo reset no poseen bypass para registros reales. Las mutaciones válidas son nuevos registros y eventos, con funciones pequeñas y auditadas.

Guardar XML original, snapshot, PDF definitivo, hashes, solicitudes/respuestas y exportación legible por obligado/rango. Bucket privado, URLs temporales y autorización en cada descarga. Copias cifradas y copia externa con retención inmutable y roles separados; ensayar restauración y comprobación de cadena. No declarar una copia en el mismo proyecto suficiente contra una cuenta administradora comprometida.

El plazo se define en una matriz fiscal/mercantil/OSS y litigios con el asesor; no reutilizar la retención de 365 días del DNI y firma logística. El borrado de PII operativa de Amazon no debe arrastrar documentos fiscales cuya conservación esté legalmente justificada; separar dato fiscal imprescindible de payloads operativos. No se fija aquí una purga automática general a cuatro años. Hasta aprobar la matriz se conserva el archivo fiscal sin una regla automática de destrucción.

El rollback técnico puede pausar nuevas emisiones y workers, manteniendo lectura/exportación y cola pendiente; **no** borra registros remitidos, retrocede la cabecera, reutiliza números ni restaura un frontend que permita modificar emitidas. Tras la primera remisión real, los cambios fiscales requieren reparación hacia delante. Simular restauración con respuesta desconocida para impedir dobles envíos o cadenas bifurcadas.

## Transición y relación con la hoja de ruta

Las 28 facturas emitidas/cobradas observadas se inventarían y archivarían como legado con su representación y procedencia. No se falsifican fechas de creación de registros, no se incluyen retrospectivamente en una cadena nueva ni se envían en bloque sin criterio del asesor y autorización con SQL exacto/recuento. El borrador se valida con las reglas nuevas cuando se emita. Si un documento histórico necesita corrección, se conserva el original y se genera la operación fiscal que corresponda.

Shopify automática queda **después del núcleo**: Manual/Automática + prueba que solo genera borradores; evento configurable etiqueta/salida, idempotencia por owner/cuenta/pedido, serie propia, bloqueo a borrador si no cuadran totales y cancelaciones/devoluciones a rectificativa en borrador. La presencia de NIF/empresa propone completa, pero la simplificada exige validar límites y supuestos legales; no se usa como fallback universal si faltan datos. OSS se decide por operación y configuración fiscal; AEAT identifica clave de régimen 17 cuando corresponde. [S12]

Entrega futura por ambas vías: metafield de Shopify con enlace seguro y botón «Descargar factura» en confirmación de envío, y Gmail con marca/PDF definitivo. El enlace no contiene una URL pública permanente del bucket ni datos fiscales y debe permitir resolver acceso/consentimiento. Ambos canales guardan su estado e idempotencia por separado; fallo de Gmail no crea otra factura ni duplica correo al reintentar el metafield. Ninguna de estas entregas se activa en este diseño.

Presupuestos y albaranes quedan después: no fiscales, series y estados propios y conversión idempotente con procedencia. Convertir en factura crea un borrador del núcleo; expedir siempre pasa por sus validaciones. No genera registro AEAT por crear un presupuesto o albarán.

## Plan por fases, estimación y aceptación

Estimación de ingeniería, un ingeniero senior, excluye esperas del asesor, propietario y proveedor; no constituye compromiso de fecha ni suma trabajo paralelo ficticio.

| Fase | Entregable revisable | Estimación |
|---|---|---|
| 0 | Dictamen de ámbito/SII, inventario activo, contratos AEAT fijados, series/impuestos y matriz de conservación; decisión de custodio | 1–2 días |
| 1 | Núcleo transaccional, cierre de mutabilidad, numeración/idempotencia, snapshots y cadena alta/anulación; sin conexión live | 4–6 días |
| 2 | R1–R5, S/I, parcial/total, múltiples/sucesivas, saldo y PDF/QR archivados | 4–6 días |
| 3 | Carga/rotación segura, adaptador SOAP, outbox, respuesta por línea, desconocidos, reintentos y subsanaciones en pruebas externas | 4–6 días |
| 4 | Exportación/conservación, recuperación, auditoría, declaración por versión y documentación de operación | 2–3 días |
| 5 | Ensayo integral sintético, revisión fiscal, capturas y aprobación de corte; piloto real solo tras autorización explícita separada | 2–3 días |

Total propuesto **17–26 días laborables**, más reserva de integración y esperas. No se acorta el cumplimiento comercial del fabricante por el calendario del usuario. Puede adelantarse auditoría del núcleo mientras se revisa infraestructura; Shopify y documentos no fiscales no están incluidos en esa cifra.

Pruebas de aceptación: vectores de hash AEAT y XML/XSD, 20 solicitudes de emisión simultáneas/idempotentes, rollback de transacción, paralelismo de series en la misma cadena, caída tras envío antes de recepción, duplicado con contenido diferente, lote mixto, certificado equivocado/caducado/revocado, cross-tenant, bypass directo/antiguo/mantenimiento, PDF idéntico tras cambiar logo o datos de empresa, rectificación parcial repetida, S sin doble contabilización, R4 no monetaria cero, rectificativa de rectificativa y restauración sin bifurcar cadena. Ninguna prueba emite documentos fiscales reales ni envía correos reales.

PDF: QR de 30–40 mm, propuesta 35 mm en posición inicial visible y zona libre ≥2 mm; destino y parámetros oficiales por ambiente, leyenda VERI*FACTU legible. Decodificación automática del QR en render a escala real y revisión humana. Borrador marcado inequívocamente sin QR fiscal que aparente emisión. [S7]

Para cerrar producción: asesor aprueba supuestos y ejemplos; pruebas externas completadas; informe de aislamiento y restauración; declaración responsable firmada por productor por versión con identidad, composición, funcionalidades y datos de instalación; disponible en producto y archivada con historial. No se anuncia «homologado por AEAT» por superar pruebas o emitir la declaración. La propuesta incluye la ficha del producto, binarios/commit y dependencias que respaldan cada declaración. [S2, S14]

Riesgos materiales: clasificación fiscal y OSS, fallos de representación, contrato AEAT cambiante, compromiso de administrador/certificado, concurrencia, red/duplicados, legado sin PDF congelado y cálculo de saldo por sustitución. Cada uno tiene puerta de aceptación anterior; si falla ámbito, custodia o integridad, se bloquea la activación de ese obligado. Queda prohibido afirmar cumplimiento integral con la sola implementación del hash y QR.

## Decisiones para revisión del propietario

Se propone aprobar el alcance exclusivamente VERI*FACTU, la pasarela aislada con KMS y las fases 0–5; el asesor confirma ámbito/SII, series, fiscalidad y conservación. La aprobación de este diseño no autoriza contratar infraestructura, subir el certificado por chat, emitir facturas reales ni enviar registros a producción. Tras revisión se prepara el plan de implementación y su primer corte concreto.

**Punto de parada: este documento. No hay migraciones, handlers, credenciales o UI fiscal implementados.**

## Fuentes primarias consultadas el 23/10/2026

- S1: [RDL 15/2025, disposición final primera](https://www.boe.es/buscar/doc.php?id=BOE-A-2025-24446).
- S2: [RD 1007/2023 consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840), arts. 3, 8–16.
- S3: [Orden HAC/1177/2024](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138), catálogos L2/L3 y reglas técnicas.
- S4: [RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696), factura, rectificación y conservación; validar redacción efectiva al implementar.
- S5: [AEAT: hash 0.1.2](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf).
- S6: [AEAT: servicio 1.0.3](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf).
- S7: [AEAT: QR](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf).
- S8: [AEAT: registro de eventos](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/caracteristicas-requisitos-sif-registro-eventos_.html).
- S9: [AEAT: firma](https://www3.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/firma.html).
- S10: [AEAT: SII y certificación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html?faqId=286077fe52572910VgnVCM100000dc381e0aRCRD).
- S11: [AEAT: procedimientos y rectificativas](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html).
- S12: [AEAT: altas y régimen OSS](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/registros-facturacion-alta.html).
- S13: [AEAT: aclaraciones para desarrolladores, 4/12/2025](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf). El manual IVA 2025 aún muestra anteriores fechas de usuarios; se utiliza S1 para el calendario vigente.
- S14: [AEAT: ejemplos de declaración responsable 0.5.1](https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf).
- Contratos por fijar en fase 0: [portal oficial técnico, WSDL, XSD y validaciones](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html).
