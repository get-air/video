# Air video

`@get-air/video` owns Air's platform-neutral video controller. Playback
platforms plug into its backend contract, so applications keep one API.

## Platforms

| Runtime | Backend | Playback path | Selection |
| --- | --- | --- | --- |
| Browser | `html` | `<video>` | Automatic |
| Browser | `mediabunny` | MediaBunny → WebCodecs → DOM canvas | Automatic when installed and decodable |
| Samsung Tizen | `tizen` | AVPlay | Automatic when available |
| LG webOS | `webos` | Platform `<video>` pipeline | Automatic when detected |
| Vizio SmartCast | `vizio` | Platform `<video>` pipeline | Automatic when detected |

MediaBunny renders directly in the DOM and never passes decoded frames through
Tauri or another native bridge. It is an optional dependency and lazy-loaded
only after faster route groups fail.

`auto` proves routes in this order: HTML, native/platform adapters, optional
client decoding, then transcoding adapters. HTML startup must reach `canplay`.
When WebCodecs is available, a lazy MediaBunny metadata probe also verifies that
every advertised audio/video track can decode before HTML is accepted. This is
deliberately conservative because portable HTML has no embedded-audio selector:
an unsupported default such as TrueHD must not be hidden by a decodable AC-3
alternate. A video-only success therefore cannot silently discard audio. The
same injected `@get-air/http` transport powers that range probe, so
Tauri can inspect cross-origin sources without weakening CORS. Applications can
override route groups and observe every attempt:

```ts
const attempts = []
const player = await attachVideo(video, {
  source,
  routing: {
    order: ['html', 'native', 'client', 'transcode'],
    onAttempt: (attempt) => attempts.push(attempt),
  },
})
```

Codec support comes from the runtime's WebCodecs or platform decoder. webOS and
Vizio are HTML-backed integrations, not vendor-certified native adapters.

Tauri plugs into that same controller instead of replacing it:

`@get-air/video` →
[`@get-air/video-tauri`](https://github.com/get-air/tauri-video-plugin)
(`tauri` backend) → `tauri-plugin-video` (Rust/native engines)

The standalone GStreamer fallback plugs into the same registry. It stays last
under `auto`, so compatible sources never pay proxy or transcoding cost:

```ts
import { createVideoClient } from '@get-air/video'
import { TranscodeClient } from '@get-air/transcode'
import { transcodeVideoBackend } from '@get-air/transcode/video'

const transcode = await TranscodeClient.connect({ origin: embeddedOrigin })
const client = createVideoClient({
  adapters: [transcodeVideoBackend({ client: transcode })],
})

const player = await client.attach(video, { source, backend: 'auto' })
```

On Tauri, register both `tauriVideoBackend()` and
`transcodeVideoBackend()`: HTML is proven first, native Tauri is next for local
performance, optional client decoding follows, and GStreamer is the final
fallback. Vizio casting uses the embedded host's tokenized LAN HLS URL rather
than the local native surface.

## Install

```sh
npm install @get-air/video
```

## Use

```ts
import { attachVideo } from '@get-air/video'

const player = await attachVideo(document.querySelector('video')!, {
  source: 'https://media.example/movie.mkv',
  backend: 'auto',
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
