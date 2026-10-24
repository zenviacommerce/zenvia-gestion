# Plan de alta por el propietario — Google Cloud Bélgica

Decisión recibida el 23/10/2026: Google Cloud, europe-west1 (Bélgica), Cloud Run con escalado a cero y clave privada no exportable. **Documento preparatorio: no ejecutar el alta todavía.** Primero aceptación de #299 en navegador real y cierre de fase 0. No se han creado proyectos, cuentas, claves, secretos ni certificados.

## Qué significa la custodia elegida

Objetivo: clave asimétrica de autenticación mTLS dentro de **Cloud KMS con nivel HSM multi-tenant**; la operación de firma ocurre allí y Cloud Run obtiene el resultado, no la clave. El certificado público y su cadena son artefactos separados. Una clave AES de KMS que descifra un PFX guardado en Secret Manager NO cumple este objetivo: la clave privada del PFX acabaría en memoria del contenedor. No se usará esa sustitución sin otra decisión explícita.

Hay dos rutas técnicas futuras: generar la clave dentro del HSM y obtener un certificado correspondiente mediante CSR, o importar de forma envuelta la clave del certificado existente si su formato, tamaño y algoritmo son compatibles. En el segundo caso, la no exportabilidad se refiere a Google Cloud tras la importación; no elimina las copias originales existentes fuera de Google. No solicitar PFX, contraseña o clave por chat. La importación es un paso posterior y separado, ejecutado con un procedimiento controlado por el propietario.

Pendiente de prueba antes de elegir algoritmo definitivo: un cliente TLS que use firma remota, por ejemplo Go crypto.Signer o OpenSSL/PKCS#11 con libkmsp11. Las combinaciones RSA-PSS/PKCS#1, digest y TLS deben concordar con el certificado, Cloud KMS y AEAT; no basta que exista una operación genérica Sign. El adaptador se prueba primero con certificados sintéticos y servidor TLS local. La documentación de integración no acredita por sí sola compatibilidad real con AEAT.

## Secuencia de consola para el propietario, cuando se autorice el alta

