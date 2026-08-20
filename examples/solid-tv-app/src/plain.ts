import {
  attachVideo,
  type MediaTrack,
  type VideoBackend,
  type VideoController,
  type VideoFitMode,
} from '@get-air/video'

const STYLE = `
  :root {
    color-scheme: dark;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #080b10;
    color: #f4f7fb;
  }
  * { box-sizing: border-box; }
  html, body, #app { width: 100%; min-height: 100%; margin: 0; background: #080b10 !important; }
  body { min-height: 100vh; }
  button, input, select { font: inherit; }
  .player-page {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: clamp(16px, 3vw, 44px);
  }
  .player-shell {
    width: min(1180px, 100%);
    border: 1px solid #303846;
    background: #11161e;
    box-shadow: 0 24px 80px #0009;
    overflow: hidden;
  }
  .player-header {
    min-height: 58px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 16px;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #303846;
  }
  .player-title { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: .01em; }
  .backend {
    color: #77e6f0;
    font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: .09em;
    text-transform: uppercase;
  }
  .source-form {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .source-url {
    width: 100%;
    min-width: 0;
    height: 44px;
    border: 1px solid #3a4554;
    border-radius: 7px;
    background: #080b10;
    color: #f4f7fb;
    padding: 0 13px;
  }
  .source-url::placeholder { color: #8996a7; }
  .source-submit {
    min-width: 86px;
    height: 44px;
    border: 1px solid #21bed0;
    border-radius: 7px;
    background: #21bed0;
    color: #061014;
    padding: 0 18px;
    font-weight: 800;
    cursor: pointer;
  }
  .source-submit:disabled { cursor: wait; opacity: .62; }
  .source-form :focus-visible {
    outline: 3px solid #f4f7fb;
    outline-offset: 2px;
  }
  .source-help {
    grid-column: 1 / -1;
    margin: -2px 0 0;
    color: #929eae;
    font-size: 12px;
  }
  .stage {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    overflow: hidden;
  }
  .stage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .subtitle-cue {
    position: absolute;
    z-index: 2;
    left: 8%;
    right: 8%;
    bottom: 7%;
    margin: 0 auto;
    color: white;
    font-size: clamp(20px, 2.3vw, 34px);
    font-weight: 700;
    line-height: 1.3;
    text-align: center;
    text-shadow: 0 2px 5px #000, 0 0 12px #000;
    pointer-events: none;
  }
  .subtitle-cue:empty { display: none; }
  .controls {
    padding: 14px 16px 16px;
    border-top: 3px solid #21bed0;
    background: #11161e;
  }
  .timeline-row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; }
  .time {
    min-width: 114px;
    color: #c7cfda;
    font: 600 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: right;
  }
  input[type="range"] { width: 100%; accent-color: #21bed0; }
  .control-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .control-row button, .control-row select {
    min-height: 44px;
    border: 1px solid #3a4554;
    border-radius: 7px;
    background: #1a212b;
    color: #f4f7fb;
    padding: 0 14px;
  }
  .control-row button { cursor: pointer; font-weight: 700; }
  .control-row button:hover, .control-row select:hover { background: #222c38; }
  .control-row :focus-visible {
    outline: 3px solid #67e7f3;
    outline-offset: 2px;
    border-color: transparent;
  }
  .play { min-width: 88px; background: #21bed0 !important; border-color: #21bed0 !important; color: #061014 !important; }
  .spacer { flex: 1 1 24px; }
  .volume { display: flex; align-items: center; gap: 8px; color: #c7cfda; font-size: 13px; }
  .volume input { width: 110px; }
  .status {
    min-height: 20px;
    margin: 11px 0 0;
    color: #929eae;
    font: 500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .status[data-kind="error"] { color: #ff8f8f; }
  .status[data-kind="warning"] { color: #ffd07a; }
  @media (max-width: 720px) {
    .player-page { padding: 0; place-items: start; }
    .player-shell { border-width: 0; box-shadow: none; }
    .control-row { gap: 8px; }
    .control-row button, .control-row select { flex: 1 1 auto; }
    .spacer { display: none; }
  }
  @media (max-width: 520px) {
    .source-form { grid-template-columns: 1fr; }
    .source-submit { width: 100%; }
  }
`

