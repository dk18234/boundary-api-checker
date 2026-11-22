import { resolve } from './parse.js';
import { at, entries, InputError, isObj, stable, type Obj, type Json, type ParsedSpec, type ValidationResult } from './types.js';

const annotations = new Set(['title','description','example','examples','default','deprecated','xml','externalDocs']);
const supported = new Set(['$ref','type','properties','required','items','enum','nullable','additionalProperties','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems']);
const types = ['null','boolean','integer','number','string','object','array'];
export function schemaTypes(s: Obj): Set<string> {
  if (s.type === undefined) return new Set(types);
  const list = Array.isArray(s.type) ? s.type : [s.type];
  const result = new Set(list.filter((v):v is string=>typeof v==='string'));
  if (result.has('number')) result.add('integer');
  if (s.nullable===true && s.type!==undefined) result.add('null');
  return result;
}
export const required = (s: Obj): string[] => Array.isArray(s.required) ? s.required.filter((v):v is string=>typeof v==='string') : [];
export function coverage(document: ParsedSpec, schema: Json | undefined, pointer: string, emit:(pointer:string,message:string)=>void, seen=new Set<Obj>(), depth=0): void {
  const r=resolve(document,schema??{});if(r.issue){emit(pointer,r.issue);return;}const s=r.value!;pointer=r.pointer??pointer;
  if(seen.has(s)||depth>24){emit(pointer,'Recursive schema needs manual review');return;}
  const next=new Set(seen).add(s);
  for(const key of Object.keys(s))if(!supported.has(key)&&!annotations.has(key)&&!key.startsWith('x-'))emit(at(pointer,key),`The ${key} keyword is outside this checker’s supported assertions`);
  if(s.type!==undefined){const list=Array.isArray(s.type)?s.type:[s.type];if(!list.length||list.some(v=>typeof v!=='string'||!types.includes(v)))throw new InputError(`Invalid schema type at ${pointer||'/'}`);if(document.version.startsWith('3.0')&&Array.isArray(s.type))throw new InputError('OpenAPI 3.0 requires a single type; use nullable for null');}
  if(s.properties!==undefined&&!isObj(s.properties))throw new InputError(`properties must be an object at ${pointer}`);
  if(s.required!==undefined&&(!Array.isArray(s.required)||s.required.some(v=>typeof v!=='string')||new Set(s.required).size!==s.required.length))throw new InputError(`required must contain unique strings at ${pointer}`);
  if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length))throw new InputError(`enum must be nonempty at ${pointer}`);
  if(Array.isArray(s.enum)&&s.enum.some(v=>Array.isArray(v)||isObj(v)))emit(at(pointer,'enum'),'Composite enum values require review; only scalar enums are compared');
  if(s.nullable!==undefined&&typeof s.nullable!=='boolean')throw new InputError(`nullable must be boolean at ${pointer}`);
  if(document.version.startsWith('3.1')&&s.nullable!==undefined)emit(at(pointer,'nullable'),'Use a null type union in OpenAPI 3.1; nullable is not a 3.1 validation keyword');
  for(const key of ['minimum','maximum','minLength','maxLength','minItems','maxItems'])if(s[key]!==undefined&&(typeof s[key]!=='number'||!Number.isFinite(s[key])||(['minLength','maxLength','minItems','maxItems'].includes(key)&&(!Number.isInteger(s[key])||Number(s[key])<0))))throw new InputError(`Invalid ${key} at ${pointer}`);
  for(const key of ['exclusiveMinimum','exclusiveMaximum'])if(s[key]!==undefined){if(document.version.startsWith('3.0')&&typeof s[key]!=='boolean')throw new InputError(`${key} must be boolean in OpenAPI 3.0`);if(document.version.startsWith('3.1')&&typeof s[key]!=='number')throw new InputError(`${key} must be numeric in OpenAPI 3.1`);}
  for(const [key,child] of entries(s.properties))coverage(document,child,at(at(pointer,'properties'),key),emit,next,depth+1);
  if(s.items!==undefined)coverage(document,s.items,at(pointer,'items'),emit,next,depth+1);
  if(isObj(s.additionalProperties)){emit(at(pointer,'additionalProperties'),'Schema-valued additionalProperties requires review');coverage(document,s.additionalProperties,at(pointer,'additionalProperties'),emit,next,depth+1);}
  else if(s.additionalProperties!==undefined&&typeof s.additionalProperties!=='boolean')throw new InputError(`additionalProperties must be boolean or schema at ${pointer}`);
}

