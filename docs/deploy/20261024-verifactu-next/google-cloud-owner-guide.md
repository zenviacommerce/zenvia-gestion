# Alta Google Cloud por el propietario — preparación, no ejecutar todavía

Decisión del propietario: Bélgica europe-west1, Cloud Run con escalado a cero, presupuesto de alertas25EUR/mes y clave no exportable. **No se ha creado proyecto/recurso, contratado servicio, pedido ni subido certificado.** Este documento actualiza el plan de fase0 con la pasarela probada localmente. El propietario hará el alta cuando autorice ese paso; ahora no se necesitan credenciales ni archivos.

## 1. Cuenta, proyecto y presupuesto

1. El propietario entra en console.cloud.google.com con su cuenta y MFA. Selector de proyecto → Nuevo proyecto: `zenvia-vf-test-SUFIJO` (propuesta, no reservado). Producción irá en otro proyecto, aún sin alta; custodia puede separarse en un tercer proyecto administrado solo por él.
2. Facturación → vincular su cuenta. Presupuestos y alertas → crear presupuesto mensual de **25EUR total** con ámbito sobre todos los proyectos de esta pasarela. Si su cuenta no factura EUR, fijar el equivalente en la moneda real. Alertas de gasto50%,80%,100% y previsión100%, al propietario. No crear25EUR por proyecto si busca25EUR en conjunto. Las alertas no son techo automático; no cortar facturación fiscal automáticamente por un aviso.
3. APIs y servicios → habilitar Cloud Run, Artifact Registry, IAM Service Account Credentials, Security Token Service y Cloud KMS; Secret Manager solo si se requieren secretos auxiliares. No habilitar VM/GKE/HSM dedicado por comodidad. Región de datos elegida por recurso, no por proyecto.

## 2. Identidades y custodia

1. IAM → Cuentas de servicio: `vf-runtime-test`, `vf-deploy-test`, `vf-invoke-test`. No crear claves JSON ni usar la cuenta Compute Editor por defecto.
2. Key Management → anillo `verifactu-test` en europe-west1. Nivel **Cloud HSM multi-tenant**, propósito ASYMMETRIC_SIGN. El adaptador probado admite RSA_SIGN_PSS_2048_SHA256 (también3072/4096 con SHA256), no PKCS1 automático; la compatibilidad real con certificado/AEAT sigue pendiente y debe confirmarse antes del alta definitiva de la clave. Detenerse antes de crear/importar una clave o solicitar CSR/certificado real en este paso preparatorio.
3. Ruta preferida futura: clave generada dentro de HSM y CSR para un certificado cualificado cuyo prestador soporte ese proceso. Alternativa de importación envuelta solo con procedimiento autorizado: no exportabilidad en Google no elimina las copias anteriores de una clave importada. No enviar PFX/contraseña por chat.
4. Runtime tiene **roles/cloudkms.signer + roles/cloudkms.publicKeyViewer sobre la clave concreta**, sin KMS Admin, Decrypt ni gestión de versiones. El código comprueba protectionLevel=HSM, nombre/version/europe-west1, PEM/CRC32C y firma RSA-PSS. Solo la cadena pública del certificado se suministra como archivo; la clave privada nunca entra al contenedor.
5. Secret Manager no guarda un PFX que el contenedor descifre: eso rompería la custodia acordada. Solo secretos auxiliares si fueran necesarios; Accessor sobre cada secreto concreto y residencia Bélgica. La pasarela actual usa token corto de identidad del runtime, sin secreto de despliegue ni service_role Supabase.

## 3. Registro y servicio, cuando se autorice

