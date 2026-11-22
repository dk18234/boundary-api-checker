# Learn Boundary from scratch

The project is built first so there is a working reference. You do not need to understand it all today. Later, work through one small stage at a time with explanations, a prediction, a change you make yourself, and a test you can explain.

## 1. See the problem before the code

Open the live workbench. Run “Breaking release”, then “Compatible release”. Look at a request enum change and a response enum change. Write in plain language: “What did the old client send or expect? What can happen after the change?”

Learn: client, server, API, endpoint, request, response, JSON, HTTP method, and status code. No framework knowledge is assumed.

**Small task:** change the candidate request maximum from 32 back to 64 and predict which finding should disappear. Then run it.

## 2. Read a tiny contract

Open `examples/v1.json`. Find `POST /jobs`, `requestBody`, `required`, and the `202` response. Follow `$ref` to the Job schema. Explain `type`, `enum`, `properties`, and `additionalProperties` with an ordinary form analogy.

**Small task:** write a five-field JSON object by hand, validate its commas/quotes, and show a valid versus invalid job request.

## 3. Learn the language through one rule

Read `src/core/types.ts` and the enum comparison in `src/core/compare.ts`. Learn variables, arrays, objects, functions, sets, loops, TypeScript types, and a union type as each appears. Ignore the rest of the file until this rule makes sense.

**Rebuild:** write a standalone function that takes two arrays of strings and returns removed values. Write it without copying the project.

## 4. Add direction

Read the `from` and `to` assignments in `compareSchema`. Requests need the old accepted values to fit the new accepted set. Responses need the new possible values to fit the old consumer set.

**Rebuild:** implement an enum-only checker for requests and responses. Test both `cpu → cpu|gpu` directions. Explain why the answers differ.

## 5. Understand evidence

Read `validate` and `counterexample` in `src/core/schema.ts`. A generated value is only evidence if the correct side accepts it and the other side rejects it. A guessed value is not enough.

**Small task:** produce a witness for an input maximum of 64 becoming 32. Then create a case where a source pattern is unsupported and explain why no valid witness should be claimed.

## 6. Connect files to a command

Read `src/cli.ts`. Learn arguments, async/await, file reads, error handling, JSON output, and exit codes. Run the compatible, breaking, and review examples from the terminal. Inspect `$?` after each command.

**Rebuild:** create a two-file enum checker CLI. Return exit 0 or 1 and write a short JSON report.

## 7. Explain the browser and API

Trace `src/web/app.ts → src/web/worker.ts → compare`. Then trace `src/server.ts → src/server-worker.ts → compare`. Learn the difference between the browser's worker and Node's worker thread, and why a local operator token is not embedded into browser code.

**Small task:** add a new example case, rebuild, and verify the browser runs the same engine result as the CLI. Explain why a static website can run this tool without a backend database.

## 8. Test behavior and replay HTTP

Read one core test, one fixture provenance test, and the real HTTP replay test. Start the synthetic API and compare safe versus breaking service behavior. Learn how a schema promise can differ from an actual server response.

**Small task:** make the service return a different type while leaving its spec unchanged. Show how replay catches the discrepancy and why a static diff alone cannot.

## 9. Own a feature

Implement a small rule after we agree on its exact semantics. Start with examples, write the behavior test, implement the rule, update the rulebook, and review browser/API/CLI parity. A good first feature is a carefully scoped missing bound rule or improved complete-payload witness construction.

Do not add support for a keyword simply by removing its REVIEW finding. It needs parsing, validation, comparison semantics, fixtures, and tests.

## Interview practice after learning

Be able to answer these in your own words:

1. What problem does Boundary solve, and who uses it?
2. Why do request and response enums have opposite compatibility directions?
3. What does PASS actually guarantee, and what does it leave unknown?
4. How do you know a displayed counterexample is real?
5. Why can an optional field addition to an open input schema be incompatible?
6. Why is an old response fixture failing a narrower candidate not automatically a regression?
7. How does one engine run in a browser, CLI, and API?
8. What prevents remote reference fetching and arbitrary external HTTP replay?
9. What do the tests demonstrate? What don't they demonstrate?
10. Which part did you implement or change yourself, and how did you validate it?

## Resume wording

After you can explain and modify the project, a factual bullet is:

> Developed Boundary, an OpenAPI compatibility workbench with a shared TypeScript browser/CLI/API engine, directional contract rules, validated counterexamples, consumer fixtures, CI gates, and bounded local HTTP replay.

Do not invent performance percentages, production adoption, customer impact, or claims of training an AI model. Be straightforward that AI assisted the initial implementation and describe the code you now understand and changes you personally made.
