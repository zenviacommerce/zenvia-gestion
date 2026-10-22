# Activación del seguimiento MRW

El servicio de seguimiento es **SeguimientoNumeroEnvioMRWNacional** (`https://seguimiento.mrw.es/swc/wssgmntnvs.asmx`). La prueba autorizada de tres envíos MRW directos devolvió HTTP 200 con `Estado=false` y el mensaje «Error de acceso al seguimiento de envíos.» usando la combinación almacenada de franquicia, abonado y contraseña SAGEC. Esto acredita un rechazo de esa combinación en ese endpoint; no demuestra que todas las contraseñas SAGEC sean incompatibles. No solicites otra contraseña sin confirmar antes con MRW los permisos y el contrato de acceso. El campo de seguimiento permite un override opcional si MRW proporciona uno.

## Dónde introducirla

1. En Zenvia Gestión, entra con la cuenta propietaria/administradora y completa MFA.
2. Abre **Configuración → Integraciones** y localiza la cuenta **MRW** existente que utiliza los envíos.
3. Pulsa **Configurar** en esa cuenta. No crees una segunda cuenta MRW para los mismos envíos.
4. Si MRW proporciona una contraseña específica para seguimiento, introdúcela en **Nueva contraseña de seguimiento (opcional)**. Deja vacíos los demás campos de credenciales para conservarlos; no reemplaces **Nueva contraseña** (SAGEC).
5. Pulsa **Guardar cuenta**. El formulario envía `credentials.trackingPassword` exclusivamente al backend autenticado de `integration-accounts`; este combina los campos no vacíos con las credenciales existentes y guarda el JSON en Supabase Vault. La interfaz no recupera el secreto almacenado.

El backend acepta también `tracking_password` para compatibilidad. No existe una variable `MRW_TRACKING_PASSWORD` configurada para este worker: añadir un secreto de Edge con ese nombre no activa esta cuenta. La ruta soportada es la cuenta MRW y su secreto de Vault, a través del formulario.

## Qué ocurre al guardar

Una vez desplegado el cambio de `integration-accounts` que acompaña a este documento, guardar una contraseña de seguimiento no vacía libera únicamente las pausas `MRW_TRACKING_PASSWORD_REQUIRED` o `MRW_TRACKING_ACCESS_DENIED` de esa cuenta, y adelanta el próximo intento de sus envíos activos que quedaron pendientes por esa falta de contraseña o denegación de acceso. Los envíos entregados, devueltos, cancelados, otras cuentas y las pausas genéricas `MRW_CREDENTIALS_REJECTED` o por límites del proveedor conservan su estado. Cambiar solo las credenciales SAGEC o dejar vacío el campo de seguimiento no libera la denegación de acceso.

El cron de seguimiento existente ejecuta el worker cada cinco minutos. Por tanto, el primer intento normalmente llegará en la siguiente ejecución, sujeto a la cola y los leases. **Probar** en la cuenta MRW valida la conexión SAGEC y no acredita que el servicio de seguimiento acepte su contraseña.

El modo **shadow** sigue guardando observaciones en `shipment_tracking_state`; no habilita por sí solo escrituras de estados operativos ni cambia el modo aprobado. El worker utiliza `trackingPassword` (o `tracking_password`) si existe y, en su ausencia, la contraseña SAGEC almacenada (`password`). Solo si faltan ambas devuelve `MRW_TRACKING_PASSWORD_REQUIRED` sin llamar al proveedor. Una respuesta exterior `Estado=false` produce `MRW_TRACKING_ACCESS_DENIED`, ninguna observación normalizada y una pausa de seis horas para esa cuenta.

Si el cambio de backend aún no está desplegado, el formulario ya guarda el secreto de forma segura, pero la pausa previa puede durar hasta seis horas antes de reintentarse. No es necesario editar SQL ni revelar la contraseña para eliminarla; despliega el backend actualizado y vuelve a guardar el campo.

## Comprobación administrativa sin leer secretos

Comprueba únicamente `last_success_at`, `last_error` y `paused_until` de `shipment_tracking_account_health`, y el resultado del worker en `shipment_tracking_runs`. Una observación con `last_checked_at` nuevo verifica que hubo intento; `last_success_at` nuevo sin error verifica respuesta válida del proveedor. No abras `vault.decrypted_secrets`, no pegues la contraseña en SQL, terminal, chat o tickets, ni registres el cuerpo SOAP.
