/*
THESIS: A broadcast playback console that makes remote input and media state undeniable; it refuses anonymous browser controls.
OWN-WORLD: True black, chalk text, cyan signal fields, square broadcast geometry, and a white focus frame.
STORY: The viewer sees the source playing, reads duration/backend health, then operates every essential action from one D-pad row.
FIRST VIEWPORT: Video dominates the upper 744px; progress, time, transport, track state, and feedback form one grounded lower console.
FORM: An Air Horizon control-room extension, inheriting the established television world rather than introducing a new visual identity.
*/

import { Row, useFocusManager } from '@solidtv/solid/primitives'
import { createEffect, createSignal, onCleanup } from 'solid-js'
import type {
  MediaTrack,
  VideoBackend,
  VideoController,
  VideoFitMode,
} from '@get-air/video'
import {
  createSolidVideo,
  type SolidRendererLike,
  type SolidVideoRect,
} from '@get-air/video/solid'

const SCREEN = { width: 1920, height: 1080 } as const
const SAFE_X = 80
const CONTENT_WIDTH = SCREEN.width - SAFE_X * 2
const videoRect: SolidVideoRect = { x: SAFE_X, y: 96, width: CONTENT_WIDTH, height: 744 }

const COLOR = {
  ink: 0x000000ff,
  panel: 0x11171cff,
  surface: 0x1d252cff,
  focus: 0x25c7d9ff,
  chalk: 0xf4f7f8ff,
  muted: 0xb7c0c6ff,
  dim: 0x7f8a92ff,
  amber: 0xf3c766ff,
  error: 0xff6b6bff,
} as const

type Command = 'toggle' | 'rewind' | 'forward' | 'audio' | 'subtitle' | 'fit'

interface NativeAudioTrack {
  enabled: boolean
  label?: string
  language?: string
}

interface NativeAudioTrackList {
  length: number
  [index: number]: NativeAudioTrack
}

declare global {
  interface Window {
    __AIR_TV_PLAYER__?: {
      snapshot(): Record<string, unknown>
      command(command: Command): Promise<void>
    }
  }
}

function ControlButton(props: {
  readonly width: number
  readonly label: string
  readonly value?: () => string
  readonly autofocus?: boolean
  readonly onEnter: () => void
}) {
  const [focused, setFocused] = createSignal(false)
  return (
    <view
      width={props.width}
      height={76}
      color={focused() ? COLOR.focus : COLOR.panel}
      borderRadius={2}
      border={{ width: focused() ? 3 : 1, color: focused() ? COLOR.chalk : 0xffffff24 }}
      autofocus={props.autofocus}
      onFocusChanged={(hasFocus) => {
        setFocused(hasFocus)
        if (hasFocus) document.documentElement.dataset.airFocus = props.label
      }}
      onEnter={() => {
        props.onEnter()
        return true
      }}
    >
      <text
        x={20}
        y={props.value ? 12 : 22}
        width={props.width - 40}
        height={30}
        fontFamily="sans-serif"
        fontSize={props.value ? 19 : 25}
        fontWeight={700}
        color={focused() ? COLOR.ink : COLOR.chalk}
        maxLines={1}
      >
        {props.label}
      </text>
      {props.value && (
        <text
          x={20}
          y={40}
          width={props.width - 40}
          height={24}
          fontFamily="sans-serif"
          fontSize={18}
          color={focused() ? 0x0b3c43ff : COLOR.muted}
          maxLines={1}
        >
          {props.value()}
        </text>
      )}
    </view>
  )
}

