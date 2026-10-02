insert into public.agent_knowledge_chunks(app,domain,module,screen,route,entity,content,keywords,permissions,action_type,requires_confirmation,integrations,version,source_file,source_commit)
select * from(values
('gestion','settings_admin','Administración','Auditoría','admin','audit_entry','Administración → Auditoría. Objetivo y comportamiento: Auditoría registra cambios relevantes realizados por usuarios y procesos para mantener trazabilidad. Es información de lectura salvo operaciones específicas de mantenimiento.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: auditoría; historial; cambios; trazabilidad.',array['auditoría','historial','cambios','trazabilidad']::text[],array['admin']::text[],'read',false,array[]::text[],'4','src/pages/Admin.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Administración','Usuarios','admin','app_user','Administración → Usuarios. Objetivo y comportamiento: Usuarios permite gestionar acceso al workspace, rol, permisos, invitaciones y acciones administrativas disponibles. Nunca se puede actuar sobre otro workspace.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: usuarios; rol; permisos; invitar.',array['usuarios','rol','permisos','invitar']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Admin.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Administración','Usuarios y permisos','admin','app_user','Administración → Usuarios y permisos. Objetivo y comportamiento: Administración gestiona usuarios, roles, permisos y auditoría. El agente no puede elevar permisos ni cruzar workspaces.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: administración; usuarios; permisos; auditoría.',array['administración','usuarios','permisos','auditoría']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Admin.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Amazon','amazon','amazon_analytics','Amazon → Amazon. Objetivo y comportamiento: Amazon reúne sincronización y analítica del canal: pedidos, unidades, ventas, reembolsos, rentabilidad, inventario y vinculaciones de productos.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: amazon; asin; marketplace; rentabilidad; reembolsos; inventario.',array['amazon','asin','marketplace','rentabilidad','reembolsos','inventario']::text[],array['amazon']::text[],'read',false,array['amazon']::text[],'4','src/pages/Amazon.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Filtros Amazon','amazon','amazon_filter','Amazon → Filtros Amazon. Objetivo y comportamiento: Los filtros de Amazon incluyen periodo y marketplaces. Por defecto puede usarse el mes actual y Todos los marketplaces según preferencias. Las cifras deben respetar siempre los filtros activos.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: filtros amazon; mes actual; marketplaces; periodo.',array['filtros amazon','mes actual','marketplaces','periodo']::text[],array['amazon']::text[],'read',false,array['amazon']::text[],'4','src/components/amazon/AmazonFilters.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Inventario','amazon','amazon_inventory','Amazon → Inventario. Objetivo y comportamiento: Inventario muestra stock sincronizado por producto o marketplace cuando existe evidencia. Si la sincronización está incompleta el agente debe indicarlo en vez de inferir existencias.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: inventario; stock; fba; fbm.',array['inventario','stock','fba','fbm']::text[],array['amazon']::text[],'read',false,array['amazon']::text[],'4','src/components/amazon/AmazonInventory.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Productos Amazon','amazon','amazon_product','Amazon → Productos Amazon. Objetivo y comportamiento: Productos Amazon muestra ASIN/SKU, imagen, nombre Amazon, nombre interno y vinculaciones. Los no vinculados se identifican aparte.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: asin; sku amazon; vincular; sin vincular.',array['asin','sku amazon','vincular','sin vincular']::text[],array['amazon']::text[],'write',true,array['amazon']::text[],'4','src/components/amazon/AmazonProducts.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Resumen','amazon','amazon_analytics','Amazon → Resumen. Objetivo y comportamiento: Amazon Analytics usa filtros de periodo y marketplace y muestra ventas, unidades, reembolsos y rentabilidad con datos sincronizados.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: amazon analytics; ventas; unidades; reembolsos; rentabilidad.',array['amazon analytics','ventas','unidades','reembolsos','rentabilidad']::text[],array['amazon']::text[],'read',false,array['amazon']::text[],'4','src/components/amazon/AmazonSummary.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Sin vincular','amazon','amazon_mapping','Amazon → Sin vincular. Objetivo y comportamiento: Sin vincular muestra referencias Amazon que todavía no están asociadas a productos internos. El flujo de vinculación permite elegir productos internos y puede incluir más de un componente cuando el modelo de coste lo requiere.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: sin vincular; vincular; asin; producto interno.',array['sin vincular','vincular','asin','producto interno']::text[],array['amazon']::text[],'write',true,array['amazon']::text[],'4','src/components/amazon/AmazonUnmapped.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','sales_clients','Clientes','Clientes','clients','client','Clientes → Clientes. Objetivo y comportamiento: Clientes mantiene nombre o razón social, NIF/VAT, contacto, dirección, país y valores comerciales. El agente no inventa datos fiscales ausentes.

Datos y reglas: Datos de venta y cliente: razón social, NIF/CIF, email, dirección, país, vencimiento, método de pago, serie, número, líneas e impuestos. Una consulta de facturas emitidas no debe usar las facturas de gasto. Los recibos registran cobros con su flujo específico. Crear un cliente prepara los campos conocidos para confirmar; no inventa su identidad fiscal ni comunica que existe antes de que el servicio guarde la ficha.

Permisos y ejecución: requiere acceso a clients. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: clientes; cif; nif; vat.',array['clientes','cif','nif','vat']::text[],array['clients']::text[],'write',true,array[]::text[],'4','src/pages/Clients.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Alertas y automatizaciones','settings','automation_rule','Configuración → Alertas y automatizaciones. Objetivo y comportamiento: Alertas y automatizaciones define avisos de negocio y acciones controladas. Las automatizaciones no deben ejecutar operaciones destructivas sin confirmación o permiso explícito.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: alertas; automatizaciones; notificaciones.',array['alertas','automatizaciones','notificaciones']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Envíos','settings','shipping_settings','Configuración → Envíos. Objetivo y comportamiento: Envíos controla modo de selección, número de opciones destacadas, reglas de selección, formatos de etiqueta y parámetros logísticos. No debe imponer preferencias hardcodeadas de ZENVIA COMMERCE.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración envíos; reglas; más barato; a6; a4.',array['configuración envíos','reglas','más barato','a6','a4']::text[],array['admin']::text[],'write',true,array['mrw','envia','sendcloud']::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Gastos e importación','settings','expense_settings','Configuración → Gastos e importación. Objetivo y comportamiento: Gastos e importación controla revisión, duplicados, Gmail, límites de adjuntos, categoría por defecto y reglas del motor de facturas recibidas.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración gastos; duplicados; gmail; revisión.',array['configuración gastos','duplicados','gmail','revisión']::text[],array['admin']::text[],'write',true,array['gmail']::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','General','settings','settings','Configuración → General. Objetivo y comportamiento: General contiene identidad de empresa, moneda, zona horaria, idioma, formato de fecha, página inicial y branding corporativo disponible.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración general; moneda; zona horaria; idioma; logo.',array['configuración general','moneda','zona horaria','idioma','logo']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Integraciones','settings','integration_account','Configuración → Integraciones. Objetivo y comportamiento: Integraciones permite múltiples cuentas. Cada conexión debe conservar su configuración y credenciales separadas. Las notificaciones de error deben aparecer por encima de modales y usar el estilo global.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: integraciones; cuentas; credenciales; probar conexión.',array['integraciones','cuentas','credenciales','probar conexión']::text[],array['admin']::text[],'write',true,array['amazon','shopify','mrw','envia','sendcloud','gmail']::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Mantenimiento','settings','maintenance','Configuración → Mantenimiento. Objetivo y comportamiento: Mantenimiento contiene diagnósticos y reparaciones controladas como duplicados, reconstrucciones y exportación de configuración. Las reparaciones deben previsualizarse y respetar confirmación.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: mantenimiento; duplicados; reconstrucción; exportar configuración.',array['mantenimiento','duplicados','reconstrucción','exportar configuración']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Pedidos','settings','order_settings','Configuración → Pedidos. Objetivo y comportamiento: Pedidos contiene preferencias generales de pedidos, país de origen, comportamiento de etiquetas y valores predeterminados no específicos de un cliente salvo que el propio cliente los configure.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración pedidos; origen; etiquetas; defaults.',array['configuración pedidos','origen','etiquetas','defaults']::text[],array['admin']::text[],'write',true,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Plan y facturación','settings','subscription','Configuración → Plan y facturación. Objetivo y comportamiento: Plan y facturación muestra plan, consumo, límites, caducidad, facturas de suscripción y opciones de cobro disponibles para el cliente.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: plan; facturación suscripción; caducidad; paypal.',array['plan','facturación suscripción','caducidad','paypal']::text[],array['admin']::text[],'read',false,array['paypal']::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Preferencias','settings','user_preferences','Configuración → Preferencias. Objetivo y comportamiento: Mis preferencias contiene opciones de interfaz propias del usuario, como columnas, KPIs, filtros o presentación cuando estén disponibles. No deben alterar la configuración global de otros usuarios.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a settings. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: preferencias; columnas; kpi; filtros.',array['preferencias','columnas','kpi','filtros']::text[],array['settings']::text[],'write',false,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración y administración','Configuración','settings',null,'Configuración y administración → Configuración. Objetivo y comportamiento: Configuración concentra empresa, facturación, gastos, pedidos, envíos, productos, clientes, proveedores, integraciones, alertas y preferencias. Administración gestiona usuarios, permisos y auditoría.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a settings. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuracion; integraciones; usuarios; permisos; auditoria; tema.',array['configuracion','integraciones','usuarios','permisos','auditoria','tema']::text[],array['settings']::text[],'write',true,array['amazon','shopify','mrw','envia','sendcloud','gmail']::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Envíos','Comparador','orders','shipping_option','Envíos → Comparador. Objetivo y comportamiento: ZENVIA compara opciones logísticas habilitadas y ordena por precio cuando existe. Las reglas pueden elegir proveedor, cuenta, transportista y servicio.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: comparar envíos; tarifa; reglas; transportista.',array['comparar envíos','tarifa','reglas','transportista']::text[],array['orders']::text[],'read',false,array['mrw','envia','sendcloud']::text[],'4','src/pages/Orders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Envíos','Etiquetados','orders','fulfillment_order','Envíos → Etiquetados. Objetivo y comportamiento: Etiquetados contiene pedidos con etiqueta creada que aún no han progresado según tracking reconocido. Enviados contiene progreso logístico y Cancelados se separa cuando corresponde.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: etiquetados; enviados; cancelados; tracking.',array['etiquetados','enviados','cancelados','tracking']::text[],array['orders']::text[],'read',false,array['mrw','envia','sendcloud']::text[],'4','src/pages/Orders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Envíos','Impresión de etiquetas','orders','shipping_label','Envíos → Impresión de etiquetas. Objetivo y comportamiento: La impresión admite formatos configurados. El estado de impresión se registra cuando ZENVIA conoce el evento; etiquetas creadas fuera pueden tener historial desconocido.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: imprimir etiqueta; a6; a4; impresa.',array['imprimir etiqueta','a6','a4','impresa']::text[],array['orders']::text[],'write',false,array['mrw','envia','sendcloud']::text[],'4','src/pages/Orders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','sales_clients','Facturación','Facturas emitidas','sales','sales_invoice','Facturación → Facturas emitidas. Objetivo y comportamiento: Facturación gestiona borradores, emisión, vencimientos, cobros, descarga y envío de facturas de venta. No debe confundirse con Facturas de gasto.

Datos y reglas: Datos de venta y cliente: razón social, NIF/CIF, email, dirección, país, vencimiento, método de pago, serie, número, líneas e impuestos. Una consulta de facturas emitidas no debe usar las facturas de gasto. Los recibos registran cobros con su flujo específico. Crear un cliente prepara los campos conocidos para confirmar; no inventa su identidad fiscal ni comunica que existe antes de que el servicio guarde la ficha.

Permisos y ejecución: requiere acceso a sales. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: factura venta; facturas emitidas; vencimiento; cobro.',array['factura venta','facturas emitidas','vencimiento','cobro']::text[],array['sales']::text[],'write',true,array[]::text[],'4','src/pages/SalesInvoices.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','sales_clients','Facturación y clientes','Facturación','sales','sales_invoice','Facturación y clientes → Facturación. Objetivo y comportamiento: Facturación gestiona facturas emitidas, vencimientos, cobros y documentos de venta. Clientes mantiene identidad fiscal, contacto y valores comerciales reutilizados por la facturación.

Datos y reglas: Datos de venta y cliente: razón social, NIF/CIF, email, dirección, país, vencimiento, método de pago, serie, número, líneas e impuestos. Una consulta de facturas emitidas no debe usar las facturas de gasto. Los recibos registran cobros con su flujo específico. Crear un cliente prepara los campos conocidos para confirmar; no inventa su identidad fiscal ni comunica que existe antes de que el servicio guarde la ficha.

Permisos y ejecución: requiere acceso a sales, clients. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: facturacion; ventas; facturas emitidas; clientes; cobros.',array['facturacion','ventas','facturas emitidas','clientes','cobros']::text[],array['sales','clients']::text[],'write',true,array[]::text[],'4','src/pages/SalesInvoices.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Añadir factura','invoices','invoice_import','Gastos → Añadir factura. Objetivo y comportamiento: Añadir factura procesa un documento individual. Importar facturas procesa varios. Ambos comparten el mismo motor de lectura y validación.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: añadir factura; importar factura; ocr; pdf.',array['añadir factura','importar factura','ocr','pdf']::text[],array['invoices']::text[],'write',true,array[]::text[],'4','src/components/UploadInvoiceModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Centro de gastos','invoices','invoice','Gastos → Centro de gastos. Objetivo y comportamiento: El centro de Gastos separa Facturas de gasto e Importar desde Gmail. La primera gestiona documentos ya incorporados y altas manuales o masivas; Gmail descubre adjuntos y los pasa por el mismo motor común.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: centro gastos; gmail; facturas gasto.',array['centro gastos','gmail','facturas gasto']::text[],array['invoices']::text[],'read',false,array['gmail']::text[],'4','src/pages/ExpenseInvoicesHub.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Detalle de factura','invoices','invoice','Gastos → Detalle de factura. Objetivo y comportamiento: El detalle de una factura de gasto muestra proveedor, número, fecha, base, IVA, recargo, retención, total, estado, pago, líneas y documento cuando existe. Los cambios de estado o proveedor deben usar la factura identificada.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: detalle factura; base; iva; retención; estado pago.',array['detalle factura','base','iva','retención','estado pago']::text[],array['invoices']::text[],'write',true,array[]::text[],'4','src/components/InvoiceDetailModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Facturas de gasto','invoices','invoice','Gastos → Facturas de gasto. Objetivo y comportamiento: Facturas de gasto son facturas recibidas. Estados contables y de pago son independientes; se pueden filtrar, ordenar, revisar, contabilizar, pagar y exportar según permisos.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: factura gasto; pendiente; revisada; contabilizada; pagada.',array['factura gasto','pendiente','revisada','contabilizada','pagada']::text[],array['invoices']::text[],'write',true,array['gmail']::text[],'4','src/pages/Invoices.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Gmail','invoices','gmail_import','Gastos → Gmail. Objetivo y comportamiento: Gmail usa el mismo pipeline de facturas de gasto. Si falta fecha, número, proveedor o cierre fiscal fiable debe pedir revisión y no inventar.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: gmail; fecha factura; iva; adjunto.',array['gmail','fecha factura','iva','adjunto']::text[],array['invoices']::text[],'write',true,array['gmail']::text[],'4','src/pages/Gmail.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Importación masiva','invoices','invoice_import','Gastos → Importación masiva. Objetivo y comportamiento: La importación masiva procesa varios PDFs, detecta duplicados y presenta candidatos para revisión antes de guardar.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: importación masiva; duplicado; varias facturas.',array['importación masiva','duplicado','varias facturas']::text[],array['invoices']::text[],'write',true,array[]::text[],'4','src/components/BulkInvoiceImportModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','expenses','Gastos','Motor fiscal','invoices','invoice_import','Gastos → Motor fiscal. Objetivo y comportamiento: El motor reconcilia base, IVA, recargo, retención y total con evidencia y aritmética. IVA cero exige evidencia de exención o reverse charge.

Datos y reglas: Campos de factura recibida: número, proveedor, fecha de emisión, categoría, base, impuestos, retención, total, líneas y documento original. El estado de revisión (pendiente, revisada o contabilizada) es independiente del pago (pagada o sin pagar). Para cambiar una factura el agente exige identificación inequívoca y muestra el cambio antes de ejecutarlo. La importación fiscal debe solicitar revisión cuando la evidencia no permite cerrar los importes.

Permisos y ejecución: requiere acceso a invoices. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: iva; base imponible; recargo; retención; reverse charge.',array['iva','base imponible','recargo','retención','reverse charge']::text[],array['invoices']::text[],'read',false,array[]::text[],'4','src/services/invoiceImportPipeline.ts','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Pedidos','Edición de pedido','orders','fulfillment_order','Pedidos → Edición de pedido. Objetivo y comportamiento: Antes de crear etiqueta se pueden corregir destinatario, teléfono, dirección, peso y medidas. Los cambios se guardan en ZENVIA y solo se envían al proveedor elegido cuando corresponde.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: editar pedido; dirección; peso; medidas.',array['editar pedido','dirección','peso','medidas']::text[],array['orders']::text[],'write',true,array['mrw','envia','sendcloud']::text[],'4','src/components/OrderEditModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Pedidos','Listado de pedidos','orders','fulfillment_order','Pedidos → Listado de pedidos. Objetivo y comportamiento: Pedidos es la fuente operativa del pedido. El origen puede ser Amazon, Shopify u otro canal y el proveedor logístico se elige después.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: pedidos; amazon; shopify; cliente.',array['pedidos','amazon','shopify','cliente']::text[],array['orders']::text[],'read',false,array['amazon','shopify']::text[],'4','src/pages/Orders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','orders_shipping','Pedidos y envíos','Pedidos','orders','fulfillment_order','Pedidos y envíos → Pedidos. Objetivo y comportamiento: Pedidos centraliza pedidos de canales conectados, edición previa a etiqueta, comparación de opciones logísticas, generación de etiquetas y tracking. ZENVIA mantiene el pedido como fuente de verdad y usa el proveedor elegido cuando corresponde.

Datos y reglas: Campos operativos: número de pedido, canal, estado, destinatario, dirección, teléfono, peso, dimensiones, cuenta logística, transportista, servicio, etiqueta y seguimiento. Una etiqueta creada no demuestra que el paquete haya sido entregado al transportista. No se debe inventar un precio cuando no se identifica una tarifa aplicable. El seguimiento usa enlaces registrados o suministrados por la integración.

Permisos y ejecución: requiere acceso a orders. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: pedidos; envios; etiquetas; tracking; mrw; envia; sendcloud; shopify.',array['pedidos','envios','etiquetas','tracking','mrw','envia','sendcloud','shopify']::text[],array['orders']::text[],'write',true,array['amazon','shopify','mrw','envia','sendcloud']::text[],'4','src/pages/Orders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','catalog_suppliers','Productos','Editor de producto','products','product','Productos → Editor de producto. Objetivo y comportamiento: El editor de producto permite nombre, SKU, EAN, categoría, unidad, coste, precio de venta, IVA y proveedor según configuración. No se deben inventar SKU, EAN ni costes ausentes.

Datos y reglas: El catálogo utiliza nombre, SKU, EAN, unidad, categoría, coste y precio. Un coste ausente no equivale a coste cero. La ficha de proveedor mantiene identidad fiscal, contacto y tipo (mercancía, servicios, ambos o sin clasificar). Crear una ficha exige el nombre y la confirmación del usuario. Consultar una muestra de fichas no permite afirmar que representa todo el catálogo; los recuentos proceden de consultas específicas.

Permisos y ejecución: requiere acceso a products. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: editar producto; sku; ean; coste; precio venta; iva.',array['editar producto','sku','ean','coste','precio venta','iva']::text[],array['products']::text[],'write',true,array[]::text[],'4','src/components/ProductModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','catalog_suppliers','Productos','Productos','products','product','Productos → Productos. Objetivo y comportamiento: Productos mantiene nombre, SKU, EAN, unidad, categoría, coste, precio, IVA y proveedor.

Datos y reglas: El catálogo utiliza nombre, SKU, EAN, unidad, categoría, coste y precio. Un coste ausente no equivale a coste cero. La ficha de proveedor mantiene identidad fiscal, contacto y tipo (mercancía, servicios, ambos o sin clasificar). Crear una ficha exige el nombre y la confirmación del usuario. Consultar una muestra de fichas no permite afirmar que representa todo el catálogo; los recuentos proceden de consultas específicas.

Permisos y ejecución: requiere acceso a products. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: producto; sku; ean; coste; precio.',array['producto','sku','ean','coste','precio']::text[],array['products']::text[],'write',true,array['amazon']::text[],'4','src/pages/Products.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','catalog_suppliers','Productos y proveedores','Productos','products','product','Productos y proveedores → Productos. Objetivo y comportamiento: Productos mantiene catálogo, SKU, EAN, unidad, IVA, costes, precios y vinculaciones. Proveedores mantiene identidad fiscal, contacto, tipo y categoría habitual.

Datos y reglas: El catálogo utiliza nombre, SKU, EAN, unidad, categoría, coste y precio. Un coste ausente no equivale a coste cero. La ficha de proveedor mantiene identidad fiscal, contacto y tipo (mercancía, servicios, ambos o sin clasificar). Crear una ficha exige el nombre y la confirmación del usuario. Consultar una muestra de fichas no permite afirmar que representa todo el catálogo; los recuentos proceden de consultas específicas.

Permisos y ejecución: requiere acceso a products, suppliers. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: productos; sku; ean; costes; proveedores.',array['productos','sku','ean','costes','proveedores']::text[],array['products','suppliers']::text[],'write',true,array[]::text[],'4','src/pages/Products.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','catalog_suppliers','Proveedores','Editor de proveedor','suppliers','supplier','Proveedores → Editor de proveedor. Objetivo y comportamiento: El editor de proveedor permite identidad fiscal, contacto, dirección, web, tipo de proveedor y categoría habitual. Tipo de proveedor no es lo mismo que categoría de gasto.

Datos y reglas: El catálogo utiliza nombre, SKU, EAN, unidad, categoría, coste y precio. Un coste ausente no equivale a coste cero. La ficha de proveedor mantiene identidad fiscal, contacto y tipo (mercancía, servicios, ambos o sin clasificar). Crear una ficha exige el nombre y la confirmación del usuario. Consultar una muestra de fichas no permite afirmar que representa todo el catálogo; los recuentos proceden de consultas específicas.

Permisos y ejecución: requiere acceso a suppliers. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: editar proveedor; tipo proveedor; categoría habitual; cif.',array['editar proveedor','tipo proveedor','categoría habitual','cif']::text[],array['suppliers']::text[],'write',true,array[]::text[],'4','src/components/SupplierModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','catalog_suppliers','Proveedores','Proveedores','suppliers','supplier','Proveedores → Proveedores. Objetivo y comportamiento: Proveedores mantiene identidad fiscal, contacto, dirección, web, tipo y categoría habitual; se normalizan identidades para evitar duplicados.

Datos y reglas: El catálogo utiliza nombre, SKU, EAN, unidad, categoría, coste y precio. Un coste ausente no equivale a coste cero. La ficha de proveedor mantiene identidad fiscal, contacto y tipo (mercancía, servicios, ambos o sin clasificar). Crear una ficha exige el nombre y la confirmación del usuario. Consultar una muestra de fichas no permite afirmar que representa todo el catálogo; los recuentos proceden de consultas específicas.

Permisos y ejecución: requiere acceso a suppliers. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: proveedor; cif; web; tipo proveedor.',array['proveedor','cif','web','tipo proveedor']::text[],array['suppliers']::text[],'write',true,array[]::text[],'4','src/pages/Suppliers.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','sales_clients','Recibos','Recibos','sales','receipt','Recibos → Recibos. Objetivo y comportamiento: Recibos registra cobros, incluso sin vincular a una factura cuando el flujo lo permite.

Datos y reglas: Datos de venta y cliente: razón social, NIF/CIF, email, dirección, país, vencimiento, método de pago, serie, número, líneas e impuestos. Una consulta de facturas emitidas no debe usar las facturas de gasto. Los recibos registran cobros con su flujo específico. Crear un cliente prepara los campos conocidos para confirmar; no inventa su identidad fiscal ni comunica que existe antes de que el servicio guarde la ficha.

Permisos y ejecución: requiere acceso a sales. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: recibos; cobros; pago.',array['recibos','cobros','pago']::text[],array['sales']::text[],'write',true,array[]::text[],'4','src/pages/SalesReceipts.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','general','Resumen','Resumen','dashboard',null,'Resumen → Resumen. Objetivo y comportamiento: Resumen muestra KPIs, alertas, pendientes y accesos rápidos. Los filtros de periodo afectan a los indicadores compatibles y todo respeta permisos y workspace.

Datos y reglas: Los indicadores son consultas de datos actuales con el alcance de la empresa y los filtros del usuario. No se deducen cifras desde documentación o mensajes anteriores. Si una consulta falla, el agente indica el error; no convierte el fallo en cero registros. Abrir una sección no guarda cambios. Las operaciones de escritura se preparan primero y utilizan el diálogo estándar de confirmación de la aplicación.

Permisos y ejecución: requiere acceso a dashboard. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: resumen; dashboard; kpi; pendientes.',array['resumen','dashboard','kpi','pendientes']::text[],array['dashboard']::text[],'read',false,array[]::text[],'4','src/pages/Dashboard.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','support','Soporte','Detalle de ticket','support','support_ticket','Soporte → Detalle de ticket. Objetivo y comportamiento: El detalle de ticket reúne asunto, mensajes, adjuntos, estado y actividad. Antes de responder, editar o eliminar el agente debe identificar de forma inequívoca el ticket y verificar permisos.

Datos y reglas: Se diferencian el número del ticket, asunto, descripción, prioridad, estado y conversación. Un ticket abierto y uno que espera respuesta son conceptos distintos. Crear o responder puede enviar notificaciones y requiere confirmación del contenido. El agente identifica el ticket concreto y no considera un envío completado si el servicio falla. La lectura y las acciones administrativas están limitadas por los permisos actuales.

Permisos y ejecución: requiere acceso a support. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: detalle ticket; responder ticket; eliminar ticket; adjuntos.',array['detalle ticket','responder ticket','eliminar ticket','adjuntos']::text[],array['support']::text[],'write',true,array[]::text[],'4','src/pages/Support.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','support','Soporte','Soporte','support','support_ticket','Soporte → Soporte. Objetivo y comportamiento: Soporte permite abrir y seguir tickets, adjuntos, estado y actividad. Las operaciones adicionales dependen del rol y permisos del usuario.

Datos y reglas: Se diferencian el número del ticket, asunto, descripción, prioridad, estado y conversación. Un ticket abierto y uno que espera respuesta son conceptos distintos. Crear o responder puede enviar notificaciones y requiere confirmación del contenido. El agente identifica el ticket concreto y no considera un envío completado si el servicio falla. La lectura y las acciones administrativas están limitadas por los permisos actuales.

Permisos y ejecución: requiere acceso a support. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: soporte; tickets; incidencias.',array['soporte','tickets','incidencias']::text[],array['support']::text[],'write',true,array[]::text[],'4','src/pages/Support.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','support','Soporte','Tickets','support','support_ticket','Soporte → Tickets. Objetivo y comportamiento: Soporte permite crear tickets, adjuntar archivos y seguir conversación y estado. Las acciones administrativas dependen de permisos y auditoría.

Datos y reglas: Se diferencian el número del ticket, asunto, descripción, prioridad, estado y conversación. Un ticket abierto y uno que espera respuesta son conceptos distintos. Crear o responder puede enviar notificaciones y requiere confirmación del contenido. El agente identifica el ticket concreto y no considera un envío completado si el servicio falla. La lectura y las acciones administrativas están limitadas por los permisos actuales.

Permisos y ejecución: requiere acceso a support. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: ticket; soporte; adjunto; respuesta.',array['ticket','soporte','adjunto','respuesta']::text[],array['support']::text[],'write',true,array[]::text[],'4','src/pages/Support.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Facturación','settings',null,'Configuración → Facturación. Objetivo y comportamiento: Valores predeterminados, cobros, series y documentos de venta.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración facturación; serie; cobros.',array['configuración facturación','serie','cobros']::text[],array['admin']::text[],'read',false,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Productos','settings',null,'Configuración → Productos. Objetivo y comportamiento: IVA, costes, márgenes y preferencias de creación de productos.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración productos; coste; margen.',array['configuración productos','coste','margen']::text[],array['admin']::text[],'read',false,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Clientes','settings',null,'Configuración → Clientes. Objetivo y comportamiento: Valores predeterminados e identidad de clientes.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración clientes; identidad; país.',array['configuración clientes','identidad','país']::text[],array['admin']::text[],'read',false,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','settings_admin','Configuración','Proveedores','settings',null,'Configuración → Proveedores. Objetivo y comportamiento: Valores predeterminados, alias e identificación de proveedores.

Datos y reglas: La configuración empresarial y las preferencias personales tienen alcances distintos. La interfaz determina las opciones disponibles; no se deben recomendar campos que no existen. La administración requiere permiso de administrador para consultar usuarios y auditoría. El agente nunca muestra tokens, contraseñas o secretos de integraciones. Las acciones del catálogo declaran permiso, tipo y confirmación; conocer una pantalla no habilita automáticamente todas sus modificaciones.

Permisos y ejecución: requiere acceso a admin. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: configuración proveedores; alias; categoría.',array['configuración proveedores','alias','categoría']::text[],array['admin']::text[],'read',false,array[]::text[],'4','src/pages/Settings.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Pedidos Amazon','amazon',null,'Amazon → Pedidos Amazon. Objetivo y comportamiento: Consulta de pedidos Amazon con sus filtros y detalle disponible.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: pedidos amazon; pedido; canal.',array['pedidos amazon','pedido','canal']::text[],array['amazon']::text[],'read',false,array[]::text[],'4','src/components/amazon/AmazonOrders.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Marketplaces','amazon',null,'Amazon → Marketplaces. Objetivo y comportamiento: Analítica por marketplace y etiquetas de países en la interfaz.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: marketplace; país; ventas.',array['marketplace','país','ventas']::text[],array['amazon']::text[],'read',false,array[]::text[],'4','src/components/amazon/AmazonMarketplaces.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Completitud','amazon',null,'Amazon → Completitud. Objetivo y comportamiento: Estado de completitud de los datos sincronizados del periodo.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: completitud amazon; datos incompletos; sincronización.',array['completitud amazon','datos incompletos','sincronización']::text[],array['amazon']::text[],'read',false,array[]::text[],'4','src/components/amazon/AmazonCompleteness.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb'),
('gestion','amazon','Amazon','Vinculación de producto','amazon',null,'Amazon → Vinculación de producto. Objetivo y comportamiento: Vinculación entre producto Amazon e interno mediante el editor existente.

Datos y reglas: Los resultados dependen del periodo y marketplace consultados. Se distinguen pedidos, unidades, ventas, reembolsos y beneficio; no son métricas intercambiables. Las vinculaciones relacionan ASIN/SKU con el producto interno. La sincronización solicita trabajos y puede continuar después de responder; no debe anunciarse como terminada hasta disponer de evidencia. Las preguntas de datos actuales usan RPC de analítica y respetan los permisos del workspace.

Permisos y ejecución: requiere acceso a amazon. Las herramientas de lectura consultan datos actuales; escribir o eliminar exige autorización y confirmación. Un error del servicio nunca equivale a éxito.

Ejemplos de consulta: vincular asin; sku; producto interno.',array['vincular asin','sku','producto interno']::text[],array['amazon']::text[],'read',false,array[]::text[],'4','src/components/amazon/AmazonMappingModal.tsx','4d76f9af057b7e9e3b0504c5180894e26f5d42bb')
) as v(app,domain,module,screen,route,entity,content,keywords,permissions,action_type,requires_confirmation,integrations,version,source_file,source_commit)
where not exists(select 1 from public.agent_knowledge_chunks k where k.app=v.app and k.module=v.module and coalesce(k.screen,'')=coalesce(v.screen,'') and k.version=v.version);
