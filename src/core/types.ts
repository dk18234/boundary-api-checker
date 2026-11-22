export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };
export type Severity = 'breaking' | 'review' | 'safe';
export type Direction = 'request' | 'response' | 'operation' | 'coverage';
export interface Location { pointer: string; line?: number }
export interface Finding {
  id: string; rule: string; severity: Severity; direction: Direction;
  operation: string; title: string; detail: string; recommendation: string;
  before: Location; after: Location; previous?: Json; candidate?: Json;
  witness?: { value: Json; acceptedBefore: boolean; acceptedAfter: boolean; explanation: string };
}
export interface SchemaContext {
  document: ParsedSpec; direction: 'request' | 'response'; operation: string;
}
export interface ParsedSpec { value: Obj; text: string; format: 'json' | 'yaml'; version: string; lineOf(pointer: string): number | undefined }
export interface Fixture {
  name: string; method: string; path: string;
  request?: { body?: Json; mediaType?: string; parameters?: Record<string, Json> };
  response?: { status: number; body?: Json; mediaType?: string; source?: 'baseline' | 'candidate' };
}
export interface ValidationResult { verdict: 'valid' | 'invalid' | 'unknown'; errors: string[] }
export interface FixtureResult {
  name: string; operation: string; direction: 'request' | 'response';
  before: ValidationResult; after: ValidationResult;
  outcome: 'regression' | 'unchanged' | 'baseline-only' | 'baseline-invalid' | 'candidate-invalid' | 'review';
}
export interface Report {
  tool: 'Boundary'; engineVersion: '1.0.0'; verdict: 'PASS' | 'BLOCK' | 'REVIEW';
  compatible: boolean; counts: Record<Severity, number>;
  baseline: { title: string; version: string; openapi: string };
  candidate: { title: string; version: string; openapi: string };
  operations: { baseline: number; candidate: number; compared: number };
  findings: Finding[]; fixtures: FixtureResult[];
  scope: string[];
}
export class InputError extends Error { constructor(message: string) { super(message); this.name = 'InputError'; } }
export const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
export const own = (o: Obj, key: string): boolean => Object.hasOwn(o, key);
export const entries = (value: unknown): [string, Json][] => isObj(value) ? Object.entries(value) : [];
export const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const pointerPart = (part: string): string => part.replaceAll('~', '~0').replaceAll('/', '~1');
export const at = (base: string, part: string): string => base + '/' + pointerPart(part);
export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
export const LIMITS = { bytes: 524288, depth: 40, nodes: 20000, operations: 300, findings: 600, fixtures: 100 } as const;
