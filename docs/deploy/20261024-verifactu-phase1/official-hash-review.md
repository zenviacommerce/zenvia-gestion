# Revisión de huella oficial — fase 1 SOMBRA

Verificado el 24-10-2026 mediante lectura pública oficial, sin remitir registros.

Fuentes primarias:

- [AEAT, especificación de huella v0.1.2 (27-08-2024)](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf), apartados 2, 3, 5 y 6. PDF descargado en fase 0: SHA256 `f4334c254bb875b417247b54315199f89d75a8c4814dfd1e86efec562653d7de`; sin modificar.
- [AEAT, esquemas técnicos](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/esquemas.html). Contrato fijado: `../20261023-verifactu-phase0/contracts/SuministroInformacion.xsd`.
- [AEAT, FAQ de sistemas VERI*FACTU](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html), diferencias entre modalidades y encadenamiento en ERP.

La especificación prescribe SHA256 sobre UTF8, campos en orden fijo, valores recortados en los extremos, sin alterar espacios interiores. Salida hexadecimal mayúscula de 64 caracteres. La huella anterior queda vacía en el primer registro; su propia huella se calcula igualmente. Los tres ejemplos oficiales se conservan exactamente en `../20261023-verifactu-phase0/hash-vectors.json` y se verifican en `tests/verifactu-hash.test.ts`.

## Contrato local de interoperabilidad SQL / TypeScript

Alta:

```text
IDEmisorFactura={emisor}&NumSerieFactura={serie}&FechaExpedicionFactura={DD-MM-YYYY}&TipoFactura={tipo}&CuotaTotal={decimal2}&ImporteTotal={decimal2}&Huella={anterior_o_vacio}&FechaHoraHusoGenRegistro={timestamp_con_offset}
```

Anulación:

```text
IDEmisorFacturaAnulada={emisor}&NumSerieFacturaAnulada={serie}&FechaExpedicionFacturaAnulada={DD-MM-YYYY}&Huella={anterior_o_vacio}&FechaHoraHusoGenRegistro={timestamp_con_offset}
```

Políticas locales deliberadas: importes mediante cadenas decimales, hasta 12 posiciones enteras y 2 fraccionarias; salida con exactamente dos decimales, sin signo positivo, sin ceros enteros superfluos y sin cero negativo. Rechazar exceso de precisión antes de cualquier conversión SQL; nunca redondear silenciosamente. AEAT admite uno o dos decimales: decimal2 es nuestra elección determinista, que debe coincidir con el contenido persistido y cualquier XML futuro.

Timestamp local limitado a segundos con offset numérico explícito `YYYY-MM-DDTHH:mm:ss±HH:mm`, calendario válido y offset hasta ±14:00. Conservar este texto exacto además del instante; convertirlo a UTC antes de calcular cambia la huella. Este subconjunto excluye deliberadamente `Z` y fracciones aunque `xs:dateTime` sea más amplio. La zona IANA, si se guarda, es metadato local y no entra en esta cadena.

SQL recomendado para una cadena ya validada:

```sql
upper(encode(sha256(convert_to(canonical, 'UTF8')), 'hex'))
```

No utilizar `concat_ws` con valores nulos, serialización JSON, escape URL/XML, ni normalización Unicode. Los constructores rechazan campos requeridos ausentes y huellas previas malformadas. El helper `sha256Hex` es criptográfico genérico; utilizar primero el constructor correspondiente. Esta implementación no valida todos los campos ni reglas del XML completo.

## RegistroEvento y límites

AEAT define un diseño separado `RegistroEvento`, con `HuellaEvento`, campos de sistema, obligado, tipo y fecha/hora del evento; no equivale a guardar una fila en una bitácora de aplicación. La FAQ describe registro de eventos y firma como medidas adicionales de la modalidad NO VERI*FACTU. La fase SOMBRA conserva una bitácora local, sin implementar ni declarar conformidad integral de ese diseño oficial ni de las modalidades reguladas. No remite a AEAT, no firma y no modifica facturas/PDF. Un encadenamiento correcto por sí solo no acredita conformidad integral.

## Evidencia

- RED: prueba escrita antes del módulo; fallo inicial por módulo todavía inexistente.
- GREEN: `npx vitest run tests/verifactu-hash.test.ts`: 25 pruebas, todas correctas.
- Incluye los tres vectores, primer registro, anulación, Unicode UTF8, importes exactos, calendario/offset inválidos y rechazo de datos ausentes.
