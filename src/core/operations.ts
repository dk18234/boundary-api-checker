import { resolve } from './parse.js';
import { at, entries, InputError, isObj, LIMITS, METHODS, type Obj, type ParsedSpec, type Json, type Fixture, type ValidationResult } from './types.js';
import { validate,schemaTypes } from './schema.js';
export interface Operation { method:string; path:string; key:string; pointer:string; value:Obj; pathItem:Obj; parameters:Map<string,{value:Obj;pointer:string}> }
export type Review=(operation:string,pointer:string,message:string)=>void;
export function operations(doc:ParsedSpec,review:Review=()=>{}):Map<string,Operation>{
  const all=new Map<string,Operation>();
  for(const [path,raw] of entries(doc.value.paths)){
    if(path.startsWith('x-'))continue;
    if(!path.startsWith('/'))throw new InputError('Path keys must start with /');
    const pp=at('/paths',path),resolved=resolve(doc,raw);
    if(!resolved.value){review('ALL',pp,resolved.issue!);continue;}const item=resolved.value;
    for(const method of METHODS){
      if(item[method]===undefined)continue;
      if(!isObj(item[method]))throw new InputError(`Operation ${method.toUpperCase()} ${path} must be an object`);
      const value=item[method] as Obj,key=method.toUpperCase()+' '+path,pointer=at(resolved.pointer??pp,method);
      if(!isObj(value.responses)||!Object.keys(value.responses).length)throw new InputError(`${key}: responses must be a nonempty object`);
      if(item.servers!==undefined)review(key,at(resolved.pointer??pp,'servers'),'Path-level server behavior needs review');
      const parameters=new Map<string,{value:Obj;pointer:string}>();
      for(const [list,base] of [[item.parameters,at(resolved.pointer??pp,'parameters')],[value.parameters,at(pointer,'parameters')]] as const){
        if(list===undefined)continue;if(!Array.isArray(list))throw new InputError(`${key}: parameters must be an array`);const scope=new Set<string>();
        for(let i=0;i<list.length;i++){
          let atp=at(base,String(i));const p=resolve(doc,list[i]);if(!p.value){review(key,atp,p.issue!);continue;}const parameter=p.value;atp=p.pointer??atp;
          if(typeof parameter.name!=='string'||!['query','header','path','cookie'].includes(String(parameter.in)))throw new InputError(`${key}: parameter name and location are required`);
          const id=parameter.in+':'+(parameter.in==='header'?parameter.name.toLowerCase():parameter.name);
          if(scope.has(id))throw new InputError(`${key}: duplicate parameter ${id}`);scope.add(id);parameters.set(id,{value:parameter,pointer:atp});
          if(parameter.in==='path'&&parameter.required!==true)throw new InputError(`${key}: path parameters must be required`);
          if(parameter.required!==undefined&&typeof parameter.required!=='boolean')throw new InputError(`${key}: parameter required must be boolean`);
          for(const unsupported of ['content','style','explode','allowReserved','allowEmptyValue'])if(parameter[unsupported]!==undefined)review(key,at(atp,unsupported),`Parameter ${unsupported} behavior needs review`);
          const ps=resolve(doc,parameter.schema??{}).value;
          if(ps&&(schemaTypes(ps).has('array')||schemaTypes(ps).has('object')))review(key,at(atp,'schema'),'Only explicitly scalar parameter schemas are in the supported serialization profile');
          if(parameter.in==='cookie')review(key,atp,'Cookie parameter serialization is outside the replay profile');
        }
      }
      for(const token of path.matchAll(/\{([^}]+)\}/g))if(!parameters.has('path:'+token[1]))throw new InputError(`${key}: template parameter ${token[1]} is not declared`);
      for(const {value:p} of parameters.values())if(p.in==='path'&&!path.includes('{'+String(p.name)+'}'))throw new InputError(`${key}: path parameter ${p.name} has no template segment`);
      for(const unsupported of ['callbacks','security','servers'])if(value[unsupported]!==undefined)review(key,at(pointer,unsupported),`${unsupported} behavior is outside the compatibility profile`);
      for(const status of Object.keys(value.responses as Obj))if(status!=='default'&&!/^[1-5]\d\d$/.test(status))review(key,at(at(pointer,'responses'),status),'Response ranges and nonstandard status keys need review');
      all.set(key,{method:method.toUpperCase(),path,key,pointer,value,pathItem:item,parameters});
      if(all.size>LIMITS.operations)throw new InputError('Document exceeds 300 operations');
    }
  }
  for(const key of ['security','webhooks','jsonSchemaDialect'])if(doc.value[key]!==undefined)review('ALL',at('',key),`${key} behavior is outside the supported compatibility profile`);
  return all;
}
export function body(doc:ParsedSpec,operation:Operation):{value:Obj;pointer:string}|undefined{
  if(operation.value.requestBody===undefined)return undefined;
  const r=resolve(doc,operation.value.requestBody);if(!r.value)return undefined;
  if(r.value.required!==undefined&&typeof r.value.required!=='boolean')throw new InputError('requestBody.required must be boolean');
  return{value:r.value,pointer:r.pointer??at(operation.pointer,'requestBody')};
}
export function response(doc:ParsedSpec,operation:Operation,status:number):{value:Obj;pointer:string}|undefined{
  const responses=operation.value.responses as Obj;const key=Object.hasOwn(responses,String(status))?String(status):Object.hasOwn(responses,'default')?'default':undefined;
  if(!key)return undefined;const r=resolve(doc,responses[key]);return r.value?{value:r.value,pointer:r.pointer??at(at(operation.pointer,'responses'),key)}:undefined;
}
export function schemaAtMedia(value:Obj,media:string):Json|undefined {const c=isObj(value.content)?value.content:{};const m=c[media];return isObj(m)?m.schema??{}:undefined;}
export function validateRequest(doc:ParsedSpec,operation:Operation|undefined,fixture:Fixture):ValidationResult{
  if(!operation)return{verdict:'invalid',errors:['Operation is absent from the contract']};
  const errors:string[]=[],unknown:string[]=[];const append=(v:ValidationResult,label:string)=>{if(v.verdict==='invalid')errors.push(label+': '+v.errors.join('; '));if(v.verdict==='unknown')unknown.push(label+': '+v.errors.join('; '));};
  const params=fixture.request?.parameters??{};
  for(const [key,p] of operation.parameters){if(p.value.required===true&&!Object.hasOwn(params,key))errors.push('Required parameter '+key+' is absent');if(Object.hasOwn(params,key))append(validate(doc,p.value.schema??{},params[key]!),key);}
  const b=body(doc,operation);const present=fixture.request!==undefined&&Object.hasOwn(fixture.request,'body');
  if(b?.value.required===true&&!present)errors.push('Required request body is absent');
  if(present){if(!b)unknown.push('Request body is not declared');else{const media=fixture.request?.mediaType??'application/json',s=schemaAtMedia(b.value,media);if(s===undefined)errors.push('Request media type is not declared');else append(validate(doc,s,fixture.request!.body!), 'Request body');}}
  return{verdict:errors.length?'invalid':unknown.length?'unknown':'valid',errors:errors.length?errors:unknown};
}
export function validateResponse(doc:ParsedSpec,operation:Operation|undefined,fixture:NonNullable<Fixture['response']>):ValidationResult{
  if(!operation)return{verdict:'invalid',errors:['Operation is absent from the contract']};
  const r=response(doc,operation,fixture.status);if(!r)return{verdict:'invalid',errors:['Response status is not declared']};
  const content=isObj(r.value.content)?r.value.content:{};
  if(!Object.hasOwn(fixture,'body'))return Object.keys(content).length?{verdict:'invalid',errors:['Expected a declared response body']}:{verdict:'valid',errors:[]};
  const schema=schemaAtMedia(r.value,fixture.mediaType??'application/json');if(schema===undefined)return{verdict:'invalid',errors:['Response media type is not declared']};return validate(doc,schema,fixture.body!);
}
