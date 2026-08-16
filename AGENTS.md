# Air video repository guidance

These instructions apply to the entire `get-air/video` repository. The product
name is **Air**; `@get-air` is the npm scope, not part of the product name.

## Skills

- Before designing, changing, reviewing, or debugging Effect code, read
  `.agents/skills/effect-best-practices/SKILL.md` completely and follow it.
- Before preparing, changing, publishing, or repairing a release, read
  `.agents/skills/air-package-publishing/SKILL.md` completely and follow it.
- Tools that support repository skills can discover these directories. Other
  contributors can open the same files and use them as checklists.

## Repository boundary

- This is an independent repository and npm package, not part of a monorepo.
- Consume other Air packages from the public registry. Do not add `workspace:`,
  cross-repository `file:`, or organizational-root dependencies or lockfiles.
- `@get-air/video` is DOM-first. It owns the shared controller/types, HTML,
  MediaBunny, Tizen AVPlay, webOS/Vizio behavior, framework integrations, and
  Promise and Effect entrypoints.
- Never add Tauri APIs, Rust/native playback, or native-surface compositor code
  here. Those belong in `get-air/tauri-video-plugin`.
- MediaBunny plays directly through DOM/WebCodecs/canvas. Do not route decoded
  frames through Tauri or another native bridge.
- Keep external backends explicit and client-scoped; do not add global
  side-effect registration.

## API and Effect rules

- The package root is plain JavaScript/Promise API; `/effect` is Effect-native.
  Both surfaces delegate to one Effect implementation.
- Promise callers must not construct or inspect Effects, `Option`, or typed
  error channels. Convert those at the boundary.
- Preserve typed, adapter-extensible errors and lifecycle cancellation. Do not
  collapse failures into generic `Error` values.
- Use `@get-air/http` for injected Request-based networking. If caching is
  introduced, use a package-owned namespace through `@get-air/cache`.
- Treat the pinned Effect version and current official documentation as the
  source of truth.

## Verification and releases

- Install with the frozen root lockfile. Keep external example dependencies
  registry-backed; an example in this repository may link this package root.
- Run the focused checks described in `CONTRIBUTING.md`; use `act` to exercise
  the affected GitHub Actions job before a push.
- Media/runtime changes retain the real 3840x2160 qualification gate and its
  frame-rate, drop-rate, range-request, and decoded-copy assertions.
- Follow `VERSIONING.md`; run `npm run check:release` for release metadata.
- Stable publication happens only through GitHub Actions trusted publishing
  with provenance. Never add npm credentials to files, `.env`, or workflows.
- Do not hand-edit generated `dist-js` or qualification artifacts.
