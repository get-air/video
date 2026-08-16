# Air video

`@get-air/video` owns Air's platform-neutral video controller. Playback
platforms plug into its backend contract, so applications keep one API.

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

Tauri plugs into that same controller instead of replacing it:

`@get-air/video` →
[`@get-air/video-tauri`](https://github.com/get-air/tauri-video-plugin)
(`tauri` backend) → `tauri-plugin-video` (Rust/native engines)

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

Every integration uses the same backend contract and can use Tauri on its
supported targets:

| Entrypoint | Purpose | Connect Tauri with |
| --- | --- | --- |
| `@get-air/video` | Promise-based DOM and TV API | `createTauriVideoClient()` |
| `@get-air/video/effect` | Effect services and typed errors | `layerTauriVideoBackend()` |
| `@get-air/video/react` | React player and TV focus | `client` prop |
| `@get-air/video/canvas` | Framework-neutral canvas | `client` option |
| `@get-air/video/solid` | SolidTV helpers | `client` option |
| `@get-air/video/blits` | Blits helpers | `client` option |

The Tauri client and Effect layer come from `@get-air/video-tauri`; framework
imports stay in this package. Canvas-based renderers also need a transparent
video aperture as shown in the
[Tauri examples](https://github.com/get-air/tauri-video-plugin/tree/main/examples).

Release CI plays a real 3840×2160 H.264/AAC MKV and checks cadence, HTTP ranges,
geometry, cleanup, and zero additional decoded-frame copies.

[API](docs/api.md) · [Platforms](docs/platforms.md) ·
[Versioning](VERSIONING.md) · [Contributing](CONTRIBUTING.md)

MIT OR Apache-2.0
