import { parseSpec, resolve } from './parse.js';
import { operations, body, type Operation } from './operations.js';
import {
  coverage,
  counterexample,
  validate,
  required,
  schemaTypes,
  lowerBound,
  upperBound,
} from './schema.js';
import { evaluateFixtures, parseFixtures } from './fixtures.js';
import {
  at,
  entries,
  InputError,
  isObj,
  LIMITS,
  stable,
  type Obj,
  type Json,
  type ParsedSpec,
  type Finding,
  type Report,
  type Direction,
  type Severity,
} from './types.js';

export function compare(
  baselineText: string,
  candidateText: string,
  fixtureInput: unknown = [],
): Report {
  const before = parseSpec(baselineText, 'Baseline'),
    after = parseSpec(candidateText, 'Candidate');
  const findings: Finding[] = [],
    keys = new Set<string>();
  function add(
    rule: string,
    severity: Severity,
    direction: Direction,
    operation: string,
    title: string,
    detail: string,
    recommendation: string,
    bp: string,
    ap = bp,
    previous?: Json,
    candidate?: Json,
    schemas?: [Json | undefined, Json | undefined],
  ) {
    const key = [rule, severity, direction, operation, bp, ap, title].join('|');
    if (keys.has(key)) return;
    keys.add(key);
    if (findings.length >= LIMITS.findings)
      throw new InputError('Comparison exceeds the 600-finding limit; split the specification');
    const f: Finding = {
      id: '',
      rule,
      severity,
      direction,
      operation,
      title,
      detail,
      recommendation,
      before: { pointer: bp, line: before.lineOf(bp) },
      after: { pointer: ap, line: after.lineOf(ap) },
    };
    if (previous !== undefined) f.previous = previous;
    if (candidate !== undefined) f.candidate = candidate;
    if (schemas && (direction === 'request' || direction === 'response')) {
      const witness = counterexample(before, schemas[0], after, schemas[1], direction);
      if (witness !== undefined)
        f.witness = {
          value: witness,
          acceptedBefore: validate(before, schemas[0], witness).verdict === 'valid',
          acceptedAfter: validate(after, schemas[1], witness).verdict === 'valid',
          explanation:
            direction === 'request'
              ? 'This value is accepted by the baseline schema and rejected by the candidate schema.'
              : 'The candidate schema permits this value, but the baseline consumer schema rejects it.',
        };
    }
    findings.push(f);
  }
  const review = (operation: string, pointer: string, message: string) =>
    add(
      'COVERAGE_REVIEW',
      'review',
      'coverage',
      operation,
      'Manual review required',
      message,
      'Inspect this construct with a full OpenAPI/schema tool or a targeted consumer test.',
      pointer,
    );
  const oldOps = operations(before, review),
    newOps = operations(after, review);
  if (stable(before.value.servers) !== stable(after.value.servers))
    review(
      'ALL',
      '/servers',
      'Server URLs changed; deployment/base-path compatibility is not inferred',
    );
  if (before.version.slice(0, 3) !== after.version.slice(0, 3))
    review('ALL', '/openapi', 'OpenAPI dialect changed; inspect migration semantics');
  const walkCoverage = (doc: ParsedSpec, op: Operation) => {
    for (const p of op.parameters.values())
      coverage(doc, p.value.schema ?? {}, at(p.pointer, 'schema'), (pointer, message) =>
        review(op.key, pointer, message),
      );
    if (op.value.requestBody !== undefined) {
      const b = resolve(doc, op.value.requestBody);
      if (b.issue) review(op.key, at(op.pointer, 'requestBody'), b.issue);
      else inspectContent(doc, b.value!, b.pointer ?? at(op.pointer, 'requestBody'), op.key);
    }
    for (const [code, raw] of entries(op.value.responses)) {
      const p = at(at(op.pointer, 'responses'), code),
        r = resolve(doc, raw);
      if (r.issue) {
        review(op.key, p, r.issue);
        continue;
      }
      if (r.value!.headers !== undefined)
        review(op.key, at(p, 'headers'), 'Response header assertions need manual review');
      if (r.value!.links !== undefined)
        review(op.key, at(p, 'links'), 'Response links are outside this profile');
      inspectContent(doc, r.value!, r.pointer ?? p, op.key);
    }
  };
  function inspectContent(doc: ParsedSpec, container: Obj, pointer: string, operation: string) {
    if (container.content !== undefined && !isObj(container.content))
      throw new InputError(`content must be an object at ${pointer}`);
    for (const [media, raw] of entries(container.content)) {
      if (!isObj(raw)) throw new InputError(`Media type entry must be an object at ${pointer}`);
      if (media !== 'application/json' && !media.endsWith('+json'))
        review(
          operation,
          at(at(pointer, 'content'), media),
          'Only JSON media bodies are validated by fixtures',
        );
      if (raw.encoding !== undefined)
        review(
          operation,
          at(at(at(pointer, 'content'), media), 'encoding'),
          'Media encoding rules need review',
        );
      coverage(
        doc,
        raw.schema ?? {},
        at(at(at(pointer, 'content'), media), 'schema'),
        (p, message) => review(operation, p, message),
      );
    }
  }
  for (const op of oldOps.values()) walkCoverage(before, op);
  for (const op of newOps.values()) walkCoverage(after, op);

  function compareSchema(
    oldRaw: Json | undefined,
    newRaw: Json | undefined,
    direction: 'request' | 'response',
    operation: string,
    bp: string,
    ap: string,
    depth = 0,
    seen = new Set<string>(),
  ) {
    if (depth > 24) {
      review(operation, ap, 'Schema comparison recursion limit reached');
      return;
    }
    const left = resolve(before, oldRaw ?? {}),
      right = resolve(after, newRaw ?? {});
    if (!left.value || !right.value) return;
    const a = left.value,
      b = right.value;
    bp = left.pointer ?? bp;
    ap = right.pointer ?? ap;
    const pair = bp + '|' + ap;
    if (seen.has(pair)) {
      review(operation, ap, 'Recursive comparison needs review');
      return;
    }
    const next = new Set(seen).add(pair);
    const from = direction === 'request' ? a : b,
      to = direction === 'request' ? b : a;
    const emit = (
      rule: string,
      severity: Severity,
      title: string,
      detail: string,
      keyword = '',
      previous?: Json,
      candidate?: Json,
    ) =>
      add(
        rule,
        severity,
        direction,
        operation,
        title,
        detail,
        'Preserve the previous contract, add a versioned endpoint, or coordinate a consumer migration.',
        keyword ? at(bp, keyword) : bp,
        keyword ? at(ap, keyword) : ap,
        previous,
        candidate,
        [a, b],
      );
    const lostTypes = [...schemaTypes(from)].filter((type) => !schemaTypes(to).has(type));
    if (lostTypes.length)
      emit(
        'SCHEMA_TYPE',
        'breaking',
        direction === 'request' ? 'Accepted request types narrowed' : 'Response types widened',
        `${direction === 'request' ? 'Previously accepted' : 'Newly permitted response'} types are outside the other contract: ${lostTypes.join(', ')}.`,
        'type',
        a.type ?? 'any',
        b.type ?? 'any',
      );
    else if (stable(a.type) !== stable(b.type) || a.nullable !== b.nullable)
      emit(
        'SCHEMA_TYPE_SAFE',
        'safe',
        'Type change preserves this direction',
        'The supported type set remains compatible for this request/response direction.',
        'type',
        a.type ?? 'any',
        b.type ?? 'any',
      );
    const targetEnum = to.enum;
    if (
      Array.isArray(targetEnum) &&
      (!Array.isArray(from.enum) ||
        from.enum.some((v) => !targetEnum.some((w) => stable(v) === stable(w))))
    )
      emit(
        'ENUM_VALUES',
        'breaking',
        direction === 'request'
          ? 'Accepted enum values removed'
          : 'New response enum values permitted',
        'The source-side value set is not contained in the target-side enum.',
        'enum',
        a.enum ?? 'unconstrained',
        b.enum ?? 'unconstrained',
      );
    else if (stable(a.enum) !== stable(b.enum))
      emit(
        'ENUM_VALUES_SAFE',
        'safe',
        'Enum change preserves this direction',
        'The directional enum value set remains contained.',
        'enum',
        a.enum ?? 'unconstrained',
        b.enum ?? 'unconstrained',
      );
    const lf = lowerBound(from),
      lt = lowerBound(to),
      uf = upperBound(from),
      ut = upperBound(to);
    if (schemaTypes(from).has('number') || schemaTypes(from).has('integer')) {
      if (lt.value > lf.value || (lt.value === lf.value && lt.exclusive && !lf.exclusive))
        emit(
          'NUMERIC_MINIMUM',
          'breaking',
          'Numeric minimum is incompatible',
          'The candidate narrows accepted inputs or widens possible outputs beyond the baseline.',
          'minimum',
          a.minimum ?? a.exclusiveMinimum ?? 'none',
          b.minimum ?? b.exclusiveMinimum ?? 'none',
        );
      if (ut.value < uf.value || (ut.value === uf.value && ut.exclusive && !uf.exclusive))
        emit(
          'NUMERIC_MAXIMUM',
          'breaking',
          'Numeric maximum is incompatible',
          'The source range contains values outside the target range.',
          'maximum',
          a.maximum ?? a.exclusiveMaximum ?? 'none',
          b.maximum ?? b.exclusiveMaximum ?? 'none',
        );
    }
    for (const [min, max, kind] of [
      ['minLength', 'maxLength', 'string'],
      ['minItems', 'maxItems', 'array'],
    ] as const)
      if (schemaTypes(from).has(kind)) {
        const fmin = typeof from[min] === 'number' ? from[min] : 0,
          tmin = typeof to[min] === 'number' ? to[min] : 0,
          fmax = typeof from[max] === 'number' ? from[max] : Infinity,
          tmax = typeof to[max] === 'number' ? to[max] : Infinity;
        if (tmin > fmin)
          emit(
            'SIZE_MINIMUM',
            'breaking',
            `${kind === 'string' ? 'String length' : 'Array size'} minimum is incompatible`,
            'A permitted source-side value can be shorter than the target allows.',
            min,
            a[min] ?? 0,
            b[min] ?? 0,
          );
        if (tmax < fmax)
          emit(
            'SIZE_MAXIMUM',
            'breaking',
            `${kind === 'string' ? 'String length' : 'Array size'} maximum is incompatible`,
            'A permitted source-side value can exceed the target limit.',
            max,
            a[max] ?? 'unbounded',
            b[max] ?? 'unbounded',
          );
      }
    if (schemaTypes(from).has('object')) {
      const oldRequired = required(a),
        newRequired = required(b),
        lost =
          direction === 'request'
            ? newRequired.filter((k) => !oldRequired.includes(k))
            : oldRequired.filter((k) => !newRequired.includes(k));
      for (const name of lost)
        emit(
          'REQUIRED_FIELD',
          'breaking',
          direction === 'request'
            ? `Request now requires ${name}`
            : `Response no longer guarantees ${name}`,
          direction === 'request'
            ? 'An existing client can omit this newly required field.'
            : 'An existing consumer can rely on this previously guaranteed field.',
          'required',
          oldRequired,
          newRequired,
        );
      const pa = isObj(a.properties) ? a.properties : {},
        pb = isObj(b.properties) ? b.properties : {};
      const propNames = new Set([...Object.keys(pa), ...Object.keys(pb)]);
      for (const name of [...propNames].sort()) {
        const sourceProps = direction === 'request' ? pa : pb,
          targetProps = direction === 'request' ? pb : pa;
        const sourceExists =
            Object.hasOwn(sourceProps, name) || from.additionalProperties !== false,
          targetExists = Object.hasOwn(targetProps, name) || to.additionalProperties !== false;
        if (!sourceExists) continue;
        if (!targetExists) {
          emit(
            'PROPERTY_NOT_ALLOWED',
            'breaking',
            direction === 'request'
              ? `Request field ${name} is rejected`
              : `New response field ${name} violates a closed consumer schema`,
            'The source permits a field that the target schema disallows.',
            'properties',
            a.properties ?? {},
            b.properties ?? {},
          );
          continue;
        }
        // Required-field loss already explains this missing guarantee; avoid redundant type findings.
        if (lost.includes(name)) continue;
        compareSchema(
          pa[name] ?? {},
          pb[name] ?? {},
          direction,
          operation,
          at(at(bp, 'properties'), name),
          at(at(ap, 'properties'), name),
          depth + 1,
          next,
        );
      }
      if (from.additionalProperties !== false && to.additionalProperties === false)
        emit(
          'ADDITIONAL_PROPERTIES',
          'breaking',
          direction === 'request'
            ? 'Requests no longer accept additional fields'
            : 'Responses may add fields forbidden by the old contract',
          'Open versus closed object semantics changed in an incompatible direction.',
          'additionalProperties',
          a.additionalProperties ?? true,
          b.additionalProperties ?? true,
        );
    }
    if (schemaTypes(from).has('array')) compareSchemaArray();
    function compareSchemaArray() {
      if (a.items !== undefined || b.items !== undefined)
        compareSchema(
          a.items ?? {},
          b.items ?? {},
          direction,
          operation,
          at(bp, 'items'),
          at(ap, 'items'),
          depth + 1,
          next,
        );
    }
    if (stable(a.default) !== stable(b.default))
      emit(
        'DEFAULT_CHANGED',
        'review',
        'Default value changed',
        'Defaults can alter application behavior, which structural compatibility cannot prove.',
        'default',
        a.default ?? null,
        b.default ?? null,
      );
  }
  function content(
    a: Obj,
    b: Obj,
    direction: 'request' | 'response',
    op: string,
    bp: string,
    ap: string,
  ) {
    const ca = isObj(a.content) ? a.content : {},
      cb = isObj(b.content) ? b.content : {};
    const source = direction === 'request' ? ca : cb,
      target = direction === 'request' ? cb : ca;
    // Removing a declared response representation also breaks content negotiation consumers.
    for (const media of Object.keys(ca))
      if (!Object.hasOwn(cb, media))
        add(
          'MEDIA_REMOVED',
          'breaking',
          direction,
          op,
          `Media type ${media} removed`,
          'An existing consumer can still request or send this declared representation.',
          'Keep the representation available during migration.',
          at(at(bp, 'content'), media),
          at(at(ap, 'content'), media),
          media,
          null,
        );
    for (const media of Object.keys(cb))
      if (!Object.hasOwn(ca, media))
        add(
          'MEDIA_ADDED',
          direction === 'response' ? 'review' : 'safe',
          direction,
          op,
          `Media type ${media} added`,
          direction === 'response'
            ? 'Response content negotiation and defaults require review.'
            : 'Existing declared request representations remain available.',
          'Verify negotiated behavior with a consumer fixture.',
          at(bp, 'content'),
          at(at(ap, 'content'), media),
          null,
          media,
        );
    for (const [media, raw] of entries(ca)) {
      const other = cb[media];
      if (isObj(raw) && isObj(other))
        compareSchema(
          raw.schema ?? {},
          other.schema ?? {},
          direction,
          op,
          at(at(at(bp, 'content'), media), 'schema'),
          at(at(at(ap, 'content'), media), 'schema'),
        );
    }
  }
  let compared = 0;
  for (const [key, oldOp] of oldOps) {
    const newOp = newOps.get(key);
    if (!newOp) {
      add(
        'OPERATION_REMOVED',
        'breaking',
        'operation',
        key,
        'Endpoint removed',
        'An existing client can still call this method and path.',
        'Keep the old route during a versioned migration.',
        oldOp.pointer,
        oldOp.pointer,
        key,
        null,
      );
      continue;
    }
    compared++;
    if (oldOp.value.operationId !== newOp.value.operationId)
      review(
        key,
        at(oldOp.pointer, 'operationId'),
        'operationId changed; generated SDK names may change',
      );
    for (const [id, p] of oldOp.parameters) {
      const next = newOp.parameters.get(id);
      if (!next) {
        add(
          'PARAMETER_REMOVED',
          'breaking',
          'request',
          key,
          `Parameter ${id} removed`,
          'A declared client input was removed; ignoring it can change behavior.',
          'Preserve the declared input or version the operation.',
          p.pointer,
          at(newOp.pointer, 'parameters'),
          p.value.name,
          null,
        );
        continue;
      }
      if (p.value.required !== true && next.value.required === true)
        add(
          'PARAMETER_REQUIRED',
          'breaking',
          'request',
          key,
          `Parameter ${id} is now required`,
          'An existing client can omit this formerly optional input.',
          'Keep it optional or provide a compatible server default.',
          p.pointer,
          next.pointer,
          false,
          true,
        );
      compareSchema(
        p.value.schema ?? {},
        next.value.schema ?? {},
        'request',
        key,
        at(p.pointer, 'schema'),
        at(next.pointer, 'schema'),
      );
    }
    for (const [id, p] of newOp.parameters)
      if (!oldOp.parameters.has(id))
        add(
          'PARAMETER_ADDED',
          p.value.required === true ? 'breaking' : 'safe',
          'request',
          key,
          `${p.value.required === true ? 'Required' : 'Optional'} parameter ${id} added`,
          p.value.required === true
            ? 'Existing clients do not send this newly required input.'
            : 'Previously declared inputs remain accepted.',
          'Use an optional input or version the operation.',
          at(oldOp.pointer, 'parameters'),
          p.pointer,
          null,
          p.value.name,
        );
    const a = body(before, oldOp),
      b = body(after, newOp);
    if (a && !b)
      add(
        'REQUEST_BODY_REMOVED',
        'breaking',
        'request',
        key,
        'Declared request body removed',
        'Existing clients can still send this documented payload.',
        'Keep accepting the old body during migration.',
        a.pointer,
        at(newOp.pointer, 'requestBody'),
      );
    else if (!a && b)
      add(
        'REQUEST_BODY_ADDED',
        b.value.required === true ? 'breaking' : 'safe',
        'request',
        key,
        `${b.value.required === true ? 'Required' : 'Optional'} request body added`,
        'Check whether existing clients can still omit the body.',
        'Keep the body optional for existing callers.',
        at(oldOp.pointer, 'requestBody'),
        b.pointer,
      );
    else if (a && b) {
      if (a.value.required !== true && b.value.required === true)
        add(
          'REQUEST_BODY_REQUIRED',
          'breaking',
          'request',
          key,
          'Request body is now required',
          'An existing client can send no body.',
          'Keep omission valid or version the operation.',
          a.pointer,
          b.pointer,
          false,
          true,
        );
      content(a.value, b.value, 'request', key, a.pointer, b.pointer);
    }
    const ra = oldOp.value.responses as Obj,
      rb = newOp.value.responses as Obj;
    for (const [status, raw] of entries(rb)) {
      const previous = ra[status] ?? ra.default,
        ap = at(at(newOp.pointer, 'responses'), status),
        bp = at(at(oldOp.pointer, 'responses'), Object.hasOwn(ra, status) ? status : 'default');
      if (previous === undefined) {
        add(
          'RESPONSE_STATUS_ADDED',
          'breaking',
          'response',
          key,
          `Undeclared response status ${status} added`,
          'The candidate may return a status outside the old consumer contract.',
          'Add a consumer migration or retain the previous response behavior.',
          at(oldOp.pointer, 'responses'),
          ap,
          null,
          status,
        );
        continue;
      }
      const oldR = resolve(before, previous),
        newR = resolve(after, raw);
      if (oldR.value && newR.value)
        content(oldR.value, newR.value, 'response', key, oldR.pointer ?? bp, newR.pointer ?? ap);
    }
    for (const status of Object.keys(ra))
      if (!Object.hasOwn(rb, status))
        add(
          'RESPONSE_STATUS_REMOVED',
          'safe',
          'response',
          key,
          `Response status ${status} no longer declared`,
          'This narrows the set of declared outputs; added statuses are checked separately.',
          'Check behavioral consumers and status expectations with replay.',
          at(at(oldOp.pointer, 'responses'), status),
          at(newOp.pointer, 'responses'),
          status,
          null,
        );
  }
  for (const [key, op] of newOps)
    if (!oldOps.has(key))
      add(
        'OPERATION_ADDED',
        'safe',
        'operation',
        key,
        'Endpoint added',
        'Previously declared operations remain independently checked.',
        'No migration is required for this addition alone.',
        op.pointer,
        op.pointer,
        null,
        key,
      );
  const fixtures = evaluateFixtures(before, after, oldOps, newOps, parseFixtures(fixtureInput));
  for (const f of fixtures)
    if (
      f.outcome === 'regression' ||
      ['review', 'baseline-invalid', 'candidate-invalid'].includes(f.outcome)
    )
      add(
        'FIXTURE_' + f.outcome.toUpperCase().replaceAll('-', '_'),
        f.outcome === 'regression' ? 'breaking' : 'review',
        f.direction,
        f.operation,
        `Fixture: ${f.name}`,
        f.outcome === 'regression'
          ? 'A saved client request is rejected, or a candidate response is outside the old consumer schema.'
          : 'Fixture validity or supported coverage is insufficient for a compatibility claim.',
        'Inspect the before/after validation errors in the fixture panel.',
        oldOps.get(f.operation)?.pointer ?? '/paths',
        newOps.get(f.operation)?.pointer ?? '/paths',
      );
  findings.sort(
    (a, b) =>
      ({ breaking: 0, review: 1, safe: 2 })[a.severity] -
        { breaking: 0, review: 1, safe: 2 }[b.severity] ||
      a.operation.localeCompare(b.operation) ||
      a.after.pointer.localeCompare(b.after.pointer) ||
      a.rule.localeCompare(b.rule) ||
      a.title.localeCompare(b.title),
  );
  findings.forEach((f, i) => (f.id = 'BND-' + String(i + 1).padStart(3, '0')));
  const counts = {
    breaking: findings.filter((f) => f.severity === 'breaking').length,
    review: findings.filter((f) => f.severity === 'review').length,
    safe: findings.filter((f) => f.severity === 'safe').length,
  };
  const verdict = counts.breaking ? 'BLOCK' : counts.review ? 'REVIEW' : 'PASS';
  return {
    tool: 'Boundary',
    engineVersion: '1.0.0',
    verdict,
    compatible: verdict === 'PASS',
    counts,
    baseline: {
      title: String((before.value.info as Obj).title),
      version: String((before.value.info as Obj).version),
      openapi: before.version,
    },
    candidate: {
      title: String((after.value.info as Obj).title),
      version: String((after.value.info as Obj).version),
      openapi: after.version,
    },
    operations: { baseline: oldOps.size, candidate: newOps.size, compared },
    findings,
    fixtures,
    scope: [
      'OpenAPI 3.0.x / 3.1.x JSON media and scalar parameter contracts',
      'Requests: previous accepted values must remain accepted',
      'Responses: candidate permitted values must fit the old consumer schema',
      'Internal nonrecursive references only; no reference network requests',
      'Unknown constructs require review and cannot pass the CI gate',
      'Structural contracts are not proof of application behavior or universal compatibility',
    ],
  };
}
