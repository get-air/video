# API

## Clients

`attachVideo(element, options)` uses the built-in DOM/TV client.
`createVideoClient({ adapters, http })` creates an isolated client with
additional platform adapters or a custom Request transport.

```ts
interface VideoClient {
  attach(
    element: HTMLVideoElement,
    options: AttachVideoOptions,
  ): Promise<VideoController>
}
```

Clients do not mutate global state. Pass the same client to imperative,
React, canvas, SolidTV, and Blits integrations.

## Attachment options

```ts
interface AttachVideoOptions {
  source: string | VideoSource
  backend?: VideoBackend | readonly VideoBackend[]
  fallbackBackends?: readonly VideoBackend[]
  backendOptions?: VideoBackendOptions
  http?: HttpTransport
  surfaceMode?: 'dom' | 'transparent-canvas'
  suspendWhenHidden?: boolean
  autoplay?: boolean
  deviceProfile?: 'auto' | 'mobile' | 'tv' | 'desktop'
  controlRegions?: Element | Iterable<Element>
  subtitles?: readonly ExternalSubtitleTrack[]
  signal?: AbortSignal
}
```

`backend` is an ordered chain. Unavailable adapters are skipped; load failures
continue to the next adapter. `fallbackBackends` is appended and de-duplicated.

External adapter packages augment `VideoBackendOptionsMap` with their own
strongly typed namespace.

## Backend adapters

```ts
interface VideoBackendAdapter {
  readonly id: string
  readonly route?: 'html' | 'native' | 'transcode'
  isAvailable(context: VideoRuntimeContext): boolean | Promise<boolean>
  open(context: VideoBackendOpenContext): Promise<BackendVideoController>
}
```

`open` returns the same internal controller contract implemented by built-in
backends. The public client wraps it in a stable controller before returning.

### Adapter-specific errors

Adapters can extend the typed player error channel without making core depend
on a platform package. Register the error type with module augmentation and
mark each rejected instance explicitly:

```ts
import { markVideoPlayerError } from '@get-air/video'
import { Schema } from 'effect'

class AdapterProtocolError extends Schema.TaggedError<AdapterProtocolError>()(
  'AdapterProtocolError',
  { message: Schema.String },
) {}

declare module '@get-air/video' {
  interface VideoPlayerErrorMap {
    AdapterProtocolError: AdapterProtocolError
  }
}

throw markVideoPlayerError(new AdapterProtocolError({
  message: 'The adapter and native runtime use different protocols',
}))
```

Marked errors retain their class, tag, and fields through both Promise and
Effect clients, including controller operations. Unmarked or merely
tag-shaped failures are normalized to `VideoLoadError`.

## Controller

```ts
interface VideoController {
  readonly element: HTMLVideoElement
  readonly sessionId: string
  readonly capabilities: PlayerCapabilities
  readonly media: MediaInfo
  readonly tracks: readonly MediaTrack[]

  load(source: string | VideoSource, options?: VideoLoadOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(positionSeconds: number): Promise<void>
  selectTrack(kind: TrackKind, trackId?: string): Promise<void>
  setVolume(volume: number): Promise<void>
  setPlaybackRate(rate: number): Promise<void>
  setVideoFit(mode: 'fit' | 'cover' | 'stretch'): Promise<void>
  setVideoZoom(scale: number): Promise<void>
  stats(): Promise<SessionStats>
  bufferedAhead(): number
  playbackQuality(): PlaybackQuality
  refreshLayout(): void
  registerControls(target: Element | Iterable<Element>): () => void
  destroy(): Promise<void>
}
```

`load` replaces the active backend session without replacing the public
controller, DOM anchor, or event subscriptions. Because two renderers cannot
safely own one anchor at once, replacement closes the previous backend first.
If opening the replacement fails, other operations report a typed
`VideoControllerStateError`; a later `load()` can recover the same controller.

## Events

`on(type, listener)` returns an unsubscribe function. Supported events:

- `timeupdate`
- `bufferprogress`
- `trackchange`
- `backendchange`
- `subtitlecuechange`
- `error`

## Capabilities

`PlayerCapabilities` reports the active backend, container/codec policy, HDR,
rate, volume, fit/zoom, track selection, custom headers, and frame-accurate
seeking. `'platform'` means the runtime/decoder decides.

`playbackRate: true` means `setPlaybackRate` delegates to the active backend;
the platform may still reject a particular rate. `customHeaders` refers to the
arbitrary `VideoSource.headers` map. A backend can support dedicated source
properties without claiming arbitrary headers—for example, Tizen maps
`cookies` and `userAgent` to AVPlay streaming properties while leaving
`customHeaders: false`.

## Effect entrypoint

`@get-air/video/effect` exports:

- `VideoPlayerService`
- `VideoBackendRegistryService`
- `layerVideoBackends`
- `attachVideoEffect`
- `EffectVideoController`
- `VideoBackendUnavailableError`
- `VideoControllerStateError`
- `VideoFeatureUnavailableError`
- `VideoLoadError`

`attachVideoEffect` returns an `EffectVideoController`. Its `load`, playback,
telemetry, metadata, controls, event, and destroy operations return Effects and
retain the same stable-controller behavior as the Promise API:

```ts
const program = Effect.gen(function* () {
  const player = yield* attachVideoEffect(anchor, {
    source: movie,
    backend: 'html',
  })
  yield* player.play()
  yield* player.load(nextMovie)
  return yield* player.stats()
})
```

All public failures are `Schema.TaggedError` values. Platform adapters are
provided as a registry layer; the Promise client executes this same Effect
implementation and converts its error channel to ordinary thrown error objects
at the JavaScript boundary.

## Framework injection

```tsx
<VideoPlayer
  client={videoClient}
  source={movie}
  options={{ backend: ['html', 'tauri'] }}
/>
```

`AttachCanvasVideoOptions` and therefore SolidTV/Blits attachment options also
accept `client`.
