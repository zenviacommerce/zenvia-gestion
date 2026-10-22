import test from 'node:test';import assert from 'node:assert/strict';
import {auditTabs,customTabs,customTabStyles} from '../packages/ui/tab-contract.mjs';
test('all application tabs use the shared component',async()=>assert.deepEqual(await auditTabs(),[]));
test('the gate rejects custom roles, selection and visual tab implementations',()=>{
 for(const markup of ['<div role="tablist"/>','<button role={"tab"}/>','<button aria-selected={active}/>','<nav className="customTabs"><button/></nav>','<div className="tabs"><button/></div>','<div className="tabBar"/>','<div className="detail-tabs"/>'])assert.ok(customTabs(markup).length,markup);
 assert.deepEqual(customTabs('<><Tabs value={value}/><div role="tabpanel"/><nav className="mainNavigation"/></>'),[]);
});
test('applications cannot override shared tabs or introduce their own tab styles',()=>{
 for(const css of ['.dsTabs{gap:0}', '.page .dsTabs>button{color:red}', '.customTabs button{display:block}'])assert.ok(customTabStyles(css).length);
 assert.deepEqual(customTabStyles('.settingsTabsLayout{display:flex} .card{padding:10px}'),[]);
});
