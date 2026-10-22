import {expect,it} from 'vitest';
import {DEFAULT_USER_PREFERENCES,normalizeUserPreferences} from '../src/services/settingsSchema';
import {DASHBOARD_KPI_DEFAULTS,selectedPreferenceKeys} from '../src/services/uiPreferences';
const added=['orderVat','orderNet','orderAverage','orderTransport'];
it('adds the four moved financial metrics once to legacy explicit preferences without restoring hidden legacy cards',()=>{
 const normalized=normalizeUserPreferences({dashboardKpis:['sales','pendingOrders']});
 expect(normalized.warnings).toEqual([]);
 expect(normalized.value.dashboardKpis).toEqual(['sales','pendingOrders',...added]);
 expect(normalized.value.dashboardKpis).not.toContain('orderValue');
 expect(normalized.value.dashboardKpis).not.toContain('expenses');
 expect(normalized.value).toHaveProperty('dashboardKpisVersion',1);
});
it('preserves later user choices through JSON persistence and repeated normalization',()=>{
 const migrated=normalizeUserPreferences({dashboardKpis:['orderValue','pendingOrders']}).value;
 const chosen={...migrated,dashboardKpis:migrated.dashboardKpis.filter(key=>key!=='orderVat'&&key!=='orderTransport')};
 const persisted=JSON.parse(JSON.stringify(chosen));
 expect(normalizeUserPreferences(persisted).value.dashboardKpis).toEqual(['orderValue','pendingOrders','orderNet','orderAverage']);
 expect(normalizeUserPreferences(normalizeUserPreferences(persisted).value).value).toEqual(normalizeUserPreferences(persisted).value);
});
it('keeps implicit defaults as defaults and introduces all five cards for default users',()=>{
 const normalized=normalizeUserPreferences({dashboardKpis:[]});
 expect(normalized.value.dashboardKpis).toEqual([]);
 expect(selectedPreferenceKeys(normalized.value.dashboardKpis,DASHBOARD_KPI_DEFAULTS)).toEqual(expect.arrayContaining(['orderValue',...added]));
 expect(DEFAULT_USER_PREFERENCES).toHaveProperty('dashboardKpisVersion',1);
});
it('keeps current explicit choices and does not duplicate financial keys already present in legacy data',()=>{
 expect(normalizeUserPreferences({dashboardKpisVersion:1,dashboardKpis:['pendingOrders']}).value.dashboardKpis).toEqual(['pendingOrders']);
 expect(normalizeUserPreferences({dashboardKpis:['sales','orderVat']}).value.dashboardKpis).toEqual(['sales',...added]);
});
it('upgrades an explicit legacy all-cards selection to all current cards',()=>{
 const legacy=['sales','expenses','result','vatBalance','receivable','pendingExpenses','orders','orderValue','pendingOrders','shippedOrders','cancelledOrders'];
 const migrated=normalizeUserPreferences({dashboardKpis:legacy}).value;
 expect(new Set(migrated.dashboardKpis)).toEqual(new Set(DASHBOARD_KPI_DEFAULTS));
 expect(migrated.dashboardKpis).toHaveLength(DASHBOARD_KPI_DEFAULTS.length);
});
