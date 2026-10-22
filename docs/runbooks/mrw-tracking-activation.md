# Activación del seguimiento MRW por cuenta

## Contrato confirmado y alcance

El propietario ha confirmado a partir del dosier MRW 2.3 que el seguimiento requiere una **contraseña independiente**, facilitada por la franquicia, y el alta del Web Service mediante la **opción 4**. La solicitud prevista corresponde a la franquicia **01009**, abonado **011125**. No se solicita ninguna contraseña por chat ni se deben copiar credenciales al repositorio, documentación, capturas o logs.

`SAGEC01009SC` es específico de Sendcloud. Los envíos MRW gestionados por Sendcloud reciben sus estados mediante la plataforma Sendcloud: no deben utilizar la cuenta ni la contraseña de seguimiento MRW directo.

Servicio directo: **SeguimientoNumeroEnvioMRWNacional**, `https://seguimiento.mrw.es/swc/wssgmntnvs.asmx`. La prueba histórica de tres expediciones, realizada con la combinación SAGEC almacenada, respondió HTTP 200, `Estado=false`, «Error de acceso al seguimiento de envíos.». Ese resultado queda documentado como diagnóstico histórico; no autoriza reutilizar SAGEC tras confirmarse el contrato independiente.

## Configuración segura cuando MRW habilite el acceso

1. Solicitar a la franquicia el alta del Web Service de seguimiento (opción 4) y la contraseña independiente por su canal seguro. No compartirla por chat.
2. En **Configuración → Integraciones**, abrir **Configurar** en la cuenta MRW directo existente.
3. Introducir la contraseña en **Contraseña de seguimiento**. Se guarda como `trackingPassword` en el secreto cifrado de Vault de esa cuenta; `password` sigue siendo la contraseña SAGEC. No crear una segunda cuenta para las mismas expediciones. Al editar, dejar el campo vacío conserva la contraseña de seguimiento almacenada. Cambiar solo esta contraseña mantiene el estado de conexión y el error SAGEC existentes; no requiere revalidar la conexión de etiquetas.
4. Guardar. **Probar SAGEC** valida únicamente la conexión para crear envíos y etiquetas. **Probar seguimiento** comprueba el servicio independiente con una expedición real de esa cuenta.

El backend admite `tracking_password` como alias. No utiliza `password` de SAGEC como respaldo, ni una variable global `MRW_TRACKING_PASSWORD`. Sin contraseña de seguimiento no envía ninguna solicitud a MRW: devuelve `MRW_TRACKING_PASSWORD_REQUIRED`, no crea observaciones y pausa esa cuenta durante seis horas.

Guardar una contraseña de seguimiento no vacía libera únicamente las pausas recuperables `MRW_TRACKING_PASSWORD_REQUIRED`/`MRW_TRACKING_ACCESS_DENIED` de esa cuenta y adelanta el próximo intento de sus envíos activos afectados. No altera terminales, otras cuentas ni pausas por otras causas. El cron existente ejecuta el worker cada cinco minutos; la cola y los leases pueden retrasar el primer intento.

## Prueba de seguimiento, solo lectura

`integration-accounts`, acción `test_tracking`, exige la autenticación administrativa y MFA existentes. El cliente envía únicamente el identificador de cuenta; no aporta contraseña ni número de expedición. El servidor verifica la propiedad de la cuenta antes de leer Vault y selecciona una expedición propia no purgada, `shipping_provider=mrw`, enlazada a esa cuenta.

La respuesta contiene únicamente `ok`, un código fijo y `checkedAt`. Nunca contiene credenciales, números de expedición, XML, mensajes originales del proveedor ni movimientos. No escribe estados de pedido, eventos, salud de cuenta, ni el resultado SAGEC. Si aún no existe expedición propia, explica el paso pendiente; la creación de etiquetas sigue disponible con SAGEC.

El worker permanece en **shadow** y guarda observaciones sin cambiar estados operativos. Una denegación produce `MRW_TRACKING_ACCESS_DENIED`, ninguna observación normalizada y una pausa de seis horas.

## Pedidos sin seguimiento

Solo para MRW directo: si hay número pero no observación normalizada, Pedidos y el detalle muestran **Sin seguimiento disponible**. `SHIPPED` heredado de la etiqueta no demuestra movimiento. Si existe una observación normalizada válida, se conserva su estado y fecha; un error posterior añade **Seguimiento automático no disponible · último estado conocido**.

El detalle ofrece **Consultar manualmente en MRW**: enlace registrado o `https://www.mrw.es/seguimiento/`. El usuario introduce el número del pedido. El enlace no consulta ni copia datos automáticamente. Sendcloud conserva su adaptador.

**La extracción automática de la web pública queda descartada sin autorización expresa de MRW.** No se implementa scraping ni respaldo automático desde esa web.

Interfaz y backend preparados en código, **sin publicar ni desplegar** desde esta tarea. No se aplican migraciones; cualquier publicación de interfaz requiere la aprobación pendiente del propietario.

## Borrador para el propietario — solicitud a la franquicia

Asunto: Alta del Web Service de seguimiento — franquicia 01009, abonado 011125

Buenos días:

Solicitamos el alta del Web Service de seguimiento (opción 4 del dosier MRW 2.3) para la franquicia 01009, abonado 011125, y la contraseña independiente de seguimiento por vuestro canal seguro.

Queremos utilizar `SeguimientoNumeroEnvioMRWNacional` en `https://seguimiento.mrw.es/swc/wssgmntnvs.asmx`. Por favor, confirmad los valores que corresponden a `Franquicia` y `Cliente`, y el canal seguro para facilitar `Password` de seguimiento. No enviéis la contraseña en esta conversación.

La prueba histórica con la combinación SAGEC respondió HTTP 200 con `Estado=false` y «Error de acceso al seguimiento de envíos.». Mantendremos separadas las credenciales de etiquetas SAGEC y las de seguimiento.

Gracias.

## Validación visual previa

Las capturas sintéticas del estado sin seguimiento están en `docs/deploy/20261022-mrw-unavailable-review/mrw-unavailable-{light,dark}-{390,1280,1440}.png`. El modo opcional `TRACKING_MRW_UNAVAILABLE=1 node scripts/shipment-tracking-screenshots.mjs` conserva los siete estados predeterminados y comprueba el texto y el enlace manual sin consultar MRW.

## Verificación de la preparación por cuenta

- `npm test`: 75 archivos, 367 pruebas correctas, incluidas 11 del probe y 4 del campo/acción de seguimiento.
- Adaptadores, worker y enlaces: 24 pruebas correctas con `node --test scripts/shipment-tracking-adapters.test.mjs scripts/shipment-tracking-worker.test.mjs scripts/shipped-order-cost-tracking.test.mjs`.
- `npm run build`: correcto; permanece el aviso previo del tamaño de bundle. El bundle de `integration-accounts` también se ha compilado en memoria para verificar sus imports y sintaxis.
- Pruebas sintéticas: no se han leído secretos reales ni consultado MRW. La validación real de la nueva contraseña queda pendiente de su alta y guardado seguros.