export function App(props: { renderer: SolidRendererLike }) {
  useFocusManager({
    Left: ['ArrowLeft', 37],
    Right: ['ArrowRight', 39],
    Up: ['ArrowUp', 38],
    Down: ['ArrowDown', 40],
    Enter: ['Enter', 13],
    Last: ['Backspace', 'Escape', 8, 27, 461],
  })

  const parameters = new URLSearchParams(window.location.search)
  const initialSource = parameters.get('source') ?? '/sample.mkv'
  const title = parameters.get('title') ?? 'Vizio playback lab'
  const subtitleSource = parameters.get('subtitle')
  const telemetryUrl = parameters.get('telemetry')
  const [source, setSource] = createSignal(initialSource)
  const [backends, setBackends] = createSignal<readonly VideoBackend[]>(parseBackends(parameters))
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [bufferedAhead, setBufferedAhead] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [backend, setBackend] = createSignal('starting')
  const [status, setStatus] = createSignal('Opening the playback pipeline...')
  const [statusKind, setStatusKind] = createSignal<'normal' | 'warning' | 'error'>('normal')
  const [audioLabel, setAudioLabel] = createSignal('Device default')
  const [subtitleLabel, setSubtitleLabel] = createSignal(subtitleSource ? 'English' : 'Off')
  const [fitMode, setFitMode] = createSignal<VideoFitMode>('fit')

  const video = createSolidVideo(() => ({
    renderer: props.renderer,
    rect: videoRect,
    source: source(),
    backend: backends(),
    autoplay: false,
    deviceProfile: 'tv',
    subtitles: subtitleSource ? [{
      id: 'external-english',
      src: subtitleSource,
      label: parameters.get('subtitleLabel') ?? 'English',
      language: parameters.get('subtitleLanguage') ?? 'en',
      default: true,
    }] : [],
  }))

  const controller = (): VideoController | undefined => video.controller()
  const progress = () => duration() > 0 ? Math.min(1, Math.max(0, currentTime() / duration())) : 0

  const emitTelemetry = (event: string, detail?: Record<string, unknown>) => {
    if (!telemetryUrl) return
    try {
      const url = new URL(telemetryUrl)
      url.searchParams.set('event', event)
      url.searchParams.set('backend', backend())
      url.searchParams.set('current', currentTime().toFixed(3))
      url.searchParams.set('duration', duration().toFixed(3))
      if (detail) url.searchParams.set('detail', JSON.stringify(detail))
      void fetch(url, { mode: 'no-cors', keepalive: true }).catch(() => undefined)
    } catch {
      // Telemetry is diagnostic-only and must never block playback.
    }
  }
  emitTelemetry('mounted')

  const report = (message: string, kind: 'normal' | 'warning' | 'error' = 'normal') => {
    setStatus(message)
    setStatusKind(kind)
    document.documentElement.dataset.airStatus = message
    document.documentElement.dataset.airStatusKind = kind
    emitTelemetry('status', { message, kind })
  }

  const run = async (action: string, operation: (active: VideoController) => Promise<void> | void) => {
    emitTelemetry('action', { action })
    const active = controller()
    if (!active) {
      report(`Cannot ${action}: player is still starting.`, 'warning')
      return
    }
    try {
      await operation(active)
    } catch (cause) {
      report(`Cannot ${action}: ${errorMessage(cause)}`, 'error')
    }
  }

  const togglePlayback = () => run('toggle playback', async (active) => {
    if (active.element.paused) {
      await active.play()
      report('Playing')
    } else {
      active.pause()
      report('Paused')
    }
  })

  const seekBy = (seconds: number) => run('seek', async (active) => {
    const target = Math.min(
      duration() || Number.POSITIVE_INFINITY,
      Math.max(0, currentTime() + seconds),
    )
    await active.seek(target)
    setCurrentTime(target)
    report(`${seconds < 0 ? 'Rewound' : 'Forwarded'} to ${formatTime(target)}`)
  })

  const cycleAudio = () => run('change audio', async (active) => {
    const selectable = active.tracks.filter((track) => track.kind === 'audio')
    if (active.capabilities.audioTrackSelection && selectable.length > 0) {
      const next = nextTrack(selectable)
      await active.selectTrack('audio', next.id)
      setAudioLabel(trackLabel(next))
      report(`Audio: ${trackLabel(next)}`)
      return
    }
    const nativeTracks = (active.element as HTMLVideoElement & {
      audioTracks?: NativeAudioTrackList
    }).audioTracks
    if (nativeTracks && nativeTracks.length > 0) {
      let selected = -1
      for (let index = 0; index < nativeTracks.length; index += 1) {
        if (nativeTracks[index]?.enabled) selected = index
      }
      const nextIndex = (selected + 1) % nativeTracks.length
      for (let index = 0; index < nativeTracks.length; index += 1) {
        const track = nativeTracks[index]
        if (track) track.enabled = index === nextIndex
      }
      const next = nativeTracks[nextIndex]
      const label = next?.label || next?.language || `Track ${nextIndex + 1}`
      setAudioLabel(label)
      report(`Audio: ${label}`)
      return
    }
    report('This Vizio firmware keeps HLS audio selection inside its native player.', 'warning')
  })

  const cycleSubtitles = () => run('change subtitles', async (active) => {
    const tracks = active.tracks.filter((track) => track.kind === 'subtitle')
    const selected = tracks.findIndex((track) => track.selected)
    const nextIndex = selected + 1 >= tracks.length ? -1 : selected + 1
    const next = nextIndex < 0 ? undefined : tracks[nextIndex]
    await active.selectTrack('subtitle', next?.id)
    const label = next ? trackLabel(next) : 'Off'
    setSubtitleLabel(label)
    report(`Subtitles: ${label}`)
  })

  const cycleFit = () => run('change video fit', async (active) => {
    const next: VideoFitMode = fitMode() === 'fit' ? 'cover' : 'fit'
    await active.setVideoFit(next)
    setFitMode(next)
    report(`Picture: ${next === 'fit' ? 'Fit' : 'Fill'}`)
  })

  const commands: Record<Command, () => void> = {
    toggle: () => { void togglePlayback() },
    rewind: () => { void seekBy(-10) },
    forward: () => { void seekBy(10) },
    audio: () => { void cycleAudio() },
    subtitle: () => { void cycleSubtitles() },
    fit: () => { void cycleFit() },
  }

  let boundController: VideoController | undefined
  let releaseController = () => undefined
  const bindController = () => {
    const active = video.controller()
    if (!active || active === boundController) return
    releaseController()
    boundController = active
    setBackend(active.capabilities.backend)
    setDuration(active.media.durationSeconds ?? finiteDuration(active.element.duration))
    setCurrentTime(active.element.currentTime || 0)
    setPlaying(!active.element.paused)
    const selectedAudio = active.tracks.find((track) => track.kind === 'audio' && track.selected)
    if (selectedAudio) setAudioLabel(trackLabel(selectedAudio))
    const selectedSubtitle = active.tracks.find(
      (track) => track.kind === 'subtitle' && track.selected,
    )
    if (selectedSubtitle) setSubtitleLabel(trackLabel(selectedSubtitle))
    report(`Ready on ${active.capabilities.backend}. Use arrows and OK.`)
    emitTelemetry('ready', {
      backend: active.capabilities.backend,
      duration: active.media.durationSeconds ?? finiteDuration(active.element.duration),
    })

    const unsubscribers = [
      active.on('timeupdate', (event) => setCurrentTime(event.detail.currentTime)),
      active.on('bufferprogress', (event) => setBufferedAhead(event.detail.bufferedAhead)),
      active.on('backendchange', (event) => setBackend(event.detail.backend)),
      active.on('trackchange', () => {
        const selected = active.tracks.find((track) => track.kind === 'audio' && track.selected)
        if (selected) setAudioLabel(trackLabel(selected))
      }),
      active.on('error', (event) => report(event.detail.message, 'error')),
    ]
    const syncMetadata = () => {
      setDuration(active.media.durationSeconds ?? finiteDuration(active.element.duration))
      setCurrentTime(active.element.currentTime || 0)
      setBufferedAhead(active.bufferedAhead())
    }
    const syncPlaying = () => setPlaying(!active.element.paused)
    const showBuffering = () => report('Buffering from the playback source...', 'warning')
    const showSeeking = () => report(`Seeking from ${formatTime(currentTime())}...`)
    const showSeeked = () => report(`Seek complete at ${formatTime(active.element.currentTime)}.`)
    active.element.addEventListener('loadedmetadata', syncMetadata)
    active.element.addEventListener('durationchange', syncMetadata)
    active.element.addEventListener('play', syncPlaying)
    active.element.addEventListener('pause', syncPlaying)
    active.element.addEventListener('waiting', showBuffering)
    active.element.addEventListener('stalled', showBuffering)
    active.element.addEventListener('seeking', showSeeking)
    active.element.addEventListener('seeked', showSeeked)
    releaseController = () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
      active.element.removeEventListener('loadedmetadata', syncMetadata)
      active.element.removeEventListener('durationchange', syncMetadata)
      active.element.removeEventListener('play', syncPlaying)
      active.element.removeEventListener('pause', syncPlaying)
      active.element.removeEventListener('waiting', showBuffering)
      active.element.removeEventListener('stalled', showBuffering)
      active.element.removeEventListener('seeking', showSeeking)
      active.element.removeEventListener('seeked', showSeeked)
    }
  }
  bindController()
  const controllerPoll = window.setInterval(bindController, 100)
  onCleanup(() => {
    window.clearInterval(controllerPoll)
    releaseController()
  })

  createEffect(() => {
    const failure = video.error()
    if (failure !== undefined) report(errorMessage(failure), 'error')
  })

  createEffect(() => {
    document.documentElement.dataset.airBackend = backend()
    document.documentElement.dataset.airCurrentTime = currentTime().toFixed(3)
    document.documentElement.dataset.airDuration = duration().toFixed(3)
    document.documentElement.dataset.airBufferedAhead = bufferedAhead().toFixed(3)
    document.documentElement.dataset.airPlaying = String(playing())
    document.documentElement.dataset.airAudio = audioLabel()
    document.documentElement.dataset.airSubtitles = subtitleLabel()
  })

  const keydown = (event: KeyboardEvent) => {
    const code = event.keyCode
    const key = event.key
    emitTelemetry('key', { key, code })
    if (key === 'MediaPlayPause' || code === 179) commands.toggle()
    else if (key === 'MediaPlay' || code === 415) void run('play', async (active) => {
      await active.play()
      report('Playing')
    })
    else if (key === 'MediaPause' || code === 19) void run('pause', (active) => {
      active.pause()
      report('Paused')
    })
    else if (key === 'MediaRewind' || code === 412 || code === 227) commands.rewind()
    else if (key === 'MediaFastForward' || code === 417 || code === 228) commands.forward()
    else if (key.toLowerCase() === 'n') {
      setSource((value) => value === '/sample.mkv' ? '/sample-2.mkv' : '/sample.mkv')
      report('Loaded the alternate local test clip.')
    } else if (key === '1') setBackends(['vizio', 'html', 'mediabunny'])
    else if (key === '2') setBackends(['mediabunny'])
    else if (key === '3') setBackends(['html'])
  }
  window.addEventListener('keydown', keydown)
  onCleanup(() => window.removeEventListener('keydown', keydown))

  window.__AIR_TV_PLAYER__ = {
    snapshot: () => ({
      source: source(),
      backend: backend(),
      currentTime: currentTime(),
      duration: duration(),
      bufferedAhead: bufferedAhead(),
      playing: playing(),
      audio: audioLabel(),
      subtitles: subtitleLabel(),
      status: status(),
      tracks: controller()?.tracks,
    }),
    command: async (command) => commands[command](),
  }

  return (
    <view
      width={SCREEN.width}
      height={SCREEN.height}
    >
      <view x={0} y={0} width={SCREEN.width} height={videoRect.y} color={COLOR.ink} />
      <view
        x={0}
        y={videoRect.y}
        width={videoRect.x}
        height={videoRect.height}
        color={COLOR.ink}
      />
      <view
        x={videoRect.x + videoRect.width}
        y={videoRect.y}
        width={SCREEN.width - videoRect.x - videoRect.width}
        height={videoRect.height}
        color={COLOR.ink}
      />
      <text
        x={SAFE_X}
        y={28}
        width={900}
        height={44}
        fontFamily="sans-serif"
        fontSize={32}
        fontWeight={700}
        color={COLOR.chalk}
        maxLines={1}
      >
        AIR / {title}
      </text>
      <text
        x={1310}
        y={36}
        width={530}
        height={30}
        fontFamily="sans-serif"
        fontSize={20}
        textAlign="right"
        contain="both"
        color={video.error() ? COLOR.error : video.loading() ? COLOR.amber : COLOR.focus}
        maxLines={1}
      >
        {video.loading() ? 'CONNECTING' : video.error() ? 'PLAYBACK ERROR' : `LIVE / ${backend().toUpperCase()}`}
      </text>

      {video.subtitleCues().length > 0 && (
        <view x={250} y={738} width={1420} height={82} color={0x000000d9} borderRadius={2}>
          <text
            x={32}
            y={18}
            width={1356}
            height={52}
            fontFamily="sans-serif"
            fontSize={32}
            fontWeight={700}
            textAlign="center"
            contain="both"
            color={COLOR.chalk}
            maxLines={2}
          >
            {video.subtitleCues().map((cue) => cue.text).join(' ')}
          </text>
        </view>
      )}

      <view x={0} y={820} width={SCREEN.width} height={260} color={COLOR.ink}>
        <view x={SAFE_X} y={22} width={CONTENT_WIDTH} height={8} color={COLOR.surface}>
          <view width={Math.max(4, Math.round(CONTENT_WIDTH * progress()))} height={8} color={COLOR.focus} />
        </view>
        <text
          x={SAFE_X}
          y={40}
          width={300}
          height={30}
          fontFamily="sans-serif"
          fontSize={21}
          color={COLOR.chalk}
        >
          {formatTime(currentTime())}
        </text>
        <text
          x={1540}
          y={40}
          width={300}
          height={30}
          fontFamily="sans-serif"
          fontSize={21}
          textAlign="right"
          contain="both"
          color={COLOR.muted}
        >
          {formatTime(duration())}
        </text>

        <text
          x={760}
          y={40}
          width={400}
          height={30}
          fontFamily="sans-serif"
          fontSize={18}
          textAlign="center"
          contain="both"
          color={COLOR.dim}
        >
          BUFFER {bufferedAhead().toFixed(1)} SEC
        </text>

        <Row x={SAFE_X} y={70} width={CONTENT_WIDTH} height={76} gap={18} scroll="none">
          <ControlButton width={190} label="-10 SEC" onEnter={commands.rewind} />
          <ControlButton
            width={240}
            label={playing() ? 'PAUSE' : 'PLAY'}
            autofocus
            onEnter={commands.toggle}
          />
          <ControlButton width={190} label="+10 SEC" onEnter={commands.forward} />
          <ControlButton width={290} label="AUDIO" value={audioLabel} onEnter={commands.audio} />
          <ControlButton
            width={320}
            label="SUBTITLES"
            value={subtitleLabel}
            onEnter={commands.subtitle}
          />
          <ControlButton
            width={220}
            label="PICTURE"
            value={() => fitMode() === 'fit' ? 'Fit' : 'Fill'}
            onEnter={commands.fit}
          />
        </Row>

        <text
          x={SAFE_X}
          y={150}
          width={CONTENT_WIDTH}
          height={30}
          fontFamily="sans-serif"
          fontSize={20}
          color={statusKind() === 'error' ? COLOR.error : statusKind() === 'warning' ? COLOR.amber : COLOR.dim}
          maxLines={1}
        >
          {status()}
        </text>
      </view>
    </view>
  )
}

function parseBackends(parameters: URLSearchParams): readonly VideoBackend[] {
  const requested = parameters.get('backend')
  if (!requested) return ['vizio', 'html', 'mediabunny']
  const values = requested.split(',').map((value) => value.trim()).filter(Boolean)
  return values.length > 0 ? values as VideoBackend[] : ['vizio', 'html', 'mediabunny']
}

function nextTrack(tracks: readonly MediaTrack[]): MediaTrack {
  const selected = tracks.findIndex((track) => track.selected)
  return tracks[(selected + 1) % tracks.length]!
}

function trackLabel(track: MediaTrack): string {
  return track.label || track.language || `${track.kind} ${track.streamIndex + 1}`
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole % 3600 / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