1. Artifact Registry → repositorio Docker `verifactu` en europe-west1. Revisar Dockerfile y resolver/fijar los digest de imágenes base antes del despliegue; CI construye la imagen sin certificados. Runtime Debian no root, Python/lxml solo para validación XSD offline; ningún instalador descarga paquetes durante una petición.
2. Cloud Run → crear servicio desde digest revisado, europe-west1, autenticación obligatoria, **sin allUsers**, identidad vf-runtime-test. CPU1, memoria512MiB inicial, facturación **por solicitud**, mínimo0, máximo2 instancias, concurrencia1, timeout30s. Son parámetros iniciales, no garantía de gasto ni SLA. El código no ejecuta bucles de fondo: el futuro disparador autenticado enviará cada trabajo por petición.
3. Mantener `VF_TEST_SEND_ENABLED=false`: el servicio arranca sin tocar KMS ni leer certificados. Healthcheck no acredita conexión AEAT. No abrir /submit al público para eludir la autenticación Cloud Run.
4. Solo después del procedimiento de certificado aprobado: configurar `VF_KMS_KEY_VERSION` con ruta versionada, `VF_PUBLIC_CERTIFICATE_CHAIN` con archivo público, `VF_ISSUER_NIF` del obligado acotado y la ruta fija del validador. No guardar NIF/cerificado/cuerpos SOAP en logs. Habilitar true únicamente en ambiente pruebas y con autorización expresa; no existe endpoint de producción en este código.
5. El invocador obtiene un ID token de Google con audience del servicio. Conceder roles/run.invoker a vf-invoke-test solo sobre ese servicio. La entrada Google IAM es obligatoria; la aplicación añade validación XSD y de emisor, no sustituye IAM con un token compartido. El despliegue inicial lo hace el propietario; el deployer después recibe roles/run.developer sobre el servicio y iam.serviceAccountUser solo sobre vf-runtime-test, además de artifactregistry.writer sobre su repositorio.
6. Revisar integridad de respuestas, duplicados y outbox persistente antes de automatizar remisiones. La pasarela no interpreta HTTP200 como alta aceptada y no hace reintentos a ciegas ante resultado ambiguo. La integración Supabase→Cloud Run privado no está habilitada: elegir identidad federada/pull autorizado en esa fase, nunca copiar service_role completa a Google.

## 4. Federación GitHub, sin claves descargadas

1. IAM → Workload Identity Federation → pool/proveedor OIDC. Emisor `https://token.actions.githubusercontent.com`; mapear google.subject=assertion.sub y atributos repository_id,repository_owner_id,ref. WIF usa control global; datos/clave en Bélgica.
2. Restringir a IDs verificados: repository_id1363689692 y repository_owner_id327381639 (`zenviacommerce/zenvia-gestion`). Producción futura: ref refs/heads/main y subject `repo:zenviacommerce/zenvia-gestion:environment:verifactu-production`. Ambiente pruebas separado. Restringir también el workflow aprobado con su claim job_workflow_ref; no autorizar cualquier workflow del repo ni PRs de forks.
3. Conceder WorkloadIdentityUser solo a ese principalSet sobre vf-deploy-test, no a todo el pool. GitHub → Environments → entorno de pruebas con aprobación del propietario y ramas autorizadas; producción en otro entorno con su propia aprobación. Workflow contents:read/id-token:write y google-github-actions/auth fijada por SHA revisado. No hay workflow de despliegue activo en esta PR: solo CI local/sintética.
4. El permiso de desplegar código permite usar indirectamente los permisos del runtime: revisiones y aprobación del propietario forman parte de la custodia, aunque deploy no tenga rol KMS directo.

## 5. Acceso y puesta en pruebas

No existe correo personal de ChatGPT para conceder IAM. Yo preparo código/PR; el propietario autoriza el workflow federado. Puede compartir identificadores de proyecto, número, WIF, emails de cuentas de servicio, rutas de clave y URL del servicio; nunca contraseñas, tokens, JSON de claves, PFX ni claves privadas. Acceso humano, si hiciera falta, a la cuenta identificada del técnico con permiso temporal; no compartir la cuenta del propietario ni dar Owner/Editor por defecto.

La prueba autenticada AEAT no se ha realizado: el servicio exige certificado electrónico cualificado reconocido y no se dispone de uno autorizado para esta prueba. Los certificados sintéticos locales prueban mTLS y el adaptador remoto, no validez ante AEAT/FNMT ni custodia física real. No se pide certificado ahora. Cuando se autorice, usar exclusivamente PRUEBAS prewww1.aeat.es/VerifactuSOAP y datos de prueba, con corte/identidad revisados.

## Fuentes oficiales, consulta24/10/2026

- [Presupuestos y alertas](https://docs.cloud.google.com/billing/docs/how-to/budgets).
- [Mínimo de instancias](https://docs.cloud.google.com/run/docs/configuring/min-instances) y [facturación por solicitud](https://docs.cloud.google.com/run/docs/configuring/billing-settings).
- [Roles KMS](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles), [API publicKey](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/getPublicKey), [asymmetricSign e integridad](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).
- [WIF para pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) y [roles Cloud Run](https://docs.cloud.google.com/run/docs/reference/iam/roles).
- [Go TLS crypto.Signer](https://pkg.go.dev/crypto/tls) y [releases Go](https://go.dev/dl/).
- [Servicios AEAT/SOAP1.1 y certificado cualificado](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf).
