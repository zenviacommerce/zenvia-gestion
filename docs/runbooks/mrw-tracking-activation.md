# Activación del seguimiento MRW por cuenta

## Contrato y configuración segura

TrackingService utiliza el mismo usuario y contraseña SAGEC de la cuenta MRW directo. La consulta histórica documentada en `20261022-mrw-readonly-review.md` apuntaba a otro servicio; su denegación no demuestra falta de acceso a TrackingService. No se requiere contraseña separada ni solicitar un alta basándose en aquella prueba.

1. En **Configuración → Integraciones**, abrir **Configurar** en la cuenta MRW directo existente.
2. Guardar el usuario y contraseña SAGEC por los campos seguros existentes. Dejar un campo vacío conserva el valor guardado. No crear otra cuenta para las mismas expediciones ni compartir secretos por chat.
3. **Probar SAGEC** comprueba la conexión de etiquetas; **Probar seguimiento** consulta TrackingService con las mismas credenciales guardadas y una expedición propia.

Los antiguos campos `trackingPassword` y `tracking_password` no participan en TrackingService. Sin usuario o contraseña SAGEC completos no se hace una petición al proveedor. El código `MRW_CREDENTIALS_REQUIRED` informa de la pareja SAGEC incompleta; la interfaz sigue interpretando el código histórico `MRW_TRACKING_PASSWORD_REQUIRED`.

Guardar explícitamente usuario o contraseña SAGEC, con la pareja completa ya fusionada y persistida en Vault, libera las pausas recuperables `MRW_CREDENTIALS_REQUIRED`, `MRW_TRACKING_PASSWORD_REQUIRED`, `MRW_TRACKING_ACCESS_DENIED` y `MRW_CREDENTIALS_REJECTED` de esa cuenta. Adelanta el siguiente intento de sus envíos activos afectados; no cambia terminales, otras cuentas, límites de frecuencia ni otras pausas. Cambiar esas credenciales invalida la prueba de conexión anterior. Guardar únicamente un antiguo campo de seguimiento no despierta la cuenta.

Los envíos MRW gestionados por Sendcloud conservan su adaptador y cuenta Sendcloud. No reutilizar credenciales de una plataforma intermediaria para MRW directo.

## Prueba de seguimiento, solo lectura

`integration-accounts`, acción `test_tracking`, exige la autenticación administrativa y MFA existentes. El cliente envía únicamente el identificador de cuenta; no aporta contraseña ni número de expedición. El servidor verifica la propiedad de la cuenta antes de leer Vault y selecciona una expedición propia no purgada, `shipping_provider=mrw`, enlazada a esa cuenta.

La respuesta contiene únicamente `ok`, un código fijo y `checkedAt`. Nunca contiene credenciales, números de expedición, XML, mensajes originales del proveedor ni movimientos. No escribe estados de pedido, eventos, salud de cuenta, ni el resultado SAGEC. Si aún no existe expedición propia, explica el paso pendiente; la creación de etiquetas sigue disponible con SAGEC.

El modo del worker se controla por la configuración de seguimiento vigente. Una denegación produce `MRW_TRACKING_ACCESS_DENIED`, ninguna observación normalizada y una pausa de seis horas.

## Pedidos sin seguimiento

Solo para MRW directo: si hay número pero no observación normalizada, Pedidos y el detalle muestran **Sin seguimiento disponible**. `SHIPPED` heredado de la etiqueta no demuestra movimiento. Si existe una observación normalizada válida, se conserva su estado y fecha; un error posterior añade **Seguimiento automático no disponible · último estado conocido**.

El detalle ofrece **Consultar manualmente en MRW**: enlace registrado o `https://www.mrw.es/seguimiento/`. El usuario introduce el número del pedido. El enlace no consulta ni copia datos automáticamente. Sendcloud conserva su adaptador.

**La extracción automática de la web pública queda descartada sin autorización expresa de MRW.** No se implementa scraping ni respaldo automático desde esa web.

La validación de este cambio usa cuentas y expediciones sintéticas. No contiene credenciales reales ni acredita por sí sola el acceso de una cuenta en producción.
