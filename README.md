# Air video

`@get-air/video` is Air's DOM-first video controller for browsers and smart TVs.

## Platforms

| Runtime | Backend | Playback path | Selection |
| --- | --- | --- | --- |
| Browser | `html` | `<video>` | Automatic |
| Browser | `mediabunny` | MediaBunny → WebCodecs → DOM canvas | Explicit |
| Samsung Tizen | `tizen` | AVPlay | Automatic when available |
| LG webOS | `webos` | Platform `<video>` pipeline | Automatic when detected |
| Vizio SmartCast | `vizio` | Platform `<video>` pipeline | Automatic when detected |

MediaBunny renders directly in the DOM and never passes decoded frames through
Tauri or another native bridge. It is lazy-loaded only when requested.

`auto` prefers the detected TV backend, then HTML; it never selects MediaBunny.
Codec support comes from the runtime's WebCodecs or platform decoder. webOS and
Vizio are HTML-backed integrations, not vendor-certified native adapters.

Native Tauri playback lives in
[`@get-air/video-tauri`](https://github.com/get-air/tauri-video-plugin).

## Install

```sh
npm install @get-air/video
```

## Use

```ts
import { attachVideo } from '@get-air/video'

const player = await attachVideo(document.querySelector('video')!, {
  source: 'https://media.example/movie.mkv',
  backend: ['mediabunny', 'html'],
  autoplay: true,
})

await player.seek(90)
await player.load('https://media.example/next.mkv')
```

The ordered backend list provides fallback while keeping one stable controller.

## Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `@get-air/video` | Promise-based DOM and TV API |
| `@get-air/video/effect` | Effect service, layers, controllers, and typed errors |
| `@get-air/video/react` | React player and TV focus helpers |
| `@get-air/video/canvas` | Framework-neutral canvas integration |
| `@get-air/video/solid` | SolidTV helpers |
| `@get-air/video/blits` | Blits helpers |

Release CI plays a real 3840×2160 H.264/AAC MKV and checks cadence, HTTP ranges,
geometry, cleanup, and zero additional decoded-frame copies.

[API](docs/api.md) · [Platforms](docs/platforms.md) ·
[Versioning](VERSIONING.md) · [Contributing](CONTRIBUTING.md)

MIT OR Apache-2.0
