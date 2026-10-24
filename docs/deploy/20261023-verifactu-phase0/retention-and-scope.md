# Ámbito y conservación — decisiones de fase 0

Ámbito confirmado por el propietario: ZENVIA COMMERCE SL no está en SII; exclusivamente VERI*FACTU. Se mantienen series F/R e impuestos actuales. Inventario agregado owner: 27 documentos estándar, 1 emitido y 26 cobrados. No se migra retrospectivamente el legado a una nueva cadena ni se renumera, reemite o remite.

## Matriz inicial de conservación para el núcleo

| Objeto | Regla de diseño |
|---|---|
| Factura emitida, snapshot fiscal, XML, PDF definitivo, enlaces de rectificación y evidencia de remisión | Archivo fiscal independiente de los pedidos; acceso autorizado, integridad, exportación y copia externa inmutable. Plazo mercantil general: 6 años desde el último asiento en libros, con excepciones aplicables |
| Información con efectos en períodos posteriores, créditos fiscales o litigios/comprobaciones | Bloqueo de destrucción mientras esos efectos o procedimientos lo exijan. No calcular una fecha universal como fecha de factura +4 años |
| Operaciones acogidas a OSS, si aplica | Registro específico por 10 años; documentar el cómputo y requisitos del régimen antes de automatizar expiración |
| PII operativa Amazon, payloads y datos logísticos | Su política operativa no arrastra datos fiscales cuya conservación tenga fundamento. Evitar duplicar payloads enteros en el archivo fiscal |
| Certificado de transporte y clave privada | Ciclo de vigencia/rotación/revocación separado. La lectura de facturas conservadas no requiere conservar una clave de transporte caducada; conservar metadatos verificables de la versión utilizada |
| Backups y archivo externo | Retención coherente, legal hold y prueba de restauración; una copia dentro del mismo proyecto no cubre el compromiso de un administrador |

Decisión de implementación inicial: **ninguna purga fiscal automática** en fases 0–1. La prescripción tributaria ordinaria de 4 años no se trata como permiso automático de borrado. Se registra fundamento/hold por documento y se separa el estado comercial del registro fiscal inmutable. Esta matriz no autoriza a borrar, contratar almacenamiento o cambiar datos reales.

OSS: evaluar el umbral común de 10.000 EUR sin IVA para las operaciones B2C intracomunitarias pertinentes, teniendo en cuenta año anterior/en curso y condiciones de establecimiento. Superarlo no activa por sí solo un cambio automático de régimen en Zenvia; documentar la configuración fiscal aplicable. La decisión del propietario permite continuar sin pedir otra validación al asesor.

## Calendario documentado

Se mantiene el objetivo del propietario 1/1/2027. La nota AEAT sobre RDL 15/2025 consultada sigue indicando esa fecha para Sociedades y 1/7/2027 para el resto. Existe además una comunicación de Hacienda de 5/10/2026 que anuncia una **previsión** de aplazamiento hasta octubre de 2028. No se confunde esa previsión con una norma ya aprobada ni se altera el objetivo del proyecto con esta noticia; antes del corte real se contrastará el BOE vigente.

Fuentes primarias consultadas 23/10/2026: [AEAT conservación de libros y efectos posteriores](https://sede.agenciatributaria.gob.es/Sede/impuesto-sobre-sociedades/gestion-impuesto-sobre-sociedades/obligaciones-contables-registrales/conservacion-libros.html), [Código de Comercio, art. 30](https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627), [AEAT régimen de la Unión, registro 10 años](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-iva-2023/capitulo-06-regimenes-especiales-iva/reg-espec-ventas-distancia-entreg-servic/regimen-union.html), [AEAT ventas a distancia](https://sede.agenciatributaria.gob.es/Sede/no-residentes/iva-empresarios-profesionales-no-establecidos/ventas-distancia.html), [nota AEAT de plazos aprobados](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/nota-informativa-ampliacion-plazo-adaptacion-facturacion.html), [previsión Hacienda 5/10/2026](https://www.hacienda.gob.es/sgt/gabsehacienda/nota-informativa-verifactu.pdf).
