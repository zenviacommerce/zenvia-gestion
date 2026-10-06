# Servicio documental local de Gestión

Servicio Python con SQLite y Ollama. Gmail, archivos, cámara y lotes de gastos utilizan el mismo motor. Las ventas y tarifas comparten transporte y extracción, con sus propias validaciones. No invoca OpenAI ni proveedores de IA de pago.

## Preparar el equipo

Requisitos: Python 3.12, Ollama instalado y un modelo con visión. El equipo debe permanecer encendido para analizar documentos. Los trabajos se conservan aunque el servicio se reinicie.

```sh
cd tools/document-worker
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
ollama pull qwen2.5vl:7b
export OLLAMA_MODEL=qwen2.5vl:7b
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export DOCUMENT_WORKER_SECRET=GENERAR_UN_SECRETO_ALEATORIO_DE_AL_MENOS_32_CARACTERES
export DOCUMENT_WORKER_DATA_DIR=/ruta/persistente/zenvia-documentos
python app.py
```

En Windows, activar con `.venv\\Scripts\\Activate.ps1` y definir variables con `$env:NOMBRE="valor"`. El inicio automático se configura en el Programador de tareas con la ruta absoluta a `.venv\\Scripts\\python.exe` y a `app.py`, directorio de trabajo `tools/document-worker`, ejecución al arrancar y reinicio en caso de fallo. En Linux puede utilizarse la unidad incluida `zenvia-documents.service`, adaptando usuario, rutas y archivo de variables.

El puerto local predeterminado es 8787. `DOCUMENT_WORKER_HOST` permite definir la interfaz de escucha. Publicar una URL HTTPS mediante un proxy o túnel del administrador, conservando la cabecera Authorization. Ollama permanece en la interfaz local; solo el servicio autenticado recibe documentos. **Una URL localhost no sirve desde Supabase.**

## Conectar Supabase

Configurar mediante el gestor de secretos de Edge Functions:

- `DOCUMENT_WORKER_URL`: URL HTTPS del servicio, sin barra final.
- `DOCUMENT_WORKER_SECRET`: el mismo secreto del servicio local.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: la integración Gmail ya existente. Cada cuenta necesita refresh token almacenado en Vault; una conexión solo de sesión se rechaza al encolar.

Aplicar las migraciones `persistent_import_*` en orden y desplegar `import-jobs`, `import-worker`, `shopify-orders` y `envia-shipping`. El despliegue debe incluir dependencias relativas de `shared/imports`, `src/services` y `supabase/functions/_shared`. Ambas funciones nuevas verifican sus credenciales en código; se despliegan con `verify_jwt=false`. El worker solo acepta la clave interna del proyecto, nunca el JWT del usuario.

La primera tarea válida registra en Vault la URL del proyecto y la credencial interna del worker desde el runtime del servidor. El navegador no recibe esa credencial. Cron `import-worker` consulta la cola cada minuto; el arranque inmediato es una optimización. Si se rota la clave interna, la siguiente tarea actualiza la credencial del scheduler.

## Comprobación

```sh
curl -H "Authorization: Bearer $DOCUMENT_WORKER_SECRET" https://URL_DEL_SERVICIO/health
python -m unittest discover -s tests
```

`/health` responde 200 solamente si Ollama está accesible y contiene el modelo configurado. La prueba automatizada simula Ollama; no demuestra que el modelo real esté instalado.

La solicitud `/analyze` registra un análisis y responde 202. `/analyses/{id}` recupera su estado y resultado. SQLite permite recuperar análisis en curso al reiniciar. El worker de Supabase consulta resultados sin mantener una petición abierta durante la inferencia. Las extracciones correctas se reutilizan por empresa, tipo, hash del original y versión de reglas. Reanalizar una tarifa fuerza un análisis nuevo. Los fallos permanentes permiten completar gastos y ventas manualmente; los fallos temporales admiten reintentos.

Límites: 20 MB por archivo, 40 páginas por PDF, 50 MB de originales por análisis en Edge, 100 archivos por importación. La cámara conserva sus páginas como un PDF; las facturas que comparten PDF se guardan como candidatos separados. Los abonos y documentos dudosos quedan pendientes de revisión y no se convierten automáticamente en facturas positivas.

## Respaldo y despliegue

Respaldar `DOCUMENT_WORKER_DATA_DIR`, especialmente `jobs.sqlite`, junto con la configuración del servicio. Tras completarse un análisis se elimina el original de la solicitud almacenada en SQLite; el documento autorizado permanece en Storage. El resultado se conserva para reanudar revisiones.

Antes de activar producción, comprobar `/health`, importar un documento real de prueba y cerrar el navegador tras su aceptación. Verificar que Cron termina la tarea y que volver a enviarla no duplica registros. Consultar `docs/validation/persistent-imports.md` para la evidencia y dependencias pendientes.
