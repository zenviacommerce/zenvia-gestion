# Recibo de publicación: hotfix #262

- PR: https://github.com/zenviacommerce/zenvia-gestion/pull/262
- Head verificado: `0382119ac4fa4a937f50d09b45fafb4c96a984a6`. Seis checks en verde: dos builds, auth-tests, screenshots, real-auth-vault y Vercel Preview Comments; estado Vercel success antes del merge.
- Main publicado por Git: `f287ff5ee90f22d3d8899bdc40b6a990e5141dd3`. Solo hotfix; fase 2 aislada.
- Tests locales: 233 Vitest / 42 ficheros; 1.221 scripts Node; build y guard de contrato correctos. Capturas/contraste de contenido y geometría a 390/1280/1440 correctos. El check antiguo que exigía un observador DOM se sustituyó por renderizado real del contrato, sin omitir checks.
- Revisión independiente: sin Critical/Important; apto para merge con CI verde. Mejoras opcionales de cobertura: escenario cero pendientes en las páginas completas y previews de mapping/drawer/Gmail adicionales (su CSS ya fue revisado como contain). Se conservan como mejoras de cobertura, no incidencias de producción.
- Evidencia previa en producción a 390 px: contenedores 240×80; logotipo 150×100 y sello 237,98×94,36, ambos fuera del alto del padre. Sin editar ni reprocesar archivos del propietario.
- Rollback preparado y verificado READY: `dpl_FXFkLqauYMkr7aiJBiRRpP4HhXMA`, main `aa8677ddf09a4b64be74a80ff8df26fe762405bc`, bundle `index-DqEFHKNh.js`. Conserva Shopify y fase 1. No migraciones ni cambios de datos.

## Verificación posterior

Deployment `dpl_BmTNRNtFRo6Q6fMyhcHYTkUNusge` READY, destino production, commit `f287ff5ee90f22d3d8899bdc40b6a990e5141dd3`, alias gestion.zenviacommerce.com confirmado. Navegador tras recarga: bundle `index-DURYFMtN.js`; sesión se mantiene y ambas pantallas cargan.

Resumen: Pendientes 4, clase de aviso presente, degradado dorado calculado. Pedidos: primero 0 neutro durante carga y después 4 con el mismo degradado/clase; comprobación visual del aviso dorado y captura del KPI, sin datos de clientes.

Configuración General real a 390×1000: logo 150×100 dentro de contenedor 311×122; sello 288,98×114,58 dentro de contenedor 311×136,58. Ambos `object-fit:contain`, máximo 240 px, dentro del padre por los cuatro bordes. No se han cargado archivos ni guardado preferencias/configuración. La comprobación posterior de previews es geométrica sobre las imágenes reales; la revisión visual final del sello y su última línea queda para el propietario. Captura de producción del KPI dorado guardada aparte, sin datos de clientes. Cero errores de consola posteriores a la recarga en la ventana comprobada.

En escritorio: logo 150×100 en padre 180×122; sello 157,98×62,64 en padre 180×84,64, ambos dentro del contenedor. Viewport restaurado tras comprobar móvil.
