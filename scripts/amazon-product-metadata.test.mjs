import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
const source=readFileSync(new URL('../supabase/functions/amazon-sync-product-images/index.ts',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function fromListing('),source.indexOf('Deno.serve'));
const context=vm.createContext({});
vm.runInContext(ts.transpile(helpers),context);
test('listing summary image is recovered without image attributes',()=>{
 assert.equal(context.fromListing({summaries:[{mainImage:{link:'https://example.com/green.jpg',width:500,height:600}}]}).url,'https://example.com/green.jpg');
});
test('catalog selects the largest main image over secondary images',()=>{
 const result=context.fromCatalog({images:[{images:[{variant:'PT01',link:'https://example.com/other.jpg',width:2000,height:2000},{variant:'MAIN',link:'https://example.com/small.jpg',width:100,height:100},{variant:'MAIN',link:'https://example.com/pink.jpg',width:500,height:600}]}]});
 assert.equal(result.url,'https://example.com/pink.jpg');assert.equal(result.width,500);
});
test('empty responses preserve absence rather than inventing metadata',()=>{
 assert.equal(context.fromListing({}),null);assert.equal(context.fromCatalog({}),null);assert.equal(context.fromListingName({}),null);
});
