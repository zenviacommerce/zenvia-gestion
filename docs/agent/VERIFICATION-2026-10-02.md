# ZENVIA IA — verificación de 2026-10-02

La corrección de seguimiento se integró en main (4d76f9a).

## Aplicado

- RAG léxico local en PostgreSQL, sin API de IA de pago. Datos iniciales existentes verificados y documentación v4 ampliada a 53 pantallas/flujos con fuente comprobada en `docs/agent/screens.json`.
- Búsqueda con tildes normalizadas, versión más reciente y filtro de permisos antes del ranking. RLS y acceso a catálogos únicamente en servidor.
- Contrato común de herramientas: read/write/destructive, permisos, esquema estricto de argumentos y confirmación obligatoria para escrituras/destructivas.
- 20 herramientas registradas. Las ocho escrituras de Gestión conservan sus servicios autenticados y diálogos estándar y pasan por app-agent-tools; los 17 ejecutores de Platform tienen handler operativo y vuelven a validar la sesión, permisos y argumentos.
- Corregidos RAG inaccesible en Platform, consultas que ocultaban errores como ceros, intenciones de pendientes, altas interceptadas por consultas, órdenes de clientes interceptadas por fichas, pagos y pruebas sin cliente explícito.

## Pruebas

- Pruebas específicas de agentes: 85 pasan. Incluyen ejecución de los motores y de los endpoints con datos sintéticos, fuera de ámbito, aclaraciones, permisos revocados, otra empresa, cancelación, errores remotos e inyección de action.
- 20 consultas de recuperación RAG comprobadas contra esta base real: 20 correctas.
- TypeScript de funciones y build frontend correctos en ambas apps. Funciones desplegadas con JWT obligatorio y contenido contrastado con el código probado.
- Suite global: 762 pruebas, 736 correctas, 26 fallidas.

## Alcance de las comprobaciones

Las llamadas de escritura y destructivas se prueban con servicios simulados; no se crean clientes, cobros, invitaciones ni eliminaciones reales durante la evaluación. El conocimiento documental no habilita acciones que el router no prepara. Las herramientas cubren consultas por módulo y las acciones registradas; no equivalen a ejecutar cualquier botón de la aplicación. El RAG utiliza búsqueda léxica, no embeddings. No se ha comprobado una conversación en navegador con sesión de cliente real.

## Fallos previos de Gestión, ajenos a IA

- native Amazon orders can be edited locally without a Sendcloud remote order
- Orders keeps refreshing direct Amazon state with no logistics aggregator enabled
- native routing survives migration of existing Sendcloud-backed Amazon rows
- Orders auto-sync uses a stable in-flight guard instead of depending on syncing state
- live quote comparison shows source, carrier, service, contracted tariff and delta
- generic tariff fallback never interprets VAT percentage as fuel surcharge
- Envia quotes sanitize state values and quote one carrier per request
- contracted tariffs are scoped to exactly one shipping provider
- Sendcloud V3 shipping-options request includes route fields so quotes can be calculated
- expense duplicate detection uses shared supplier identity matching
- MRW connection validation uses read-only SOAP operations and never exposes raw HTML runtime pages
- integration UI shows provider logos and models Shopify honestly as a Sendcloud channel
- MRW connection validation supports both AuthInfo and legacy AuthInfoSWGE contracts
- expense imports require human review when the AI verifier is unavailable
- single expense upload blocks bundled PDFs and redirects to the normalized bulk flow
- Pedidos and Envíos settings expose operational controls
- shipping rules persist and preserve Baleares Correos plus mainland MRW defaults
- orders runtime consumes refresh tracking label and shipping settings
- label creation revalidates against the carrier actually selected
- MRW preflight blocks label creation when parcel dimensions are missing
- orders use searchable selects for growing catalogs and SelectField for tracking enum
- all static settings-specific layout classes used by SettingsPage have a CSS definition
- transport tariff parser can use AI but safely falls back without auto-activation
- tariff parser is generic and preserves document table structure
- tariff parser spends AI only when local extraction is insufficient and sends original PDF when needed
- Orders exposes bulk label generation and configurable post-create downloads
