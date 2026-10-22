# Siguiente fase: alta guiada de transportistas por cuenta

Prioridad posterior al trabajo actual de seguimiento; pendiente de diseño y aprobación, sin implementar ni activar.

## Alta operativa y seguimiento independientes

Preparar un flujo reutilizable para MRW, Correos Express, SEUR y GLS. Cada cuenta debe indicar su contrato, habilitación y credenciales para crear envíos/etiquetas, y por separado su autorización y credenciales de seguimiento. Para los demás transportistas, verificar si comparten credenciales entre ambos servicios ni que las credenciales de una plataforma intermediaria sean reutilizables por Zenvia.

El flujo deberá ofrecer un correo ya redactado para la franquicia o responsable de cuenta, con los servicios y campos pendientes; recibir secretos solo mediante la configuración segura, cifrados por cuenta; probar ambas conexiones por separado; y mostrar qué paso falta. Zenvia debe poder seguir operando y generando etiquetas cuando el seguimiento no esté habilitado, mostrando claramente «Sin seguimiento disponible» y la consulta manual apropiada.

Definir la matriz de requisitos de cada transportista a partir de su contrato y documentación vigente antes de implementar cada adaptador. Para MRW, TrackingService utiliza el mismo usuario y contraseña SAGEC guardados de la cuenta; no requiere un campo de contraseña de seguimiento separado.

## Línea estratégica: programa de plataforma/integrador

Evaluar el programa MRW para plataformas/integradores y qué acuerdos técnicos y comerciales permitirían una incorporación por cuenta menos manual. Comparar el modelo con Sendcloud, ShippyPro, Outvio y Odoo: titular del contrato, alta por abonado, permisos de seguimiento, gestión de secretos, responsabilidad de soporte, disponibilidad de API, límites y coste.

Esto es una investigación pendiente, no una afirmación de que esos productos compartan un programa o autenticación equivalente. No reutilizar `SAGEC01009SC`, específico de Sendcloud, para Zenvia. No contactar con terceros ni tramitar altas sin instrucción del propietario.