export async function startPlainApp(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('Missing #app root')

  const parameters = new URLSearchParams(window.location.search)
  const source = parameters.get('source') ?? '/sample.mkv'
  const subtitleSource = parameters.get('subtitle')
  const title = parameters.get('title') ?? 'HTML player example'

  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }))
  root.innerHTML = `
    <main class="player-page">
      <section class="player-shell" aria-label="Video player">
        <header class="player-header">
          <h1 class="player-title"></h1>
          <span class="backend">Opening…</span>
          <form class="source-form" data-air-video-controls>
            <input class="source-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" required aria-label="Video URL" aria-describedby="source-help" placeholder="Paste a direct video URL">
            <button class="source-submit" type="submit">Load</button>
            <p class="source-help" id="source-help">Direct media links work here. Remote hosts must allow CORS and byte-range requests.</p>
          </form>
        </header>
        <div class="stage">
          <video playsinline aria-label="Video surface"></video>
          <p class="subtitle-cue" aria-live="off"></p>
        </div>
        <div class="controls" data-air-video-controls>
          <div class="timeline-row">
            <input class="timeline" type="range" min="0" max="0" value="0" step="0.05" aria-label="Seek">
            <output class="time">0:00 / 0:00</output>
          </div>
          <div class="control-row">
            <button type="button" data-action="rewind" aria-label="Rewind 10 seconds">−10s</button>
            <button type="button" class="play" data-action="play">Play</button>
            <button type="button" data-action="forward" aria-label="Forward 10 seconds">+10s</button>
            <select class="audio" aria-label="Audio track" hidden></select>
            <select class="subtitles" aria-label="Subtitle track" hidden></select>
            <button type="button" data-action="fit">Fit</button>
            <span class="spacer"></span>
            <label class="volume">Volume <input type="range" min="0" max="1" value="1" step="0.05" aria-label="Volume"></label>
            <button type="button" data-action="fullscreen">Fullscreen</button>
          </div>
          <p class="status" role="status">Opening the video…</p>
        </div>
      </section>
    </main>
  `

  const video = required<HTMLVideoElement>(root, 'video')
  const stage = required<HTMLElement>(root, '.stage')
  const sourceForm = required<HTMLFormElement>(root, '.source-form')
  const sourceInput = required<HTMLInputElement>(root, '.source-url')
  const sourceSubmit = required<HTMLButtonElement>(root, '.source-submit')
  const controls = required<HTMLElement>(root, '.controls')
  const playButton = required<HTMLButtonElement>(root, '[data-action="play"]')
  const timeline = required<HTMLInputElement>(root, '.timeline')
  const time = required<HTMLOutputElement>(root, '.time')
  const status = required<HTMLElement>(root, '.status')
  const backend = required<HTMLElement>(root, '.backend')
  const cue = required<HTMLElement>(root, '.subtitle-cue')
  const audio = required<HTMLSelectElement>(root, '.audio')
  const subtitles = required<HTMLSelectElement>(root, '.subtitles')
  const volume = required<HTMLInputElement>(root, '.volume input')
  required<HTMLElement>(root, '.player-title').textContent = title
  sourceInput.value = new URL(source, window.location.href).href

  let controller: VideoController | undefined
  let playing = false
  let fit: VideoFitMode = 'fit'
  let seeking = false

  const report = (message: string, kind: 'normal' | 'warning' | 'error' = 'normal') => {
    status.textContent = message
    status.dataset.kind = kind
  }
  const syncTime = (position: number) => {
    const duration = controller?.media.durationSeconds ?? 0
    if (!seeking) timeline.value = String(Math.min(duration, Math.max(0, position)))
    time.value = `${formatTime(Number(timeline.value))} / ${formatTime(duration)}`
  }
  const syncPlay = (next: boolean) => {
    playing = next
    playButton.textContent = next ? 'Pause' : 'Play'
  }

  const subtitleOptions = subtitleSource ? [{
    id: 'external-english',
    src: subtitleSource,
    label: parameters.get('subtitleLabel') ?? 'English',
    language: parameters.get('subtitleLanguage') ?? 'en',
    default: true,
  }] : []

  const syncReadyState = () => {
    if (!controller) return
    backend.textContent = controller.capabilities.backend
    timeline.max = String(controller.media.durationSeconds ?? 0)
    timeline.value = '0'
    cue.textContent = ''
    syncPlay(false)
    populateTracks(audio, controller.tracks.filter((track) => track.kind === 'audio'), false)
    populateTracks(subtitles, controller.tracks.filter((track) => track.kind === 'subtitle'), true)
    syncTime(0)
    report(`Ready · ${controller.media.container ?? 'media'} · arrows move focus · Enter selects`)
  }

  const bindController = (active: VideoController) => {
    active.on('timeupdate', (event) => syncTime(event.detail.currentTime))
    active.on('backendchange', (event) => { backend.textContent = event.detail.backend })
    active.on('trackchange', () => {
      populateTracks(audio, active.tracks.filter((track) => track.kind === 'audio'), false)
      populateTracks(subtitles, active.tracks.filter((track) => track.kind === 'subtitle'), true)
    })
    active.on('subtitlecuechange', (event) => {
      cue.textContent = event.detail.cues.map((item) => item.text).join(' ')
    })
    active.on('error', (event) => report(event.detail.message, 'error'))
  }

  const loadSource = async (nextSource: string) => {
    report('Opening the video URL…')
    backend.textContent = 'Opening…'
    sourceSubmit.disabled = true
    sourceSubmit.textContent = 'Loading…'
    try {
      if (controller) {
        await controller.load(nextSource, {
          backend: parseBackends(parameters),
          autoplay: false,
          deviceProfile: 'desktop',
          controlRegions: [sourceForm, controls],
          subtitles: subtitleOptions,
        })
      } else {
        controller = await attachVideo(video, {
          source: nextSource,
          backend: parseBackends(parameters),
          autoplay: false,
          deviceProfile: 'desktop',
          controlRegions: [sourceForm, controls],
          subtitles: subtitleOptions,
        })
        bindController(controller)
      }
      syncReadyState()
    } catch (cause) {
      backend.textContent = 'Error'
      report(friendlyLoadError(cause), 'error')
    } finally {
      sourceSubmit.disabled = false
      sourceSubmit.textContent = 'Load'
    }
  }

  video.addEventListener('play', () => syncPlay(true))
  video.addEventListener('pause', () => syncPlay(false))
  video.addEventListener('ended', () => syncPlay(false))
  await loadSource(source)
  playButton.focus()

  sourceForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const nextSource = validateMediaUrl(sourceInput.value)
    if (nextSource instanceof Error) {
      report(nextSource.message, 'error')
      sourceInput.focus()
      return
    }
    void loadSource(nextSource)
  })

  controls.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]')
    if (!button || !controller) return
    const action = button.dataset.action
    if (action === 'play') void (playing ? Promise.resolve(controller.pause()) : controller.play())
    if (action === 'rewind') void controller.seek(Math.max(0, Number(timeline.value) - 10))
    if (action === 'forward') void controller.seek(Math.min(Number(timeline.max), Number(timeline.value) + 10))
    if (action === 'fit') {
      fit = fit === 'fit' ? 'cover' : 'fit'
      button.textContent = fit === 'fit' ? 'Fit' : 'Fill'
      void controller.setVideoFit(fit)
    }
    if (action === 'fullscreen') void (document.fullscreenElement
      ? document.exitFullscreen()
      : stage.requestFullscreen())
  })
  timeline.addEventListener('input', () => {
    seeking = true
    syncTime(Number(timeline.value))
  })
  timeline.addEventListener('change', () => {
    seeking = false
    void controller?.seek(Number(timeline.value))
  })
  volume.addEventListener('input', () => { void controller?.setVolume(Number(volume.value)) })
  audio.addEventListener('change', () => { void controller?.selectTrack('audio', audio.value || undefined) })
  subtitles.addEventListener('change', () => { void controller?.selectTrack('subtitle', subtitles.value || undefined) })

  const focusables = () => [...root.querySelectorAll<HTMLElement>('.source-form button:not([hidden]), .source-form input:not([hidden]), .controls button:not([hidden]), .controls select:not([hidden]), .controls input:not([hidden])')]
  window.addEventListener('keydown', (event) => {
    if (event.key === 'MediaPlayPause' || event.keyCode === 179) {
      event.preventDefault()
      playButton.click()
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (document.activeElement === sourceInput || document.activeElement === timeline || document.activeElement === volume) return
    const items = focusables()
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    const direction = event.key === 'ArrowRight' ? 1 : -1
    items[(current + direction + items.length) % items.length]?.focus()
    event.preventDefault()
  })
  window.addEventListener('beforeunload', () => { void controller?.destroy() }, { once: true })
}

