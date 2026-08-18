# Changelog

Release numbering follows the
[versioning and compatibility policy](VERSIONING.md).

## Unreleased

- Require the HTML route to reach `canplay`, not merely metadata.
- Conservatively preflight present audio and video kinds through MediaBunny
  when WebCodecs is available, preventing silent video-only acceptance while
  retaining direct HTML for fully decodable sources.

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
- Add MediaBunny/WebCodecs MKV playback with direct pooled-canvas presentation.
- Add HTML, Tizen AVPlay, webOS, and Vizio backends.
- Add React, canvas, SolidTV, and Blits integrations.
- Add shared SRT/WebVTT subtitle handling and Request-based transport injection.
- Add deterministic 4K browser qualification and release evidence.
- Add controller playback-rate support for HTML and Vizio media elements.
- Add guarded Tizen AVPlay ownership and dedicated cookie/User-Agent streaming properties.
