# Changelog

Release numbering follows the
[versioning and compatibility policy](VERSIONING.md).

## Unreleased

## 0.3.0

- Replace the SolidTV integration with `@get-air/video/framework` and the
  Air-owned runtime/renderer contracts.
- Add a literal framework `<video>` intrinsic that uses HTML playback by
  default and accepts an installed platform video client such as Tauri.
- Add a structural video-element controller for shared headless media controls.
- Add backend-neutral Canvas, WebGL, and WebGPU hole-punch shader registration.

## 0.2.0

- Remove automatic backend selection and the MediaBunny/WebCodecs backend.
- Default omitted backend selection to explicit HTML and preserve only
  caller-supplied fallback chains.
- Require HTML playback to reach `canplay` and produce video dimensions.

## 0.1.1

- Added an explicit, augmentable adapter-error contract so platform packages
  can preserve their schema-backed typed errors through both Promise and Effect
  clients without coupling core to a platform runtime.
- Preserved registered adapter errors from controller operations while keeping
  unmarked or merely tag-shaped failures normalized as `VideoLoadError`.
- Added an enforced release-consistency gate and documented the independent
  core/platform versioning policy.

## 0.1.0

- Add the DOM-first player/controller API and explicit backend registry.
- Add HTML, Tizen AVPlay, webOS, and Vizio backends.
- Add React, canvas, SolidTV, and Blits integrations.
- Add shared SRT/WebVTT subtitle handling and Request-based transport injection.
- Add controller playback-rate support for HTML and Vizio media elements.
- Add guarded Tizen AVPlay ownership and dedicated cookie/User-Agent streaming properties.
