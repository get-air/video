---
name: effect-best-practices
description: >-
  Applies Air's Effect service, error, layer, lifecycle, and JavaScript-boundary
  rules to this package.
version: 1.0.0
---

# Effect best practices for Air video

Use this skill whenever Effect services, errors, layers, or Promise/Effect
boundaries are designed, implemented, reviewed, or debugged.

## Required architecture

- Keep one Effect implementation. The package root runs it for ordinary
  Promise callers; `/effect` exposes it without a second business-logic path.
- Run Effects only at the plain-JavaScript application boundary. Never call
  `Effect.runPromise` or `Effect.runSync` inside services.
- Use `Effect.Service` for owned business services and declare dependencies on
  the service. Use externally provided tags/layers only for injected
  infrastructure such as HTTP.
- Compose top-level layers with `Layer.mergeAll` or `Layer.provideMerge`; avoid
  deep, repeated `Layer.provide` chains.
- Name service operations with `Effect.fn` when practical so traces remain
  meaningful.

## Errors and lifecycle

- Model distinct public failures with `Schema.TaggedError` and useful fields,
  including `message`. Keep causes serializable at API boundaries.
- Recover with `catchTag`/`catchTags`; do not erase typed failures with broad
  `catchAll`, generic remapping, thrown exceptions, or unmarked `Error` values.
- Preserve registered adapter errors through attach, fallback, and controller
  operations.
- Use scopes/finalizers for event listeners, media objects, canvases, and
  abort handlers. A destroyed or aborted controller must not leak resources or
  emit detached failures.
- Use structured `Effect.log` rather than `console.log` in Effect code.

## Boundary rules

- Promise callers receive ordinary values and rejected typed errors, never
  `Effect`, `Option`, or unresolved requirements.
- Treat `Option` explicitly inside Effect code and convert absence to ordinary
  JavaScript boundary values where the public Promise API requires it.
- Use the pinned Effect dependency and current official documentation; do not
  assume an API from memory when versions differ.

## Validation

Run all three checks after Effect changes:

```sh
npm run typecheck
npm run check:effect
npm test
```

The Effect language-service diagnostics are a required gate, not an optional
editor hint.

## Maintenance

This is a deliberately scoped copy of the organizational
`effect-best-practices` skill, upstream version 1.0.0. When the upstream skill
changes, review this file and the Tauri repository copy for relevant updates;
do not import unrelated atom, RPC, or application-only guidance.
