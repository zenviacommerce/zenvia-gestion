# Publicación A y B · 23/10/2026

A se publica por separado: Gestión PR289 merge b22007380156cd9bb48b8b339285f7b948acc19d, Vercel READY dpl_ARszgxbcbkUNxvcv4QUFbrMuk1Bh; Platform PR82 merge40ec644513ac98f91b6931b3607dc7bab8b0df7c, READY dpl_CyDHGFPkfuRGd8viRVLzU1xPCNu7. Ambas CI finales verdes. Más acciones y Nuevo pedido:43px/16px en escritorio y48px/13px a390; ambos con icono y fuente idéntica.

B: PR290 head f52bdeeaa34507d673afa6c32edb53fcd209d535, seis checks verdes,628pruebas Vitest y1284Node; integración posterior a A solo documental. Merge8069361a870595dd7eac8f496fd9d7f131479262, READY dpl_CbsCXuosdtPzaPYQU9Q5WZKzTXuE, gestion.zenviacommerce.com. Seis migraciones aplicadas correctamente y dos Edge nuevas versión1. Endpoint documentos requiere JWT; purga exige secreto interno. Probes sin autenticación:401enambos, sin ejecutar worker.

Tres snapshots históricos y guard MFA mantienen hashes anteriores. Bucket privado,7tablas nuevas con RLS,14RPCdocumentales solo service_role; batch humano con MFA. Retención365,purga desactivada,0cron. Verificación de UI sobre informe existente, sin firmarlo, crear informes ni enviar correos: copia info@ marcada y alineada debajo de destinatario, etiqueta verde, entradas16px, canvas completo a390×844. Tras verificar:3informes,0operaciones de firma,0firmas,0correos.

Capturas de producción: [correo390](20261023-pickup-production-email-390.jpg), [firma390sin firmar](20261023-pickup-production-signature-390.jpg). El gesto real de dedo y retina3× se verifica con datos sintéticos en20261023-pickup-owner-after/manifest.json. PDF firmado de prueba permanece en la galería aprobada, sin documentos reales de prueba.

Rollback A previo: Gestión dpl_BU2EGbbPrHvenTxGPeXAANoovFDN y Platform dpl_H7vDiQhpcxBfRVfJdREkvdvLbose. Rollback frontend B a A solo si aún no hay firmas; si existen, conservar lector B y aplicar supabase/rollback/20261022_pickup_document_read_only.sql. Conserva PDFs, PII y auditoría; nunca borrar evidencia como rollback.

Supabase asignó versiones reales20261022230518/32/33/50/51/52. PR291 alinea únicamente nombres SQL y referencias de3pruebas; no modifica SQL ni código de aplicación.12/12pruebas SQL locales correctas. Se integra tras CI. La purga no se activa por este ajuste.

Cierre de PR291: merge64a09358e253bfb6c44e8de73cd8b01c117d4e57, seis checks finales verdes. Producción READY dpl_9K2RvEJdTVrnMUKhA2u3t7Qv9GNw; HTTP200 y assets idénticos a B: JS37a855e993ad12d9842426b6582eab805c07358eacd8ec4ebbce93506594fb20, CSS1d8486aac28204a71993fdf6880bf0ac4768ec423a638b9020b1eec3f962f211. La conciliación no cambia aplicación, SQL, MFA ni activación de purga.
