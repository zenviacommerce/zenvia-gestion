# Ajustes del propietario y publicación A · 23/10/2026

Autorización: propietario aprueba A y B por separado después de corregir botones, color, copia al propietario y móvil.

## A: preflight y rollback
Gestión PR289: base producción036c49b78362a67921ffcffea522a4ad81e67a79, rollback READY dpl_BU2EGbbPrHvenTxGPeXAANoovFDN. Platform PR82: base7552bd7cf0b3c9712a0a706741e93875099dc774, rollback READY dpl_H7vDiQhpcxBfRVfJdREkvdvLbose. Restaurar alias al despliegue señalado; sin migraciones SQL ni Edge para A. Confirmar nuevamente ambos destinos antes de fusionar.

Se inventarió «Más acciones» en ambos repos: solo Pedidos contiene esta acción. Se conserva disclosure nativo, menú y todas sus acciones; summary adopta secondary e icono MoreHorizontal. Se comprueban igualdad de altura y fuente mediante DOM en390/1280/1440, claro/oscuro, sin pérdida de acciones ni overflow.

Eyebrow compartido FormModal usa --primary (#0f766e) como LOGÍSTICA. Paquete0.2.0 aún no publicado; tarball de Platform se reconstruye con el mismo código y se actualiza integridad del lockfile.

## Evidencia
Capturas antes/después: [galería](20261023-owner-review/README.md). CI anterior a estos ajustes: Gestión2896/6 verdes b7aa764853ed76706f2cc8a30932bdde1c172a14; B2906/6 verdes9baeab64d950fc1e867e9051594404b522bf6849; Platform82 verdeab6093fa4df37e77e191e10920d94d7d7b89900d. La publicación exige comprobar de nuevo los commits finales.

Build Gestión local correcto; advertencia histórica de chunks>500kB. Ningún dato ni acción de producción modificado durante estas comprobaciones.
