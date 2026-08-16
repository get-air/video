# Platform behavior

## Automatic selection

`backend: 'auto'` tries registered adapters by descending `autoPriority`.
Built-in priorities select:

1. Samsung Tizen AVPlay when present;
2. webOS or Vizio platform HTML playback when detected;
3. generic HTML playback.

MediaBunny has no automatic priority and must be requested explicitly.

## MediaBunny

MediaBunny is a pure browser backend:

- demuxes supported files, including Matroska, in JavaScript;
- decodes through WebCodecs;
- schedules audio through `AudioContext`;
- presents pooled MediaBunny canvases directly in the DOM;
- loads bytes through `@get-air/http` and HTTP range requests;
- never imports or invokes Tauri.

Cross-origin media servers must allow the application origin with CORS and
must expose byte-range responses (`Accept-Ranges` / `206 Partial Content`) for
efficient seeking and bounded buffering.

Codec availability is still determined by `VideoDecoder.isConfigSupported` /
`AudioDecoder.isConfigSupported` in the runtime. An ordered HTML or platform
adapter can follow MediaBunny when a codec is not decodable.

The default local profile verifies 3840×2160 at 30 FPS. GitHub-hosted release
CI uses a 24 FPS source because its shared runner has no stable hardware
decoder. Neither result is a cadence guarantee for every TV decoder. Use
`AIR_UHD_SOURCE_FPS=60 npm run qualify:uhd` to measure a target device's 4K60
path.

## Samsung Tizen

The `tizen` backend uses `window.webapis.avplay`. Load Samsung's WebAPI library
in the TV application's `index.html`:

```html
<script src="$WEBAPIS/webapis/webapis.js"></script>
```

Remote media origins must also be allowed by the application's `config.xml`
content security policy. Air creates and owns the companion
`<object type="application/avplayer">` required by AVPlay while preserving the
public `<video>` as the common controller and geometry anchor. The adapter maps
its viewport rectangle into AVPlay's fixed 1920×1080 display coordinates.

The adapter uses `prepareAsync` so media preparation does not block the UI
thread. Samsung only allows full track enumeration after asynchronous
preparation once playback is active, so the initially exposed tracks are the
current streams; the complete audio/subtitle list is populated once playback
becomes active.
AVPlay accepts audio and text track selection, not video-track selection.
Selecting no subtitle track uses `setSilentSubtitle(true)`.

AVPlay owns a video plane, so the HTML video element acts as the geometry
anchor. Availability and UHD codec limits depend on the TV model and firmware.

## webOS

The `webos` backend uses the platform's `HTMLVideoElement` media pipeline.
It keeps a distinct backend ID for diagnostics and future webOS-specific
adapters. It does not claim playback-rate changes, programmatic audio-track
selection, arbitrary zoom, or DRM-session setup. A host may configure EME/DRM
outside this API. Codec, DRM, and 4K support depend on the model's media
pipeline and must be qualified on target hardware.

The published JavaScript targets ES2022. Current TV engines can consume it
directly; applications supporting older webOS or Tizen generations must
transpile this package and its dependencies to the engine level they deploy.

## Vizio SmartCast

The `vizio` backend likewise uses HTML media playback with a distinct runtime
diagnostic ID, detected through the SmartCast user agent or `globalThis.VIZIO`.
It is not a vendor-certified native SmartCast integration. Applications must
validate their production codec, streaming, and UHD profile on representative
models.

`suspendWhenHidden` is an adapter option rather than a universal DOM behavior.
The Tauri adapter honors it; the built-in HTML, MediaBunny, and TV backends do
not currently suspend playback solely because the geometry anchor is hidden.

## External/native platforms

Core knows only the `VideoBackendAdapter` contract. A platform package can add
an adapter without changing, bundling, or being detected by this repository.
For Tauri, use `@get-air/video-tauri` and pass its adapter to
`createVideoClient`.

This split keeps ordinary web and TV bundles free of Rust bridge code while
preserving the exact controller and fallback-chain semantics.
