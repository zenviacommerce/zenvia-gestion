import {expect,it} from 'vitest';
import * as credentials from '../supabase/functions/_shared/tracking/credentialResume';
const sagec={franchiseCode:'0000',subscriberCode:'000001',departmentCode:'D',username:'synthetic-user',password:'synthetic-password'};
it('keeps only SAGEC fields when reading credentials, dropping obsolete and arbitrary fields',()=>{
 expect(credentials.normalizeMrwCredentials).toBeTypeOf('function');
 expect(credentials.normalizeMrwCredentials({...sagec,trackingPassword:'obsolete',tracking_password:'obsolete-alias',unexpected:'discard'})).toEqual(sagec);
});
it('canonicalizes supported SAGEC aliases and rejects non-string values',()=>{
 expect(credentials.normalizeMrwCredentials({codigoFranquicia:' 0000 ',codigoAbonado:'000001',codigoDepartamento:'D',usuario:'user',password:'pass',unexpected:1})).toEqual({...sagec,username:'user',password:'pass'});
 expect(credentials.normalizeMrwCredentials({username:{value:'user'},password:123})).toEqual({});
});
it('merges only permitted nonblank edits, purging obsolete values from both saved and submitted credentials',()=>{
 const merged=credentials.mergeMrwCredentials({...sagec,trackingPassword:'obsolete',tracking_password:'obsolete-alias'},{username:' ',password:'new-password',trackingPassword:'new-obsolete',tracking_password:'new-obsolete-alias',unexpected:'discard'});
 expect(merged).toEqual({...sagec,password:'new-password'});
 expect(JSON.stringify(merged)).not.toMatch(/trackingPassword|tracking_password|obsolete|unexpected/);
});
