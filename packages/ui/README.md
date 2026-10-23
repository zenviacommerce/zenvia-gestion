# @zenvia/ui 0.2.1

Primitivas de presentación aprobadas de ZENVIA Gestión: PageHeader, KpiGrid, StatCard, FilterBar, Tabs (PageTabs es alias de compatibilidad), DataTable/MobileList, FormModal/FormSection/FormGrid y cabeceras/estado/reset de ordenación.

```tsx
import {PageHeader, KpiGrid, StatCard} from '@zenvia/ui';
import '@zenvia/ui/styles.css';
import '@zenvia/ui/forms.css';
```

ESM con declaraciones TypeScript. React 19.2.1 y lucide-react 0.468.0 son peers externos: el paquete no instala ni empaqueta otra copia de React. Sin Supabase, Auth, servicios, datos ni llamadas de red.

La capa CSS conserva el contrato aprobado y el orden de cascada del host. No es un reset global ni sustituye el tema/base del host (tipografía, superficies .card/.stat, botones y estilos especializados). Gestión conserva esos estilos de aplicación; Platform debe adaptar su base al contrato al migrar sus pantallas. No copiar componentes ni modificar fuentes dentro de node_modules. Los próximos ajustes comunes se publican con una nueva versión, nunca reemplazando un artefacto ya publicado.

Gestión consume el workspace con versión exacta 0.2.1 y construye ese commit; su despliegue no depende de publicar el paquete. Platform consumirá la versión exacta del artefacto publicado, con su lockfile y despliegue propios. Publicar el paquete no despliega ninguna aplicación ni cambia la versión de Platform.

Distribución inicial: tarball npm inmutable en una release de GitHub, generado desde la etiqueta ui-v0.2.1. Workflow manual crea una release en borrador con el tarball y su SHA-256; no la publica automáticamente. No requiere crear una organización npm ni un scope de GitHub Packages distinto del propietario real del repositorio. El paquete lleva private:true para impedir una publicación accidental en un registro público.

Platform podrá descargar ese artefacto una vez, verificar el hash y consumirlo desde vendor/zenvia-ui-0.2.1.tgz con lockfile e integridad; el nombre instalado sigue siendo @zenvia/ui y su manifest mantiene 0.2.1. El código fuente permanece en un único lugar. El binario versionado permite builds independientes sin credenciales de registro en Vercel. La adopción y la publicación del artefacto se harán después de la revisión del propietario. No se ha creado etiqueta ni release.


Parche 0.2.1: ancho completo de Tabs, SearchField/SearchFilters con estilos propios y StatusBadge. Contratos estáticos y geométricos para búsquedas, filtros y paneles.