function required<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector)
  if (!element) throw new Error(`Missing player element: ${selector}`)
  return element
}

function parseBackends(parameters: URLSearchParams): readonly VideoBackend[] {
  const requested = parameters.get('backend')
  if (!requested) return ['html']
  const values = requested.split(',').map((value) => value.trim()).filter(Boolean)
  return values.length > 0 ? values as VideoBackend[] : ['html']
}

function populateTracks(select: HTMLSelectElement, tracks: readonly MediaTrack[], allowOff: boolean): void {
  const current = tracks.find((track) => track.selected)?.id ?? ''
  select.replaceChildren()
  if (allowOff) select.add(new Option('Subtitles off', '', current === ''))
  for (const track of tracks) {
    const prefix = track.kind === 'audio' ? 'Audio' : 'Subtitles'
    select.add(new Option(`${prefix}: ${track.label || track.language || `Track ${track.streamIndex + 1}`}`, track.id, false, track.id === current))
  }
  select.hidden = tracks.length === 0
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole % 3600 / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function validateMediaUrl(value: string): string | Error {
  const trimmed = value.trim()
  if (!trimmed) return new Error('Paste a direct HTTP or HTTPS media URL.')
  try {
    const url = new URL(trimmed, window.location.href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return new Error('The media URL must use HTTP or HTTPS.')
    }
    return url.href
  } catch {
    return new Error('That is not a valid media URL. Paste the full HTTP or HTTPS address.')
  }
}

function friendlyLoadError(cause: unknown): string {
  const detail = errorMessage(cause)
  if (/cors|fetch|network|range|http|load failed/i.test(detail)) {
    return `Could not load this URL. The host may block CORS or byte-range requests. ${detail}`
  }
  return `Could not play this URL. ${detail}`
}
