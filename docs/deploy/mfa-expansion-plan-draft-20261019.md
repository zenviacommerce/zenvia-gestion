# Plan de ampliación MFA (BORRADOR: NO EJECUTAR)
Fecha: 2026-10-19. ZENVIA Gestión + Platform. Inicio únicamente tras 48 horas sin incidentes, revisión de auditoría y autorización explícita del propietario.

## Fase 0: criterios y línea base
- Piloto único aprobado: info@zenviacommerce.com / 7461b2b7-f383-460d-b1c7-6ccbb52e42b2. Mantener cohort exacto; no añadir usuarios por esta planificación.
- Validar guard sin hallazgos, esquema de migraciones alineado, MFA AAL2 de Auth GoTrue y controles RPC/RLS, Edge (incluido platform-bridge), OAuth. No ampliar si workers, purga o system:plan-sync se degradan.
- Inventario de usuarios y roles reales, permisos efectivos de lectura/modificación de PII y datos de Amazon por tenant, delegaciones, cuentas técnicas e integraciones. No basar alcance solo en etiquetas de rol; usar privilegios reales y resolver herencias.
- Copia de configuración y plan reversible: UPDATE private.mfa_configuration SET enabled=false WHERE singleton=true; leer estado y auditar (apagado global únicamente ante incidente confirmado).
- Identificar por escrito quién autoriza cada ampliación y comunicar a los usuarios afectados.

## Fase A: otros dos administradores (sujeto a autorización independiente)
- Comprobar identidades y UUID reales; el número de administradores debe verificarse, no suponerlo.
- Alta guiada voluntaria mientras están fuera del cohort: nombre legible obligatorio, QR TOTP en dispositivo personal, confirmación de código, segundo factor de respaldo, guardar fecha/estado de alta y registrar auditoría (nunca claves TOTP en logs).
- Periodo de gracia propuesto de 7 días, configurable y previamente aprobado; comunicar fecha límite y procedimiento de recuperación asistida. Evitar que un admin aún no inscrito entre en cohort hasta terminar alta y AAL2.
- Añadir solo UUID autorizados mediante transacción con assertions de factores verificados, integridad, versionado y rollback; para cada usuario comprobar AAL1 denegado, AAL2 permitido, y fuera-cohort sin impacto. Parada después de cada lote.

## Fase B: todos los usuarios con acceso efectivo a datos Amazon (sujeto a autorización independiente)
- Auditar permisos realmente efectivos: rutas frontend, endpoints RPC/Edge, jobs delegados, políticas RLS, descarga/exportación de pedidos, destinatarios, direcciones y otros datos personales procedentes de Amazon; incluir acceso indirecto y Platform.
- Expandir en lotes pequeños por tenant/tipo de permisos, empezando por usuarios con mayores privilegios. Primer login: asistente de inscripción TOTP, validación de sesión, al menos un dispositivo registrado, segundo dispositivo recomendado/obligatorio según política acordada, instrucciones accesibles de recuperación.
- Gracia configurable propuesta 7 días desde notificación/primer login (o fecha fija aprobada): durante gracia, restringir operaciones sensibles con PII de Amazon antes de AAL2, incluso si la navegación general sigue disponible. Al terminar, obligatoriedad AAL2 para todas las operaciones identificadas. La UI nunca concede excepciones a backend.
- Límite de intentos fallidos: mantener límites nativos GoTrue y registrar 429/too-many; añadir controles de bloqueo progresivo por usuario/sesión/origen, con desbloqueo/recuperación segura, alertas y pruebas de bloqueo sin permitir enumeración de cuentas. No inventar umbrales definitivos; acordarlos y medir tasa de falsos positivos antes de aplicar.
- Cada lote: CI GoTrue/Vault, E2E con dos factores, pruebas AAL1/AAL2, users fuera del lote y Platform-bridge, comparación de workers/cron. Rollback probado, sin revocar factores legítimos.

## Credenciales y cumplimiento
- Rotación anual de credenciales Amazon Login with Amazon (LWA): inventario de aplicaciones/clientes, secretos en gestor de secretos, propietarios y fecha de expiración/última rotación; aviso 60/30/7 días antes del aniversario. Probar credencial nueva en entorno de prueba, doble soporte/solapamiento solo si Amazon lo permite, corte atómico, monitorización de refresh token y reversión a configuración previa en ventana autorizada. No almacenar tokens LWA en código, SQL, tickets o logs; no cambiar credenciales durante esta fase MFA.
- Revisar la documentación contractual/política Amazon SP-API aplicable al producto y confirmar requisitos de MFA y rotación en la fecha de ejecución, sin considerar este plan como certificación de cumplimiento.
- Pruebas periódicas de recuperación, auditoría de factores y permisos; revocación rápida de usuarios dados de baja, mínima retención de datos de Amazon.

## Puertas de aprobación
Ninguna ampliación sin aprobación explícita del propietario. Preparar lista de UUIDs + permisos auditados, fecha de gracia, mecanismos de bloqueo, matriz de pruebas y rollback y presentarlos ANTES de tocar enabled/cohort. No crear factores por cuenta de terceros ni revocar sesiones existentes en esta planificación.
