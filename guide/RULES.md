# Exact rule profile

## Direction

| Contract | Source set | Target set | Compatibility condition |
|---|---|---|---|
| Requests | Baseline accepted values | Candidate accepted values | Baseline is contained in candidate |
| Responses | Candidate permitted values | Baseline consumer values | Candidate is contained in baseline |

These are structural JSON value contracts. They do not infer side effects, business rules, status frequency, timing, ordering, idempotency, availability, or what a deployed client actually does.

PASS means no blocking or review finding in this bounded profile. It is not a universal compatibility certificate. BLOCK can coexist with REVIEW findings; the report retains both. Any nonzero CLI status fails a normal CI step.

## Rules

| Area | Blocking direction | Other behavior |
|---|---|---|
| Operation | Removed method/template path | Addition compatible |
| Parameter | Declared parameter removed; optional becomes required; new required input | Optional addition compatible; schema compared as request |
| Request body | Removed declared body; newly required body | Optional addition compatible |
| Media types | Previously declared representation removed | Request addition compatible; response addition requires negotiation review |
| Status codes | Added explicit/default status not covered by an old exact status or old default | Removal structurally narrows outputs; behavioral review remains a consumer concern |
| Types | Request accepted types removed; response permitted types added | `integer` is contained in `number`; 3.0 nullable and 3.1 type unions supported |
| Scalar enum | Request value removed; response value added | Composite enums require review |
| Numeric bounds | Request interval narrows; response interval expands | Inclusive/exclusive bounds checked; 3.0 booleans and 3.1 numeric exclusive bounds differ |
| String/array sizes | Request sizes narrow; response sizes expand | Unicode code points counted for string length |
| Required fields | Newly required request field; previously guaranteed response field no longer required | Other requiredness direction compatible |
| Object properties | Source permits a field the target forbids; child schema incompatible | Missing property schema is unconstrained for an open object |
| Extra properties | Request object closes; response object opens against a closed consumer | Schema-valued extra properties require review |
| Arrays | Incompatible item schema or size constraint | Tuple/prefix/composition constructs require review |
| Defaults | Changed default | REVIEW because application behavior is not inferred |
| Generated SDK names | Changed `operationId` | REVIEW |

A newly declared optional constrained field in an **open** baseline request object can be incompatible: the old schema permitted arbitrary values under that name. An addition to a **closed** baseline request object can be compatible because the old client was not allowed to send that field at all. This strict acceptance-set policy is deliberate and can be more conservative than a particular server implementation.

Parameter fixtures carry typed JSON values (`query:limit: 10` conceptually), not raw encoded wire strings. Array/object parameter serialization, cookies, explicit serialization options, and parameter `content` require review. Replay supports scalar path/query/header parameters only. Header names are normalized for parameter matching.

Response status ranges such as `2XX` produce REVIEW; this checker does not expand them into exact statuses. Media negotiation is conservative: removing a declared response media type blocks even if it might narrow raw outputs. A response content schema is treated as requiring a body for fixture validation; use explicit no-content status responses for bodyless cases.

## References and coverage

Supported internal JSON Pointer references resolve to their actual source definitions. Reference validation siblings, recursive references, external references, and unresolved references require review. No remote documents are fetched. Schema annotations and vendor extensions are ignored for validation. Unreferenced components are not traversed on their own.

Unsupported features include `allOf`, `anyOf`, `oneOf`, `not`, conditional schemas, discriminators, patterns, formats, `const`, `multipleOf`, property count limits, unique items, read/write-only semantics, unevaluated properties, boolean schemas, recursive/dynamic references, authentication/security, callbacks, webhooks, response headers, links, custom dialects, and non-JSON body encodings. There is no full OpenAPI conformance validator; the parser validates the structural fields this tool requires and reviews known unsupported contract constructs.

Unknown assertions cause REVIEW even when unchanged. Known validation failures may still be `invalid` in a fixture containing unsupported assertions, but witnesses require a wholly supported `valid` source result. No unsupported feature can justify a witness.

The rule engine is conservative and local. It does not prove satisfiability or remove redundant constraints. For example, a type change combined with enum/bound restrictions can be reported even if a full schema solver could prove the changed region unreachable. Witness search is bounded and incomplete. Absence of a witness does not automatically dismiss a rule finding.

## Consumer fixture provenance

```json
[
  {"name":"existing request","method":"POST","path":"/jobs","request":{"body":{"label":"test","queue":"gpu","cores":8}}},
  {"name":"candidate output","method":"GET","path":"/jobs/{jobId}","response":{"source":"candidate","status":200,"body":{"id":17,"state":"cancelled"}}}
]
```

| Fixture | Before | After | Outcome |
|---|---|---|---|
| Existing request | valid | invalid | Regression / BLOCK |
| Existing request | invalid | any known | Baseline-invalid / REVIEW |
| Candidate response | invalid | valid | Regression / BLOCK |
| Candidate response | any known | invalid | Candidate-invalid / REVIEW |
| Baseline response (default provenance) | valid | invalid | Baseline-only; informational |
| Baseline response | invalid | any known | Baseline-invalid / REVIEW |
| Either | unknown on either side | any | REVIEW |
| Either | valid | valid | Unchanged |

Actual HTTP replay validates the baseline request, executes it against the explicit local target, validates the observed candidate response against both contracts, and reports fixture-specific PASS/BLOCK/REVIEW. A candidate-invalid observed response requires review; it does not become evidence of a valid new output. Replay results do not replace static coverage checks.
