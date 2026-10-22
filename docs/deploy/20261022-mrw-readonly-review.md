# MRW directo — comprobación solicitada por el propietario

> Actualización posterior del propietario: el dosier MRW 2.3 confirma alta mediante opción 4 y contraseña de seguimiento independiente, facilitada por la franquicia. Este documento conserva el diagnóstico histórico; la configuración vigente está en `docs/runbooks/mrw-tracking-activation.md`. El worker ya no intenta la contraseña SAGEC en seguimiento.

## Resultado con las credenciales existentes

Prueba exclusivamente de lectura, desde servidor, sobre 3 envíos recientes de la cuenta MRW DIRECTA. Credenciales existentes recuperadas dentro del servidor desde Vault, sin copiar sus valores ni XML con destinatarios a logs o al repositorio. No se modificaron credenciales, etiquetas ni estados de pedidos.

Endpoint: https://seguimiento.mrw.es/swc/wssgmntnvs.asmx
Método: POST SOAP 1.1, SeguimientoNumeroEnvioMRWNacional.
SOAPAction: http://www.mrw.es/webservices/seguimiento/SeguimientoNumeroEnvioMRWNacional
Campos: Franquicia, Cliente, Password, NumeroMRW, Referencia vacía, Agrupado=N.
Se usaron franchiseCode/subscriberCode/password existentes de SAGEC, sin trackingPassword configurada. El contrato de este método NO tiene campo UserName; no se inventó uno.

| Muestra | HTTP | Estado de la respuesta | SOAP Fault | Resultado |
|---|---:|---|---|---|
| 1 | 200 | false | no | Error de acceso al seguimiento de envíos. |
| 2 | 200 | false | no | Error de acceso al seguimiento de envíos. |
| 3 | 200 | false | no | Error de acceso al seguimiento de envíos. |

Esto prueba el rechazo de esa combinación por ese endpoint. NO demuestra que todas las cuentas necesiten una contraseña distinta ni cómo se autentica internamente Sendcloud. La equivalencia Cliente=Abonado es la interpretación de integración, no una definición explícita en la ficha del método. No se han probado combinaciones de credenciales por tanteo.

SAGEC: https://sagec.mrw.es/MRWEnvio.asmx publica CancelarEnvio, EtiquetaEnvio/GetEtiquetaEnvio, EtiquetaEnvioInternacional/GetEtiquetaEnvioInternacional, GetPointsByCP, PointsDB/GetPointsDB, TransmEnvio, TransmEnvioEC, TransmEnvioInternacional, TransmitirEnvio y TransmitirEnvioEC. No figura consulta de seguimiento/estado. La lectura desde Edge de su WSDL no completó; la portada respondió HTTP 500 tras redirigir a GenericErrorPage.htm. La lista de operaciones sí se verificó en la documentación oficial accesible públicamente. Un error de WSDL no es prueba de credenciales incorrectas.

Conclusión operativa: no pedir una contraseña nueva todavía como requisito demostrado. Si se contacta con MRW, consultar habilitación del acceso de seguimiento y correspondencia del campo Cliente con el contrato actual; conservar la posibilidad de que las credenciales existentes sean válidas con la configuración correcta. Los envíos MRW creados por Sendcloud siguen su adaptador Sendcloud y no entran en esta prueba.

## Web pública como respaldo

GET https://www.mrw.es/seguimiento/ respondió HTTP 200 HTML, con formulario no abonados POST validar-envio.asp y campo mrw-finder-follow-code. No había marcadores recaptcha/hcaptcha/turnstile/Cloudflare en el contenido inspeccionado.

Se comprobó UN envío propio de MRW directo. El flujo necesita conservar cookies de sesión: sin ellas redirige a envio.asp sin resultado; conservando dos cookies de sesión, POST validar-envio.asp → 302 envio-actual.asp → HTTP 200, HTML de 46.307 caracteres con el número consultado y etiquetas de seguimiento. No hubo CAPTCHA observado en ese flujo. No se guardaron cookies, número ni contenido con PII. La respuesta no es una API JSON documentada y no usa una tabla HTML simple; no se ha implementado un parser de producción ni se ha dado por estable su estructura.

Riesgos: cambios de HTML/JavaScript sin contrato de API; cookies y redirecciones; posibles CAPTCHA/antibots en otras peticiones; límites de frecuencia no publicados; condiciones de uso. El aviso legal y las condiciones publicadas restringen copia/almacenamiento a uso personal/privado y el uso comercial, salvo autorización escrita; esa restricción requiere aclaración/permiso de integración antes de adoptar extracción automática comercial. No es un dictamen jurídico ni una autorización de MRW.

**Decisión del propietario: extracción automática de la web pública descartada sin autorización expresa de MRW.** No se implementa scraping, parser HTML, acceso automatizado por cookies ni un respaldo desde esa web. El único uso previsto es un enlace para que el usuario consulte manualmente la página pública. Cualquier propuesta futura de integración con esa web requiere autorización expresa de MRW y una decisión nueva del propietario.

El diagnóstico temporal quedó desactivado: mrw-readonly-probe devuelve 410 DIAGNOSTIC_FINISHED y ya no accede a Vault, pedidos ni MRW.

Fuentes primarias:
- https://seguimiento.mrw.es/swc/wssgmntnvs.asmx?op=SeguimientoNumeroEnvioMRWNacional
- https://sagec.mrw.es/MRWEnvio.asmx
- https://sagec.mrw.es/MRWEnvio.asmx?op=GetPointsDB
- https://www.mrw.es/seguimiento/
- https://www.mrw.es/uso_MRW_mensajeria/aviso_legal.asp (apartado 5)
- https://www.mrw.es/uso_mrw_mensajeria/transporte_condiciones.asp (apartados 1–3)