1. Entrar personalmente en console.cloud.google.com con su cuenta habitual protegida por MFA. Mantener bajo su control la cuenta de facturación y la administración IAM. No proporcionar credenciales a ChatGPT.
2. Selector de proyecto → Nuevo proyecto. Proponer dos proyectos independientes: `zenvia-vf-test-SUFIJO` y `zenvia-vf-prod-SUFIJO` (IDs propuestos, no reservados). Para custodia se recomienda un tercer proyecto `zenvia-vf-keys-SUFIJO`, administrado por el propietario; anillos y permisos test/prod separados. La región se elige en cada recurso, no en el proyecto. Registrar ID y número de cada proyecto.
3. Facturación → vincular su cuenta de facturación. Facturación → Presupuestos y alertas → Crear presupuesto: mensual fijo de **25 EUR**, si la moneda de su cuenta es EUR, con alcance que sume los proyectos de esta pasarela. Alertas al 50%, 80% y 100% del gasto real y aviso de previsión al 100%. Destinatario: propietario. No crear un presupuesto de 25 EUR en cada proyecto si el objetivo es 25 EUR total. Si la cuenta usa otra moneda, mostrar el equivalente y pedir al propietario que lo fije.
4. Un presupuesto de alertas avisa y **no es un techo automático**. Los spend caps nuevos están limitados a servicios/casos compatibles y pueden superar el umbral por retraso de contabilización. No configurar un corte automático de facturación que pueda interrumpir registros fiscales; alertar y pausar de forma controlada la generación/envío según el futuro procedimiento de operación.
5. APIs y servicios → Biblioteca. En proyectos de aplicación: Cloud Run, Artifact Registry, IAM, IAM Service Account Credentials, Security Token Service y Secret Manager si hay secretos auxiliares. En custodia: Cloud KMS. Activar Cloud Scheduler solo si se adopta el disparador privado descrito más abajo. Logging/Monitoring para auditoría; no habilitar GKE, VM o HSM dedicado por comodidad.
6. Artifact Registry → Crear repositorio Docker, región **europe-west1**, nombre `verifactu`. El contenedor se construirá en GitHub Actions y se subirá con identidad federada; así no se requieren claves JSON descargadas ni Cloud Build como identidad adicional.
7. IAM y administración → Cuentas de servicio. Crear identidades propias por ambiente: `vf-deploy`, `vf-runtime` y, cuando corresponda, `vf-invoke`. No crear claves en la pestaña Claves. No usar la cuenta de Compute por defecto con Editor. El propietario concede las vinculaciones de la matriz inferior sobre recursos concretos.
8. Seguridad → Key Management → crear anillo en **europe-west1** dentro del proyecto de custodia, separado por ambiente. Elegir **HSM multi-tenant**, no Single-tenant Cloud HSM. Al crear la clave, propósito **firma asimétrica**; algoritmo pendiente del análisis técnico anterior. Para el certificado existente, preparar una clave de importación sin generar un par que no coincida con ese certificado, siguiendo el flujo oficial. Detenerse antes de importar material o generar una CSR real. No activar una rotación automática que cambie la clave pública sin renovar el certificado correspondiente.
9. Secret Manager, solo si aplica: secretos auxiliares con residencia Bélgica y permiso Accessor únicamente para runtime. La clave mTLS no va aquí. Se puede usar un secreto regional leído explícitamente mediante la API regional desde el contenedor; el montaje automático de secretos regionales de Cloud Run no está soportado en la documentación consultada. Alternativa a revisar: secreto global con réplica administrada por usuario exclusivamente en Bélgica. No pegar valores secretos hasta disponer del flujo aprobado.
10. Cloud Run → desplegar contenedor **ya revisado** desde Artifact Registry por digest. Región europe-west1; autenticación obligatoria, sin allUsers; identidad vf-runtime. Propuesta inicial: CPU 1, memoria 512 MiB, facturación por solicitud, mínimo 0, máximo 2 instancias y concurrencia 1. Son parámetros propuestos para validar, no un SLA ni un límite duro de gasto. No desplegar un Hello World público como atajo ni activar todavía la comunicación AEAT.
11. Observabilidad → alertas de errores, antigüedad de cola y vencimiento de certificado; logs estructurados sin cuerpos SOAP, PFX, contraseña o datos fiscales de clientes. Elegir ubicación/retención de los buckets de logs y archivo; no asumir que todos los servicios de control IAM son regionales por elegir Bélgica en Cloud Run.

## Permisos propuestos

| Identidad | Permiso y ámbito |
|---|---|
| Propietario | Facturación, alta inicial, políticas IAM y administración de claves; conserva aprobación de producción |
| GitHub federado | `roles/iam.workloadIdentityUser` solo sobre vf-deploy del ambiente autorizado |
| vf-deploy | `roles/run.developer` sobre el servicio ya creado; `roles/artifactregistry.writer` sobre su repositorio; `roles/iam.serviceAccountUser` solo sobre vf-runtime. Creación inicial del servicio a cargo del propietario para evitar permiso permanente de creación en todo el proyecto |
| vf-runtime | `roles/cloudkms.signer` + `roles/cloudkms.publicKeyViewer` sobre la clave concreta; `roles/secretmanager.secretAccessor` únicamente sobre los secretos auxiliares necesarios. PKCS#11 puede requerir descubrimiento adicional: comprobar permisos reales y ampliar solo lo demostrado |
| vf-invoke | `roles/run.invoker` solo sobre su servicio; no firmante ni acceso a secretos |

El despliegue de código permite usar indirectamente los permisos del runtime. No se debe presentar vf-deploy como incapaz de firmar por carecer de un rol directo KMS: el código desplegado podría hacerlo. Por ello las revisiones aprobadas y la autorización del propietario para producción son parte del control de custodia. Los roles de service agent son para las identidades administradas de Google, no para estas cuentas.

## Federación GitHub → Google, sin claves descargadas

En IAM y administración → Workload Identity Federation → crear pool y proveedor OIDC. El control de identidad usa ubicación global; los datos/clave se ubican en Bélgica. Emisor: `https://token.actions.githubusercontent.com` y audiencia predeterminada del proveedor. Mapear google.subject a assertion.sub y atributos repository_id, repository_owner_id y ref a sus claims equivalentes.