export function validate(document: ParsedSpec, schema: Json | undefined, value: Json, depth=0): ValidationResult {
  const errors:string[]=[],unknown:string[]=[];
  const result=(known:boolean):ValidationResult=>({verdict:errors.length?'invalid':known&&!unknown.length?'valid':'unknown',errors:errors.length?errors:unknown});
  if(depth>24)return{verdict:'unknown',errors:['Validation depth limit reached']};
  const r=resolve(document,schema??{});if(r.issue)return{verdict:'unknown',errors:[r.issue]};const s=r.value!;
  for(const key of Object.keys(s))if(!supported.has(key)&&!annotations.has(key)&&!key.startsWith('x-'))unknown.push(`Unsupported ${key}`);
  if(document.version.startsWith('3.1')&&s.nullable!==undefined)unknown.push('OpenAPI 3.1 nullable is unsupported');
  const type=value===null?'null':Array.isArray(value)?'array':typeof value==='object'?'object':typeof value==='number'?(Number.isInteger(value)?'integer':'number'):typeof value;
  if(!schemaTypes(s).has(type))errors.push(`Expected ${Array.from(schemaTypes(s)).join(' | ')}, received ${type}`);
  if(Array.isArray(s.enum)&&!s.enum.some(v=>stable(v)===stable(value)))errors.push('Value is outside the declared enum');
  if(typeof value==='number'){
    const lower=lowerBound(s),upper=upperBound(s);
    if(value<lower.value||(value===lower.value&&lower.exclusive))errors.push('Value is below the allowed minimum');
    if(value>upper.value||(value===upper.value&&upper.exclusive))errors.push('Value is above the allowed maximum');
  }
  if(typeof value==='string'){const n=Array.from(value).length;if(typeof s.minLength==='number'&&n<s.minLength)errors.push('String is too short');if(typeof s.maxLength==='number'&&n>s.maxLength)errors.push('String is too long');}
  if(Array.isArray(value)){
    if(typeof s.minItems==='number'&&value.length<s.minItems)errors.push('Array has too few items');if(typeof s.maxItems==='number'&&value.length>s.maxItems)errors.push('Array has too many items');
    if(s.items!==undefined)for(let i=0;i<value.length;i++){const v=validate(document,s.items,value[i]!,depth+1);if(v.verdict==='invalid')errors.push(`Item ${i}: ${v.errors[0]}`);if(v.verdict==='unknown')unknown.push(`Item ${i}: ${v.errors[0]}`);}
  }
  if(isObj(value)){
    for(const key of required(s))if(!Object.hasOwn(value,key))errors.push(`Required field ${key} is absent`);
    const properties=isObj(s.properties)?s.properties:{};
    for(const [key,child] of Object.entries(value)){
      if(Object.hasOwn(properties,key)){const v=validate(document,properties[key],child,depth+1);if(v.verdict==='invalid')errors.push(`${key}: ${v.errors[0]}`);if(v.verdict==='unknown')unknown.push(`${key}: ${v.errors[0]}`);}
      else if(s.additionalProperties===false)errors.push(`Unexpected field ${key}`);
      else if(isObj(s.additionalProperties)){const v=validate(document,s.additionalProperties,child,depth+1);if(v.verdict==='invalid')errors.push(`${key}: ${v.errors[0]}`);if(v.verdict==='unknown')unknown.push(`${key}: ${v.errors[0]}`);}
    }
  }
  return result(true);
}
export function lowerBound(s:Obj):{value:number;exclusive:boolean}{
  const value=typeof s.minimum==='number'?s.minimum:-Infinity;
  if(typeof s.exclusiveMinimum==='number'&&s.exclusiveMinimum>=value)return{value:s.exclusiveMinimum,exclusive:true};
  return{value,exclusive:s.exclusiveMinimum===true};
}
export function upperBound(s:Obj):{value:number;exclusive:boolean}{
  const value=typeof s.maximum==='number'?s.maximum:Infinity;
  if(typeof s.exclusiveMaximum==='number'&&s.exclusiveMaximum<=value)return{value:s.exclusiveMaximum,exclusive:true};
  return{value,exclusive:s.exclusiveMaximum===true};
}

