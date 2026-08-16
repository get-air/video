# Air video

`@get-air/video` is Air's DOM-first video API. It gives browsers and smart-TV
web runtimes one controller contract across:

- MediaBunny + WebCodecs, including MKV playback;
- the native HTML media element;
- Samsung Tizen AVPlay;
- webOS and Vizio browser media;
- React, SolidTV, Blits, and framework-neutral canvas applications.

This repository contains no Tauri runtime code, Rust plugin, or
`@tauri-apps/*` import. Native Tauri playback is supplied separately by
`@get-air/video-tauri` through the public backend-adapter interface.

## Install

```sh
npm install @get-air/video
```

MediaBunny ships as a package dependency so the built-in toggle works without
extra installation or optional-peer bundler failures. Its implementation stays
in a lazy chunk and loads only when the `mediabunny` backend is attempted.

## Browser and MediaBunny

```ts
import { attachVideo } from '@get-air/video'

const anchor = document.querySelector('video')!
const player = await attachVideo(anchor, {
  source: 'https://media.example/movie.mkv',
  backend: ['mediabunny', 'html'],
  autoplay: true,
})

await player.seek(90)
await player.setVolume(0.8)
await player.load('https://media.example/next.mkv', {
  backend: ['mediabunny', 'html'],
})
```

MediaBunny decodes with WebCodecs and presents its pooled canvas directly in
the DOM beside the anchor. It does not proxy through Tauri or copy decoded
frames across a JavaScript/native boundary. The canvas follows the anchor's
viewport geometry and is removed when the controller is destroyed.

`auto` intentionally does not select MediaBunny. It chooses a platform-native
TV API when present, otherwise HTML. Request MediaBunny explicitly when its
container support is wanted.

## 4K support

The MediaBunny release gate generates and plays a real 3840×2160 H.264/AAC MKV,
then verifies:

- the selected track and backing canvas are 3840×2160;
- sustained 30 FPS playback within the release thresholds;
- zero extra decoded-frame copies in the DOM path;
- partial HTTP range requests;
- seek and stable-controller reload;
- correct authored-to-viewport geometry;
- no leaked video or canvas layers.

Run it with:

```sh
npm run qualify:uhd
```

The default local profile verifies 4K30. The GitHub-hosted release gate uses
4K20 because shared runners provide software decoding rather than a stable GPU
decoder. Target-device cadence still depends on its WebCodecs decoder, GPU,
and thermal budget. 4K60 can be tested with `AIR_UHD_SOURCE_FPS=60`; TV and
native adapters can publish stronger hardware profiles without changing this
API.

## External platform adapters

Adapters are explicit and client-scoped—there is no side-effect registration:

```ts
import { createVideoClient } from '@get-air/video'
import { tauriVideoBackend } from '@get-air/video-tauri'

const video = createVideoClient({
  adapters: [tauriVideoBackend()],
})

const player = await video.attach(anchor, {
  source: movie,
  backend: ['mediabunny', 'tauri'],
})
```

An adapter implements `VideoBackendAdapter`. Its string ID remains usable in
ordered fallback chains and with `VideoController.load`.

## TV platforms

| Runtime | Backend | Rendering path |
| --- | --- | --- |
| Browser | `html` | `HTMLVideoElement` |
| Browser | `mediabunny` | MediaBunny → WebCodecs → DOM canvas |
| Samsung Tizen | `tizen` | AVPlay display plane |
| LG webOS | `webos` | Platform HTML media pipeline |
| Vizio SmartCast | `vizio` | Platform HTML media pipeline |

Tizen AVPlay is selected by `auto` when `window.webapis.avplay` exists.
webOS and Vizio use their platform media implementation through the HTML
element while retaining distinct capability IDs and diagnostics. Those IDs
identify the detected runtime; they do not claim vendor certification or a
separate native media integration.

A Tizen host must load `$WEBAPIS/webapis/webapis.js` and allow its media
origins in the application CSP. Air creates and removes Samsung's required
`application/avplayer` object internally; the public `<video>` remains the
stable geometry anchor. AVPlay's display plane is mapped from that anchor to
Samsung's fixed 1920×1080 coordinate space.

## Shared transport and subtitles

MediaBunny and external subtitle requests use the Request-based
`@get-air/http` contract:

```ts
import { createVideoClient } from '@get-air/video'

const video = createVideoClient({
  http: {
    fetch: (request) => fetch(request),
  },
})
```

External WebVTT and SRT tracks work across all backends and emit parsed cues for
the host UI:

```ts
const player = await video.attach(anchor, {
  source: movie,
  subtitles: [{
    id: 'english',
    src: '/captions/movie.en.srt',
    label: 'English',
    language: 'en',
    default: true,
  }],
})

player.on('subtitlecuechange', ({ detail }) => renderCues(detail.cues))
```

## Framework entrypoints

- `@get-air/video/react` — headed React player and TV focus handling.
- `@get-air/video/canvas` — authored canvas coordinates and DOM anchor.
- `@get-air/video/solid` — SolidTV lifecycle and hole-punch helpers.
- `@get-air/video/blits` — Blits helpers built on the canvas adapter.
- `@get-air/video/effect` — Effect-native service, registry layer, and typed
  errors.

React and canvas adapters accept an optional `client`, so platform adapters
remain available without coupling the core package to them.

## Effect API

```ts
import {
  type EffectVideoController,
  VideoBackendRegistryService,
  VideoPlayerService,
  attachVideoEffect,
  layerVideoBackends,
} from '@get-air/video/effect'
```

`VideoBackendRegistryService` is injected infrastructure.
`VideoPlayerService` owns typed selection/fallback behavior and returns an
`EffectVideoController`, whose playback, `load`, telemetry, and lifecycle
operations remain Effects. Promise execution occurs only at the
plain-JavaScript client boundary; services never call `runPromise`.

See [API details](docs/api.md) and [platform behavior](docs/platforms.md).
