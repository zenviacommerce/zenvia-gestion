import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

// Keep the shared Settings contract explicit while the five legacy editors await
// persistence-aware migration. This guard must not force those migrations here.
it('documents the shared section, label, modal collection and persistence contracts',()=>{
 const rules=readFileSync('docs/design-system.md','utf8');
 for(const contract of ['settingsSubsection','settingsSubsectionHead','settingsField > span','settingsFormGridWide','configList','configRow','FormModal','Cancelar','Guardar'])expect(rules).toContain(contract);
 for(const exception of ['Métodos de pago','Reglas de envío','Formatos de paquete','Pesos por SKU','Alias de proveedores'])expect(rules).toContain(exception);
 expect(rules).toContain('El borrador del modal no modifica la colección hasta Guardar');
 expect(rules).toContain('conserva el límite de persistencia');
});