export function sample(document:ParsedSpec,schema:Json|undefined,depth=0):Json|undefined {
  if(depth>12)return undefined;const r=resolve(document,schema??{});if(!r.value)return undefined;const s=r.value;
  if(Array.isArray(s.enum)){const found=s.enum.find(v=>validate(document,s,v,depth).verdict==='valid');if(found!==undefined)return found;}
  const kinds=schemaTypes(s);const properties=isObj(s.properties)?s.properties:{};
  if(kinds.has('object')&&(s.properties!==undefined||s.type==='object')){
    const out:Obj=Object.create(null) as Obj;for(const key of required(s)){const value=sample(document,properties[key]??{},depth+1);if(value===undefined)return undefined;out[key]=value;}return validate(document,s,out).verdict==='valid'?out:undefined;
  }
  if(kinds.has('string')){const n=Math.min(128,Math.max(1,typeof s.minLength==='number'?s.minLength:1));const text='x'.repeat(n);if(validate(document,s,text).verdict==='valid')return text;}
  if(kinds.has('integer')||kinds.has('number')){const l=lowerBound(s);const value=Number.isFinite(l.value)?Math.ceil(l.value)+(l.exclusive&&Number.isInteger(l.value)?1:0):0;if(validate(document,s,value).verdict==='valid')return value;}
  if(kinds.has('array')){const n=Math.min(12,typeof s.minItems==='number'?s.minItems:0),out:Json[]=[];for(let i=0;i<n;i++){const v=sample(document,s.items??{},depth+1);if(v===undefined)return undefined;out.push(v);}if(validate(document,s,out).verdict==='valid')return out;}
  for(const value of [null,false,0,'x',{},[]] as Json[])if(validate(document,s,value).verdict==='valid')return value;
  return undefined;
}
export function counterexample(before:ParsedSpec,oldSchema:Json|undefined,after:ParsedSpec,newSchema:Json|undefined,direction:'request'|'response'):Json|undefined {
  const source=direction==='request'?before:after,target=direction==='request'?after:before;
  const from=direction==='request'?oldSchema:newSchema,to=direction==='request'?newSchema:oldSchema;
  const f=resolve(source,from??{}).value,t=resolve(target,to??{}).value;if(!f||!t)return undefined;
  const candidates:Json[]=[null,false,true,0,1,-1,1.5,'','x','example',{},[]];
  if(Array.isArray(f.enum))candidates.unshift(...f.enum);
  const base=sample(source,from);if(base!==undefined)candidates.unshift(base);
  for(const s of[f,t])for(const key of['minimum','maximum','exclusiveMinimum','exclusiveMaximum'])if(typeof s[key]==='number'){const n=s[key];candidates.push(n,n-1,n+1,n-.5,n+.5);}
  for(const s of[f,t])for(const key of['minLength','maxLength'])if(typeof s[key]==='number')for(const n of[s[key],s[key]-1,s[key]+1])if(n>=0&&n<=256)candidates.push('x'.repeat(n));
  for(const s of[f,t])for(const key of['minItems','maxItems'])if(typeof s[key]==='number')for(const n of[s[key],s[key]-1,s[key]+1])if(n>=0&&n<=24){const v=sample(source,f.items??{})??null;candidates.push(Array.from({length:n},()=>v));}
  if(isObj(base))for(const key of new Set([...Object.keys(isObj(f.properties)?f.properties:{}),...Object.keys(isObj(t.properties)?t.properties:{}),...required(f),...required(t)])){
    const without={...base};delete without[key];candidates.push(without);
    for(const value of[null,0,1.5,'x',false] as Json[])candidates.push({...base,[key]:value});
  }
  return candidates.find(value=>validate(source,from,value).verdict==='valid'&&validate(target,to,value).verdict==='invalid');
}
