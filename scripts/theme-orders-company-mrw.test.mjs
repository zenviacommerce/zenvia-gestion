import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

async function loadShipping(){
  const source=await read('src/services/orderShipping.ts');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function mrwOrder(address2){
  return {
    customerName:'Ray Lavidge',customerEmail:'cliente@example.com',customerPhone:'711083090',
    shippingAddress:{name:'Ray Lavidge',address_line_1:'Calle Marie Curie 1, Bajo Derecha.',address_line_2:address2,house_number:'1',postal_code:'29780',city:'Nerja',country_code:'ES',email:'cliente@example.com',phone_number:'711083090'},
    weightKg:2.12,carrierCode:'mrw',carrierName:'MRW',shippingOptionCode:null,shippingServiceName:null,
  };
}

test('MRW allows 60 characters in address line 2 and rejects 61',async()=>{
  const {validateOrderForCarrier}=await loadShipping();
  const sixty='A'.repeat(60),sixtyOne='A'.repeat(61);
  assert.equal(validateOrderForCarrier(mrwOrder(sixty),'mrw').issues.some(i=>i.field==='address_line_2'),false);
  const issue=validateOrderForCarrier(mrwOrder(sixtyOne),'mrw').issues.find(i=>i.field==='address_line_2');
  assert.ok(issue);
  assert.match(issue.message,/61\/60 caracteres/);
});

test('order editing exposes optional company name and persists it to Sendcloud',async()=>{
  const [modal,orders,tools]=await Promise.all([
    read('src/components/OrderEditModal.tsx'),read('src/services/orders.ts'),read('supabase/functions/sendcloud-order-tools/index.ts'),
  ]);
  assert.match(orders,/companyName\?:string/);
  assert.match(modal,/Nombre de la empresa \(opcional\)/);
  assert.match(modal,/companyName/);
  assert.match(tools,/company_name/);
  assert.match(tools,/input\.companyName/);
  assert.match(tools,/shippingAddress=\{[\s\S]*company_name:/);
});

test('Gestion supports only explicit light and dark themes',async()=>{
  const [schema,settings,app,index,ui]=await Promise.all([
    read('src/services/settingsSchema.ts'),read('src/pages/Settings.tsx'),read('src/App.tsx'),read('index.html'),read('src/services/uiPreferences.ts'),
  ]);
  assert.match(schema,/export type ThemePreference = 'light' \| 'dark'/);
  assert.doesNotMatch(schema,/ThemePreference = [^\n]*system/);
  assert.doesNotMatch(settings,/value:'system'/);
  assert.doesNotMatch(settings,/label:'Sistema'/);
  assert.doesNotMatch(app,/matchMedia/);
  assert.doesNotMatch(app,/preferences\.theme!=='system'/);
  assert.doesNotMatch(ui,/prefersDark/);
  assert.doesNotMatch(index,/prefers-color-scheme/);
});

test('Gestion dark theme covers order editing surfaces',async()=>{
  const css=await read('src/theme-consistency.css');
  for(const selector of ['.ordersEditModal','.ordersEditBody','.ordersManualGrid','.ordersValidationBox']){
    assert.ok(css.includes(selector),'Missing dark coverage for '+selector);
  }
});
