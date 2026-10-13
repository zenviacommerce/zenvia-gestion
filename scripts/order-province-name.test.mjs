import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const compile=p=>ts.transpileModule(fs.readFileSync(new URL(p,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const postal=await import('data:text/javascript;base64,'+Buffer.from(compile('../src/services/postalLookup.ts')).toString('base64'));
const vm=await import('node:vm');const context=vm.createContext({postalRegion:postal.postalRegion});const source=fs.readFileSync(new URL('../src/services/orderProvince.ts',import.meta.url),'utf8').replace(/^import .*;\n/m,'');vm.runInContext(ts.transpile(source.replace(/export /g,'')),context);
test('Spanish province code is displayed as the full province and retained for shipping',()=>{
 const address={country_code:'ES',postal_code:'15179',state_province_code:'C'};
 assert.equal(context.orderProvinceName(address),'A Coruña');assert.equal(context.orderProvinceCode(address,'A Coruña'),'C');
 assert.equal(context.orderProvinceName({country_code:'ES',postal_code:'11001',state_province_code:'CA'}),'Cádiz');
});
test('foreign state names are not inferred from Spanish postal prefixes',()=>{
 assert.equal(context.orderProvinceName({country_code:'US',postal_code:'15179',state_province_code:'PA',state_province_name:'Pennsylvania'}),'Pennsylvania');
});
test('manual province changes remain editable',()=>{
 assert.equal(context.orderProvinceCode({country_code:'ES',postal_code:'15179',state_province_code:'C'},'Lugo'),'Lugo');
 assert.equal(context.orderProvinceName({country_code:'ES',postal_code:'15179',state_province_code:'C',state_province_name:'La Coruña'}),'La Coruña');
});
