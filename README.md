# Air video

`@get-air/video` owns Air's platform-neutral video controller. Playback is
explicit: applications select HTML directly or register a native adapter such
as Tauri. The standalone `@get-air/transcode` package supplies the GStreamer
fallback without coupling this browser package to a server runtime.

## Playback backends

| Runtime | Backend | Playback path |
| --- | --- | --- |
| Browser and Smart TV | `html`, `webos`, or `vizio` | Platform `<video>` |
| Samsung Tizen | `tizen` | AVPlay |
| Tauri | `tauri` from `@get-air/video-tauri` | Native platform engine |
| Browser fallback | `transcode` from `@get-air/transcode` | GStreamer HLS |

There is no automatic backend or client-side demux/decoder. Pass one backend ID
or an explicit ordered fallback list:

```ts
import { createVideoClient } from '@get-air/video'
import { tauriVideoBackend } from '@get-air/video-tauri'
import { transcodeVideoBackend } from '@get-air/transcode/video'

const client = createVideoClient({
  adapters: [
    tauriVideoBackend(),
    transcodeVideoBackend({ client: transcode }),
  ],
})

const player = await client.attach(video, {
  source,
  backend: ['html', 'tauri', 'transcode'],
})
```

HTML must reach `canplay` and produce non-zero video dimensions. A failed
backend advances only through the fallback IDs the caller explicitly supplied.

## Install

```sh
npm install @get-air/video
```

## Basic use

```ts
import { attachVideo } from '@get-air/video'

const player = await attachVideo(document.querySelector('video')!, {
  source: 'https://media.example/movie.mp4',
  backend: 'html',
  autoplay: true,
})

await player.seek(90)
await player.load('https://media.example/next.mp4')
```

## Live playback

Backends report live state and DVR capability through `player.media`:

```ts
if (player.media.live) {
  console.log(player.media.seekable) // true only when a DVR window exists
  console.log(player.media.seekableStartSeconds, player.media.seekableEndSeconds)
}
```

`durationSeconds` is undefined for live media. Seekable live windows use
absolute, moving bounds; non-seekable channels reject direct seek operations
with the normal typed unsupported-feature error. The React and TV players show
a live-relative timeline and a keyboard/remote-accessible Go Live action.

Samsung AVPlay uses `IS_LIVE` and `GET_LIVE_DURATION`, so HLS, DASH, and Smooth
Streaming DVR bounds match the range reported by the television firmware.

## Entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `@get-air/video` | Promise-based DOM and TV API |
| `@get-air/video/effect` | Effect services and typed errors |
| `@get-air/video/react` | React player and TV focus |

The Tauri adapter comes from
[`@get-air/video-tauri`](https://github.com/get-air/tauri-video-plugin).
The transcode adapter comes from
[`@get-air/transcode`](https://github.com/get-air/transcode-client).

[API](docs/api.md) · [Platforms](docs/platforms.md) ·
[Versioning](VERSIONING.md) · [Contributing](CONTRIBUTING.md)

MIT OR Apache-2.0
