# Operations and limits

## Local setup

Use Node 22+ and `npm ci && npm test`. Generate an operator token with a cryptographic random generator, set `ADMIN_TOKEN`, and run `npm start`. The server defaults to `127.0.0.1:8084`. Optional `HOST` and `PORT` variables exist for containers. The Compose host binding remains loopback.

The web workbench computes in the browser and does not send specs to the local API. The API is a separate operator integration: POST a JSON object with `baseline` and `candidate` text plus optional `fixtures` array to `/api/compare`, with `X-Admin-Token`. HTTP 200 carries a report even if its verdict is BLOCK or REVIEW. Consumers must inspect `verdict`; HTTP success is not a compatibility verdict.

| Resource | Limit |
|---|---|
| Each spec | 512 KiB, depth 40, 20,000 visited values |
| Operations | 300 per document |
| Findings | 600, then explicit input error rather than truncation |
| Reference/schema traversal | 24 comparison/validation levels |
| Fixtures | 100 fixtures, 64 KiB each, shared depth/node admission bounds |
| API envelope | 1.2 MB |
| API active requests | Two comparison slots including body intake; excess returns 429 |
| API comparison | Eight-second worker deadline; 96 MiB worker old-generation heap cap |
| Browser comparison | Ten-second worker deadline |
| Replay | Five seconds and 64 KiB response per fixture |

Limits are admission/operational bounds, not a measured throughput or memory guarantee. Parsing happens before some structural limits can be checked; browser/API workers provide an additional isolation boundary. The CLI trusts the local operator's file paths and reads a file before applying its size limit.

## API status codes

- 200: report returned; inspect its verdict.
- 400: malformed envelope, invalid contract, structural limit, or comparison deadline.
- 401: missing/incorrect operator token.
- 404: unsupported endpoint or missing static asset.
- 413: envelope too large.
- 429: both comparison slots occupied.
- 500: unexpected service failure; details are not returned.

The API has no replay endpoint. Constant-time comparison is used after checking token length. Static responses apply a restrictive content security policy, no-sniff headers, and a no-referrer policy. Browser rendering escapes contract values. The API does not implement TLS, multiuser identity, CORS for a separate frontend, audit storage, or a public-service rate limiter. Keep it as a local operator tool; a public service needs a separate deployment/authentication design.

## Replay boundaries

Only HTTP loopback targets resolving from literal numeric host syntax to `127.0.0.1` or `::1` are accepted. DNS hostnames, other IPs, HTTPS, credentials, queries/fragments in the base URL, redirects, cookie parameters, and authorization/cookie/transport fixture headers are rejected. Fixtures can execute state-changing methods, so use a disposable service. The included Research Jobs API is synthetic and does not persist data.

## CI and reproducibility

`npm run build` compiles TypeScript and rebuilds browser assets and examples. `npm test` runs core, worker parity, CLI export/exit, HTTP replay, and API boundary tests. `npm run demo:evidence` writes deterministic example reports into the ignored `reports/` directory and verifies expected CLI exit codes. GitHub Actions checks Node 22 and 24, generated asset freshness, and a real nonroot Docker startup/API smoke test.

Use `npm audit --omit=dev` to inspect production dependencies in your own environment. Dependency versions and the lockfile are committed. No live vulnerability-free or penetration-tested claim is made.
