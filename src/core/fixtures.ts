import { InputError,isObj,LIMITS,type Fixture,type FixtureResult,type Json,type ParsedSpec } from './types.js';
import { validateRequest,validateResponse,type Operation } from './operations.js';
export function parseFixtures(input:unknown):Fixture[]{
  if(typeof input==='string'){try{input=JSON.parse(input);}catch{throw new InputError('Fixtures must be valid JSON');}}
  if(!Array.isArray(input)||input.length>LIMITS.fixtures)throw new InputError('Provide an array of at most 100 fixtures');
  const names=new Set<string>();
  let nodes=0;
  const bound=(v:unknown,depth=0):void=>{if(++nodes>20000||depth>40)throw new InputError('Fixtures exceed structural limits');if(typeof v==='number'&&(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v))))throw new InputError('Fixtures need finite, safe JSON numbers');if(Array.isArray(v))v.forEach(x=>bound(x,depth+1));else if(isObj(v))Object.values(v).forEach(x=>bound(x,depth+1));else if(v!==null&&!['string','number','boolean'].includes(typeof v))throw new InputError('Fixtures must contain JSON values');};
  bound(input);
  for(const f of input){
    if(!isObj(f)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||typeof f.method!=='string'||typeof f.path!=='string'||!f.path.startsWith('/')||(!f.request&&!f.response))throw new InputError('Each fixture needs a name, method, template path, and request and/or response');
    if(names.has(f.name))throw new InputError('Fixture names must be unique');names.add(f.name);
    if(f.request!==undefined&&!isObj(f.request))throw new InputError('Fixture request must be an object');
    if(isObj(f.request)&&f.request.parameters!==undefined&&!isObj(f.request.parameters))throw new InputError('Fixture parameters must be an object');
    if(f.response!==undefined&&(!isObj(f.response)||!Number.isInteger(f.response.status)||Number(f.response.status)<100||Number(f.response.status)>599))throw new InputError('Fixture response needs a valid HTTP status');
    if(isObj(f.response)&&f.response.source!==undefined&&!['baseline','candidate'].includes(String(f.response.source)))throw new InputError('Response fixture source must be baseline or candidate');
    if(new TextEncoder().encode(JSON.stringify(f)).length>65536)throw new InputError('Each fixture must be at most 64 KiB');
  }
  return input as unknown as Fixture[];
}
export function evaluateFixtures(before:ParsedSpec,after:ParsedSpec,oldOps:Map<string,Operation>,newOps:Map<string,Operation>,fixtures:Fixture[]):FixtureResult[]{
  const output:FixtureResult[]=[];
  for(const fixture of fixtures){const operation=fixture.method.toUpperCase()+' '+fixture.path;
    if(fixture.request){const b=validateRequest(before,oldOps.get(operation),fixture),a=validateRequest(after,newOps.get(operation),fixture);const outcome=b.verdict==='unknown'||a.verdict==='unknown'?'review':b.verdict==='invalid'?'baseline-invalid':a.verdict==='invalid'?'regression':'unchanged';output.push({name:fixture.name,operation,direction:'request',before:b,after:a,outcome});}
    if(fixture.response){const b=validateResponse(before,oldOps.get(operation),fixture.response),a=validateResponse(after,newOps.get(operation),fixture.response);const source=fixture.response.source??'baseline';const outcome=b.verdict==='unknown'||a.verdict==='unknown'?'review':source==='candidate'?(a.verdict==='invalid'?'candidate-invalid':b.verdict==='invalid'?'regression':'unchanged'):(b.verdict==='invalid'?'baseline-invalid':a.verdict==='invalid'?'baseline-only':'unchanged');output.push({name:fixture.name,operation,direction:'response',before:b,after:a,outcome});}
  }
  return output;
}
