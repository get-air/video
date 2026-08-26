# Contributing to Air video

This repository is the standalone DOM-first Air video package. Please keep
changes inside that boundary; native Tauri playback belongs in
[`get-air/tauri-video-plugin`](https://github.com/get-air/tauri-video-plugin).

## Set up

Use Node.js 24 and install exactly from the committed lockfile:

```sh
npm ci
```

Other Air packages must remain registry dependencies. Do not use a parent
workspace, `workspace:`, or a cross-repository `file:` dependency to make a
change pass locally.

## Design expectations

- Keep playback selection explicit; core provides HTML/TV backends and external
  packages provide native or transcode adapters.
- Keep browser/TV capability claims aligned with implemented behavior.
- Preserve one controller contract and client-scoped backend selection.
- Implement behavior once in Effect, then expose plain Promise and Effect
  boundaries as described in `AGENTS.md`.
- Use `@get-air/http` for injected requests instead of a package-specific
  transport abstraction.

## Validate a change

Start with the smallest relevant test, then run the repository gates:

```sh
npm run check:release
npm run check
npm run build
npm pack --dry-run --ignore-scripts
```

Exercise the package CI job locally with `act` before pushing:

```sh
npm run ci:act
```

Hosted CI remains authoritative for the release environment.

## Versioning and releases

Read [`VERSIONING.md`](VERSIONING.md) before changing a public contract. Every
release needs matching manifest/lock metadata and an exact changelog heading;
`npm run check:release -- --tag vX.Y.Z` validates a proposed stable tag.

Maintainers publish by creating a green `vX.Y.Z` GitHub Release. The release
workflow uses npm trusted publishing with provenance. Normal updates require no
`npm login`, token secret, or local `.env`, and published versions are never
reused.

## Repository skills

Agent-capable tools should load these when the task matches:

- [Effect best practices](.agents/skills/effect-best-practices/SKILL.md)
- [Air package publishing](.agents/skills/air-package-publishing/SKILL.md)

They are also concise review checklists for human contributors. The local
copies are intentional so a standalone clone retains the rules.
