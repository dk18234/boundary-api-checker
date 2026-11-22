import { parseDocument, isAlias, visit, LineCounter } from 'yaml';
import { InputError, isObj, LIMITS, type Json, type ParsedSpec, type Obj } from './types.js';

export function parseSpec(text: string, label = 'Specification'): ParsedSpec {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes)
    throw new InputError(`${label}: input exceeds the 512 KiB limit`);
  if (!text.trim()) throw new InputError(`${label}: input is empty`);
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    version: '1.2',
    uniqueKeys: true,
    lineCounter,
    merge: false,
    strict: true,
  });
  if (document.errors.length || document.warnings.length)
    throw new InputError(
      `${label}: ${document.errors[0]?.message.split('\n')[0] ?? document.warnings[0]?.message.split('\n')[0]}`,
    );
  let aliases = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) aliases = true;
  });
  if (aliases)
    throw new InputError(`${label}: YAML aliases are not supported; expand the values explicitly`);
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  } catch {
    throw new InputError(`${label}: unsupported YAML value`);
  }
  let nodes = 0;
  function bound(v: unknown, depth = 0): void {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth)
      throw new InputError(`${label}: document exceeds structural limits`);
    if (
      typeof v === 'number' &&
      (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))
    )
      throw new InputError(`${label}: non-finite or unsafe integer numbers are not supported`);
    if (Array.isArray(v)) for (const child of v) bound(child, depth + 1);
    else if (isObj(v))
      for (const [key, child] of Object.entries(v)) {
        if (key === '<<') throw new InputError(`${label}: YAML merge keys are not supported`);
        bound(child, depth + 1);
      }
    else if (v !== null && !['string', 'number', 'boolean'].includes(typeof v))
      throw new InputError(`${label}: non-JSON values are not supported`);
  }
  bound(value);
  if (!isObj(value) || typeof value.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(value.openapi))
    throw new InputError(`${label}: expected an OpenAPI 3.0.x or 3.1.x document`);
  if (
    !isObj(value.info) ||
    typeof value.info.title !== 'string' ||
    typeof value.info.version !== 'string' ||
    !isObj(value.paths)
  )
    throw new InputError(`${label}: info.title, info.version and paths are required`);
  const object = value as Obj;
  return {
    value: object,
    text,
    format: text.trim().startsWith('{') ? 'json' : 'yaml',
    version: value.openapi,
    lineOf(pointer) {
      try {
        const parts = pointer
          .split('/')
          .slice(1)
          .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
        let node: unknown = document.contents;
        if (parts.length) node = document.getIn(parts, true);
        const start =
          node && typeof node === 'object' && 'range' in node
            ? (node as { range?: number[] }).range?.[0]
            : undefined;
        return start === undefined ? undefined : lineCounter.linePos(start).line;
      } catch {
        return undefined;
      }
    },
  };
}

export function resolve(
  document: ParsedSpec,
  value: Json | undefined,
  trail: string[] = [],
): { value?: Obj; issue?: string; pointer?: string } {
  if (!isObj(value))
    return { issue: 'Expected an object; boolean schemas and missing objects need review' };
  if (typeof value.$ref !== 'string') return { value };
  const reference = value.$ref;
  if (!reference.startsWith('#/'))
    return {
      issue: `Only internal JSON Pointer references are supported (${reference.slice(0, 120)})`,
    };
  if (trail.includes(reference) || trail.length >= 24)
    return { issue: 'Recursive or excessively deep reference needs review' };
  if (Object.keys(value).some((k) => !['$ref', 'description', 'summary'].includes(k)))
    return { issue: '$ref validation siblings need review; they are not silently ignored' };
  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    return { issue: 'Invalid URI encoding in reference' };
  }
  if (/~(?![01])/.test(pointer)) return { issue: 'Invalid JSON Pointer escape' };
  let target: Json = document.value;
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if ((!isObj(target) && !Array.isArray(target)) || !Object.hasOwn(target, key))
      return { issue: `Unresolved internal reference (${reference.slice(0, 120)})` };
    target = (target as Record<string, Json>)[key]!;
  }
  const result = resolve(document, target, [...trail, reference]);
  return { ...result, pointer: result.pointer ?? pointer };
}
