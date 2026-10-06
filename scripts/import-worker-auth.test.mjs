import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../shared/imports/workerAuth.ts').catch(()=>({}));
test('worker accepts its dedicated internal header when gateway rewrites apikey',()=>{assert.equal(typeof api.workerAuthorized,'function');assert.equal(api.workerAuthorized('sb_secret_internal','sb_secret_internal','rewritten-service-jwt'),true)});
test('browser tokens and missing configuration never authorize the worker',()=>{assert.equal(typeof api.workerAuthorized,'function');assert.equal(api.workerAuthorized('sb_secret_internal',null,'public-key'),false);assert.equal(api.workerAuthorized('',null,''),false);assert.equal(api.workerAuthorized('sb_secret_internal','user-jwt','public-key'),false)});