Identidades verificadas del repo actual: repository_id **1363689692**, repository_owner_id **327381639**, `zenviacommerce/zenvia-gestion`. Condición propuesta de producción:

```text
assertion.repository_owner_id == '327381639' &&
assertion.repository_id == '1363689692' &&
assertion.ref == 'refs/heads/main' &&
assertion.sub == 'repo:zenviacommerce/zenvia-gestion:environment:verifactu-production'
```

Restringir también el workflow de despliegue revisado con claims disponibles y verificar el subject efectivo antes de activar permisos. Conceder Workload Identity User sobre vf-deploy solo al principalSet de ese repository_id, no a todo el pool. Para otro repositorio futuro, volver a verificar sus IDs; no reutilizar esta condición.

En GitHub → Settings → Environments, preparar `verifactu-production` con aprobación del propietario si su plan lo permite. Si no, definir una alternativa de aprobación manual equivalente antes de habilitar producción. Pipeline con permisos contents:read e id-token:write, acción oficial google-github-actions/auth fijada por commit revisado y uso de vf-deploy. Test y producción con proveedores/identidades separados. No habilitar despliegue de PRs no confiables contra las identidades productivas.

La federación de despliegue no resuelve por sí sola la autenticación del worker Supabase contra Cloud Run privado. Opción propuesta para validar después: Cloud Scheduler con OIDC de vf-invoke despierta la pasarela, que consume una outbox acotada mediante credencial de integración con mínimos permisos (guardada en Secret Manager). No copiar la service_role completa a Google ni abrir Cloud Run al público para salvar esta diferencia. La definición de ese acceso/outbox pertenece a la fase de integración y debe cerrarse antes de activar envíos.

## Cómo colaborar sin compartir contraseñas

Yo preparo código, IaC y PRs en el repositorio; el propietario revisa y ejecuta el workflow autorizado. **No existe un correo personal de ChatGPT al que conceder IAM.** El acceso automático lo recibe la identidad GitHub federada, con credenciales temporales, no una contraseña o clave JSON enviada por chat. Si un técnico humano necesita entrar en consola, el propietario le concede acceso temporal a su cuenta Google identificada; no compartir la cuenta del propietario ni dar Owner/Editor por defecto.

Se pueden comunicar para configurar el código: IDs/números de proyectos, nombre del proveedor WIF, emails de cuentas de servicio, rutas de clave/anillo y URL del servicio. Esos identificadores no sustituyen la autenticación. No enviar tokens, PFX, claves privadas, archivos JSON de credenciales ni contraseñas. Ahora no se necesita ninguno de ellos: este es un plan previo al alta.

## Presupuesto y parada

El rango previo de 5–20 EUR/mes era orientativo para escalado a cero. Con HSM, dos ambientes y logs/archivo se reserva **10–25 EUR/mes** de presupuesto inicial, a recalcular con algoritmo/versiones y consumo reales; 25 EUR es alerta, no garantía. Tarifa pública consultada: versión RSA-2048 HSM aproximadamente 1 USD/mes; RSA-3072/4096 o EC, aproximadamente 2,50 USD/mes en el primer tramo, más operaciones. Dos versiones/ambientes duplican esa parte; versiones deshabilitadas también pueden seguir facturando. No seleccionar HSM single-tenant, cuyo coste dedicado queda fuera de este presupuesto. No hay contratación ni recursos creados.

Fuentes oficiales consultadas 23/10/2026: [presupuestos](https://docs.cloud.google.com/billing/docs/how-to/budgets), [WIF GitHub](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [roles Cloud Run](https://docs.cloud.google.com/run/docs/reference/iam/roles), [ubicaciones KMS/HSM](https://docs.cloud.google.com/kms/docs/locations), [importación](https://docs.cloud.google.com/kms/docs/key-import), [material no exportable](https://docs.cloud.google.com/docs/security/key-management-deep-dive), [roles KMS](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles), [PKCS#11/OpenSSL](https://docs.cloud.google.com/kms/docs/reference/pkcs11-openssl), [TLS crypto.Signer](https://pkg.go.dev/crypto/tls), [secretos regionales](https://docs.cloud.google.com/secret-manager/regional-secrets/create-regional-secret), [limitaciones Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets), [precios KMS](https://cloud.google.com/kms/pricing).
