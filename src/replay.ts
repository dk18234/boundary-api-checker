import { isIP } from 'node:net';
import { operations, validateRequest, validateResponse } from './core/operations.js';
import { parseSpec } from './core/parse.js';
import { InputError, type Fixture, type Json } from './core/types.js';
export interface ReplayResult {
  fixture: string;
  method: string;
  url: string;
  status?: number;
  requestBaseline: string;
  responseBaseline?: string;
  responseCandidate?: string;
  verdict: 'PASS' | 'BLOCK' | 'REVIEW';
  detail: string;
}
export function loopbackBase(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InputError('Replay needs a valid loopback base URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    !isIP(hostname) ||
    !['127.0.0.1', '::1'].includes(hostname) ||
    url.search ||
    url.hash
  )
    throw new InputError(
      'Replay is limited to literal http://127.0.0.1 or http://[::1] URLs without credentials, query, or fragment',
    );
  return url;
}
export async function replay(
  baselineText: string,
  candidateText: string,
  fixtures: Fixture[],
  baseInput: string,
): Promise<ReplayResult[]> {
  const base = loopbackBase(baseInput),
    before = parseSpec(baselineText),
    after = parseSpec(candidateText),
    oldOps = operations(before),
    newOps = operations(after),
    results: ReplayResult[] = [];
  for (const fixture of fixtures.filter((f) => f.request)) {
    const op = fixture.method.toUpperCase() + ' ' + fixture.path,
      request = validateRequest(before, oldOps.get(op), fixture);
    let path = fixture.path,
      blocked: string | undefined;
    const params = fixture.request?.parameters ?? {},
      headers: Record<string, string> = {
        accept: fixture.response?.mediaType ?? 'application/json',
      };
    if (
      !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
        fixture.method.toUpperCase(),
      )
    )
      blocked = 'Unsupported replay method';
    for (const token of path.matchAll(/\{([^}]+)\}/g)) {
      const value = params['path:' + token[1]];
      if (value === undefined) blocked = 'Missing path parameter';
      else path = path.replace(token[0], encodeURIComponent(String(value)));
    }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      blocked = 'Invalid replay path';
    const url = new URL(base.pathname.replace(/\/$/, '') + path, base.origin);
    if (url.origin !== base.origin) blocked = 'Replay target escaped the loopback origin';
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && typeof value === 'object') {
        blocked = 'Only scalar parameter serialization is supported by replay';
        continue;
      }
      if (key.startsWith('query:')) url.searchParams.append(key.slice(6), String(value));
      if (key.startsWith('header:')) {
        const name = key.slice(7).toLowerCase();
        if (
          [
            'authorization',
            'cookie',
            'host',
            'connection',
            'content-length',
            'transfer-encoding',
            'proxy-authorization',
            'upgrade',
          ].includes(name)
        ) {
          blocked = 'Sensitive or transport headers cannot be replayed from fixtures';
          continue;
        }
        headers[name] = String(value);
      }
      if (key.startsWith('cookie:')) blocked = 'Cookie replay is outside this profile';
    }
    const result: ReplayResult = {
      fixture: fixture.name,
      method: fixture.method.toUpperCase(),
      url: url.href,
      requestBaseline: request.verdict,
      verdict: 'REVIEW',
      detail: '',
    };
    if (blocked || request.verdict !== 'valid') {
      result.detail = blocked ?? 'Baseline request is not valid under the supported profile';
      results.push(result);
      continue;
    }
    try {
      const data =
        fixture.request && Object.hasOwn(fixture.request, 'body')
          ? JSON.stringify(fixture.request.body)
          : undefined;
      if (data !== undefined) {
        if (['GET', 'HEAD'].includes(result.method))
          throw new InputError('GET/HEAD replay with a body is unsupported');
        headers['content-type'] = fixture.request?.mediaType ?? 'application/json';
      }
      const response = await fetch(url, {
        method: result.method,
        headers,
        body: data,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      result.status = response.status;
      const reader = response.body?.getReader();
      let bytes = 0,
        text = '';
      const decoder = new TextDecoder();
      if (reader)
        try {
          for (;;) {
            const read = await reader.read();
            if (read.done) break;
            bytes += read.value.length;
            if (bytes > 65536) throw new InputError('Replay response exceeds 64 KiB');
            text += decoder.decode(read.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          await reader.cancel().catch(() => {});
        }
      const media = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      let payload: Json | undefined;
      if (text) {
        try {
          payload = JSON.parse(text) as Json;
        } catch {
          throw new InputError('Replay response is not JSON');
        }
      }
      const observed = {
        status: response.status,
        mediaType: media || 'application/json',
        ...(payload !== undefined ? { body: payload } : {}),
        source: 'candidate' as const,
      };
      const b = validateResponse(before, oldOps.get(op), observed),
        a = validateResponse(after, newOps.get(op), observed);
      result.responseBaseline = b.verdict;
      result.responseCandidate = a.verdict;
      result.verdict =
        b.verdict === 'invalid'
          ? 'BLOCK'
          : b.verdict === 'unknown' || a.verdict !== 'valid'
            ? 'REVIEW'
            : 'PASS';
      result.detail =
        result.verdict === 'PASS'
          ? 'Observed response fits both contracts.'
          : result.verdict === 'BLOCK'
            ? 'Observed candidate response violates the baseline consumer contract.'
            : 'Observed response could not be validated against both supported contracts.';
    } catch (e) {
      result.detail = e instanceof Error ? e.message : 'Replay failed';
      result.verdict = 'REVIEW';
    }
    results.push(result);
  }
  return results;
}
