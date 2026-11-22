import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'yaml';
import {compare} from '../build/core/compare.js';
import {parseSpec,resolve} from '../build/core/parse.js';
import {validate,counterexample,lowerBound,upperBound} from '../build/core/schema.js';
import {parseFixtures} from '../build/core/fixtures.js';
import {examples,exampleDocuments} from '../build/examples.js';
import {markdown,exitCode} from '../build/core/report.js';
const spec=(schema,direction='request',version='3.0.4')=>({openapi:version,info:{title:'Contracts',version:'1'},paths:{'/jobs':{post:{...(direction==='request'?{requestBody:{required:true,content:{'application/json':{schema}}}}:{}),responses:{'200':{description:'OK',...(direction==='response'?{content:{'application/json':{schema}}}:{})}}}}}});
const run=(a,b,direction='request',version='3.0.4')=>compare(JSON.stringify(spec(a,direction,version)),JSON.stringify(spec(b,direction,version)));
for(const c of examples())test(`published ${c.id} case has expected verdict and deterministic reports`,()=>{const r=compare(c.baseline,c.candidate,c.fixtures);assert.equal(r.verdict,c.expected);assert.deepEqual(r,compare(c.baseline,c.candidate,c.fixtures));});
const scenarios=[
['request enum expansion',{type:'string',enum:['a']},{type:'string',enum:['a','b']},'request','PASS'],
['request enum removal',{type:'string',enum:['a','b']},{type:'string',enum:['a']},'request','BLOCK'],
['response enum expansion',{type:'string',enum:['a']},{type:'string',enum:['a','b']},'response','BLOCK'],
['response enum narrowing',{type:'string',enum:['a','b']},{type:'string',enum:['a']},'response','PASS'],
['integer input widens to number',{type:'integer'},{type:'number'},'request','PASS'],
['number input narrows to integer',{type:'number'},{type:'integer'},'request','BLOCK'],
['integer output widens to number',{type:'integer'},{type:'number'},'response','BLOCK'],
['number output narrows to integer',{type:'number'},{type:'integer'},'response','PASS'],
['request maximum shrinks',{type:'integer',maximum:64},{type:'integer',maximum:32},'request','BLOCK'],
['request maximum expands',{type:'integer',maximum:32},{type:'integer',maximum:64},'request','PASS'],
['response maximum expands',{type:'integer',maximum:32},{type:'integer',maximum:64},'response','BLOCK'],
['response minimum shrinks',{type:'number',minimum:0},{type:'number',minimum:-1},'response','BLOCK'],
['request minimum rises',{type:'number',minimum:0},{type:'number',minimum:1},'request','BLOCK'],
['exclusive request minimum',{type:'number',minimum:0},{type:'number',minimum:0,exclusiveMinimum:true},'request','BLOCK'],
['request nullable removed',{type:'string',nullable:true},{type:'string'},'request','BLOCK'],
['request nullable added',{type:'string'},{type:'string',nullable:true},'request','PASS'],
['response nullable added',{type:'string'},{type:'string',nullable:true},'response','BLOCK'],
['request string grows minimum',{type:'string',minLength:1},{type:'string',minLength:2},'request','BLOCK'],
['request string shrinks maximum',{type:'string',maxLength:5},{type:'string',maxLength:4},'request','BLOCK'],
['response string maximum grows',{type:'string',maxLength:4},{type:'string',maxLength:5},'response','BLOCK'],
['request array minimum grows',{type:'array',items:{type:'string'},minItems:1},{type:'array',items:{type:'string'},minItems:2},'request','BLOCK'],
['response array maximum grows',{type:'array',items:{type:'string'},maxItems:2},{type:'array',items:{type:'string'},maxItems:3},'response','BLOCK'],
['array item request narrows',{type:'array',items:{type:'number'}},{type:'array',items:{type:'integer'}},'request','BLOCK'],
['new required input',{type:'object',properties:{id:{type:'string'}}},{type:'object',properties:{id:{type:'string'}},required:['id']},'request','BLOCK'],
['lost response guarantee',{type:'object',properties:{id:{type:'string'}},required:['id']},{type:'object',properties:{id:{type:'string'}}},'response','BLOCK'],
['closed request adds optional input',{type:'object',additionalProperties:false,properties:{id:{type:'string'}}},{type:'object',additionalProperties:false,properties:{id:{type:'string'},tag:{type:'string'}}},'request','PASS'],
['open request adds constrained input',{type:'object',properties:{}},{type:'object',properties:{tag:{type:'string'}}},'request','BLOCK'],
['request object closes',{type:'object'},{type:'object',additionalProperties:false},'request','BLOCK'],
['response object opens',{type:'object',additionalProperties:false},{type:'object'},'response','BLOCK'],
['unsupported pattern',{type:'string'},{type:'string',pattern:'^a'},'request','REVIEW'],
['unsupported format',{type:'string'},{type:'string',format:'uuid'},'request','REVIEW'],
['unsupported composition',{type:'string'},{oneOf:[{type:'string'}]},'request','REVIEW'],
['changed default',{type:'string',default:'a'},{type:'string',default:'b'},'request','REVIEW'],
['boolean schema requires review',{type:'string'},true,'request','REVIEW'],
['schema-valued extra properties',{type:'object'},{type:'object',additionalProperties:{type:'string'}},'request','REVIEW'],
];
for(const [label,a,b,direction,want]of scenarios)test(label,()=>assert.equal(run(a,b,direction).verdict,want));
test('3.1 null union and simultaneous numeric bounds',()=>{assert.equal(run({type:['string','null']},{type:'string'},'request','3.1.1').verdict,'BLOCK');assert.deepEqual(lowerBound({minimum:10,exclusiveMinimum:5}),{value:10,exclusive:false});assert.deepEqual(upperBound({maximum:10,exclusiveMaximum:15}),{value:10,exclusive:false});});
test('3.1 nullable does not silently pass',()=>assert.equal(run({type:'string'},{type:'string',nullable:true},'request','3.1.1').verdict,'REVIEW'));
test('all generated counterexamples prove the directional violation',()=>{for(const [,a,b,direction]of scenarios){if(a===true||b===true)continue;const old=parseSpec(JSON.stringify(spec(a,direction))),next=parseSpec(JSON.stringify(spec(b,direction)));const value=counterexample(old,a,next,b,direction);if(value!==undefined){const vb=validate(old,a,value).verdict,va=validate(next,b,value).verdict;assert.equal(direction==='request'?vb:va,'valid');assert.equal(direction==='request'?va:vb,'invalid');}}});
test('unknown assertions cannot manufacture a witness',()=>{const d=parseSpec(JSON.stringify(spec({})));assert.equal(counterexample(d,{type:'string',pattern:'^x'},d,{type:'integer'},'request'),undefined);});
test('internal references point to the actual component and line',()=>{const a=spec({$ref:'#/components/schemas/Value'});a.components={schemas:{Value:{type:'string',enum:['a','b']}}};const b=structuredClone(a);b.components.schemas.Value.enum=['a'];const r=compare(JSON.stringify(a,null,2),JSON.stringify(b,null,2));const f=r.findings.find(f=>f.rule==='ENUM_VALUES');assert.equal(f.before.pointer,'/components/schemas/Value/enum');assert.ok(f.before.line>1);assert.ok(f.witness);});
test('JSON Pointer escaped component names resolve',()=>{const a=spec({$ref:'#/components/schemas/a~1b~0c'});a.components={schemas:{'a/b~c':{type:'string'}}};const d=parseSpec(JSON.stringify(a));assert.deepEqual(resolve(d,a.paths['/jobs'].post.requestBody.content['application/json'].schema).value,{type:'string'});});
for(const [label,ref]of [['external','https://example.com/schema.json'],['missing','#/components/schemas/Missing'],['invalid escape','#/components/~7']])test(`${label} reference requires review`,()=>assert.equal(run({$ref:ref},{$ref:ref}).verdict,'REVIEW'));
test('recursive references terminate with review',()=>{const s=spec({$ref:'#/components/schemas/Node'});s.components={schemas:{Node:{type:'object',properties:{next:{$ref:'#/components/schemas/Node'}}}}};assert.equal(compare(JSON.stringify(s),JSON.stringify(s)).verdict,'REVIEW');});
test('YAML and JSON have equivalent comparison results',()=>{const a=spec({type:'integer',maximum:64}),b=spec({type:'integer',maximum:32});const r=compare(stringify(a),stringify(b));assert.equal(r.verdict,'BLOCK');assert.ok(r.findings[0].before.line);});
const invalids=[['empty',''],['duplicate keys','openapi: 3.0.4\nopenapi: 3.0.4'],['YAML alias','openapi: 3.0.4\ninfo: &i {title: API, version: "1"}\npaths: *i'],['bad version',JSON.stringify({...spec({}),openapi:'2.0'})],['oversized',' '.repeat(524289)],['unsafe number',JSON.stringify(spec({minimum:9007199254740992}))],['invalid schema type',JSON.stringify(spec({type:'banana'}))],['invalid required',JSON.stringify(spec({type:'object',required:['x','x']}))],['negative size',JSON.stringify(spec({minLength:-1}))]];
for(const[label,input]of invalids)test(`reject ${label}`,()=>assert.throws(()=>compare(input,input)));
test('structurally deep documents are rejected',()=>{const d=spec({});let n=d;for(let i=0;i<50;i++){n.x={};n=n.x;}assert.throws(()=>parseSpec(JSON.stringify(d)),/structural/);});
test('operation removal blocks and addition passes',()=>{const a=spec({}),b=structuredClone(a);delete b.paths['/jobs'];assert.equal(compare(JSON.stringify(a),JSON.stringify(b)).verdict,'BLOCK');assert.equal(compare(JSON.stringify(b),JSON.stringify(a)).verdict,'PASS');});
test('status addition blocks unless covered by old default',()=>{const a=spec({},'response'),b=structuredClone(a);b.paths['/jobs'].post.responses['429']={description:'Limited'};assert.equal(compare(JSON.stringify(a),JSON.stringify(b)).verdict,'BLOCK');a.paths['/jobs'].post.responses.default={description:'Any',content:{'application/json':{schema:{}}}};b.paths['/jobs'].post.responses['429'].content={'application/json':{schema:{}}};assert.equal(compare(JSON.stringify(a),JSON.stringify(b)).counts.breaking,0);});
test('response narrowing is safe, baseline fixture does not invert it',()=>{const a=spec({type:'string',enum:['a','b']},'response'),b=spec({type:'string',enum:['a']},'response');const r=compare(JSON.stringify(a),JSON.stringify(b),[{name:'old output',method:'POST',path:'/jobs',response:{status:200,body:'b',source:'baseline'}}]);assert.equal(r.verdict,'PASS');assert.equal(r.fixtures[0].outcome,'baseline-only');});
test('candidate response provenance can prove a regression',()=>{const r=compare(JSON.stringify(spec({type:'string',enum:['a']},'response')),JSON.stringify(spec({type:'string',enum:['a','b']},'response')),[{name:'new output',method:'POST',path:'/jobs',response:{status:200,body:'b',source:'candidate'}}]);assert.equal(r.fixtures[0].outcome,'regression');assert.ok(r.findings.some(f=>f.rule==='FIXTURE_REGRESSION'));});
test('invalid baseline request fixture requires review',()=>{const t=JSON.stringify(spec({type:'integer'}));const r=compare(t,t,[{name:'bad baseline',method:'POST',path:'/jobs',request:{body:'wrong'}}]);assert.equal(r.verdict,'REVIEW');assert.equal(r.fixtures[0].outcome,'baseline-invalid');});
test('fixture bounds, duplicates, invalid provenance rejected',()=>{const f={name:'one',method:'GET',path:'/jobs',response:{status:200}};assert.throws(()=>parseFixtures([f,f]));assert.throws(()=>parseFixtures([{...f,response:{status:200,source:'mystery'}}]));let o={};const cyc={name:'cycle',method:'POST',path:'/jobs',request:{body:o}};o.self=o;assert.throws(()=>parseFixtures([cyc]),/structural/);});
test('security rules and complex parameter serialization require review',()=>{const d=spec({});d.security=[];d.paths['/jobs'].post.parameters=[{in:'query',name:'ids',schema:{type:'array',items:{type:'string'}}}];const r=compare(JSON.stringify(d),JSON.stringify(d));assert.equal(r.verdict,'REVIEW');assert.ok(r.findings.some(f=>f.detail.includes('scalar')));});
test('Markdown and CI exits expose exact verdict and findings',()=>{for(const c of examples()){const r=compare(c.baseline,c.candidate,c.fixtures);assert.equal(exitCode(r),{PASS:0,BLOCK:1,REVIEW:2}[r.verdict]);assert.match(markdown(r),new RegExp('\\*\\*'+r.verdict+'\\*\\*'));assert.ok(markdown(r).includes('## Scope'));}});
test('browser worker bundle runs the same comparison and error path',async()=>{const messages=[];globalThis.self={postMessage:v=>messages.push(v)};try{await import('../docs/worker.js');for(const c of examples()){self.onmessage({data:c});assert.deepEqual(messages.at(-1).report,compare(c.baseline,c.candidate,c.fixtures));}self.onmessage({data:{baseline:'bad',candidate:'bad'}});assert.ok(messages.at(-1).error);}finally{delete globalThis.self;}});
