# Verification

The automated checks exercise the actual implementation, not a recorded demo. Run `npm test` after `npm ci`.

- Directional behavior: scalar types, enums, nullability, required fields, numeric/size bounds, arrays, and open/closed objects.
- Coverage: unsupported patterns, formats, composition, recursive/external/missing references, security, and complex parameter serialization.
- Parsing: JSON/YAML parity, duplicate keys, aliases, malformed schemas, size/depth limits, unsafe numeric input, and physical reference source locations.
- Evidence: generated witnesses are validated in both directions; unknown source assertions cannot justify one.
- Fixtures: baseline request validity, candidate response provenance, and safe baseline-only response narrowing.
- Adapters: real CLI files/exports/exits, generated browser worker parity, token-protected HTTP compare, bounded API input, safe static file paths, and actual loopback HTTP replay against compatible and incompatible synthetic services.
- Replay boundaries: external targets, redirects, forbidden fixture headers, and oversized responses.

GitHub Actions runs the suite on Node 22 and 24, checks deterministic generated assets, verifies CLI example verdicts, builds the nonroot container, and calls its actual health/compare endpoints. See the repository Actions tab for the specific run; this file does not claim a hosted result before it is observed.

The suite is not a security audit, load test, full OpenAPI conformance suite, universal schema containment proof, or production deployment claim. The browser demo is a real implementation of the bounded rule profile; its examples are synthetic.

## Observed release evidence

Verified implementation commit: [`93f736d`](https://github.com/dk18234/boundary-api-checker/commit/93f736da8466f8f1355b289495bc386e824eca53). [GitHub Actions run](https://github.com/dk18234/boundary-api-checker/actions/runs/44981458369): all three jobs succeeded, with **81 tests** on each Node version and an actual nonroot/read-only container API smoke test. Later documentation/image commits do not change this implementation.

Manual checks on the public workbench exercised all four example verdicts, custom YAML, duplicate-key errors, JSON file upload, request/response filtering, finding search, source line inspection, consumer fixtures, and both downloads. Downloaded JSON and Markdown were compared with serialized shared-engine output and matched exactly. The concrete maximum-change witness was `64`: valid under the baseline maximum of `64`, invalid under the candidate maximum of `32`.

The public project hub lists Boundary as the fourth completed project. The existing portfolio was updated and deployed with its existing audience preserved. Browser screenshots are in `docs/assets/workbench.jpg`. Responsive styles are included; this evidence records desktop interaction checks, not a device/browser compatibility certification.
