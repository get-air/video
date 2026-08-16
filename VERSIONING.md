# Versioning and compatibility

`@get-air/video` is versioned independently from external platform adapters. A
core release is required only when this repository changes; it does not
receive a matching version bump merely because an adapter releases.

## Before 1.0

Pre-1.0 releases use `0.COMPATIBILITY.PATCH`:

- increment `PATCH` for every backward-compatible change, including fixes,
  performance improvements, and additive APIs or capabilities;
- increment `COMPATIBILITY` when existing consumers must change code or can
  observe an incompatible contract change.

Breaking changes include removing or renaming an export, narrowing an accepted
type, changing an event or error shape incompatibly, and changing the meaning
of an existing backend capability or option. A new optional export, backend,
event field, or capability is normally backward-compatible.

For example, `^0.1.4` accepts compatible `0.1.x` releases but not `0.2.0`.
Consumers should use a caret range within one compatibility epoch unless they
have explicitly tested a wider range.

## After 1.0

Starting at `1.0.0`, releases follow standard Semantic Versioning:

- `MAJOR` for backward-incompatible changes;
- `MINOR` for backward-compatible features;
- `PATCH` for backward-compatible fixes.

## Platform-adapter compatibility

Each adapter declares the core versions it supports. Matching version numbers
between `@get-air/video` and an adapter do not imply compatibility. In
particular, `@get-air/video-tauri` and `tauri-plugin-video` are versioned in
lockstep with each other, but independently from this package.

When an adapter needs a new core release, publish and verify the core first.
The adapter can then update its declared core range, refresh registry-backed
lockfiles, and run its complete platform matrix. See the Tauri repository's
[compatibility table](https://github.com/get-air/tauri-video-plugin/blob/main/VERSIONING.md).

## Release rules

- Record every release under an exact `## X.Y.Z` heading in `CHANGELOG.md`.
- Stable GitHub Releases and registry publications use the tag `vX.Y.Z`.
- Published versions are immutable and must never be reused.
- Prereleases use a SemVer identifier such as `0.2.0-next.0`, publish under the
  `next` dist-tag, and never update `latest`.
- A stable release is created only after its exact version-bump commit passes
  local and hosted release gates.
