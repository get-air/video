import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

import { ChromeRuntime, delay } from './chrome-devtools'

interface VideoTrack {
  readonly kind?: string
  readonly selected?: boolean
  readonly width?: number
  readonly height?: number
  readonly frameRate?: number
  readonly codec?: string
}

interface Snapshot {
  readonly ready: boolean
  readonly error?: string
  readonly sessionId?: string
  readonly backend?: string
  readonly media?: { durationSeconds?: number }
  readonly tracks?: readonly VideoTrack[]
  readonly quality?: {
    readonly presentedFrames?: number
    readonly mediaTimeSeconds?: number
    readonly measuredFps?: number
    readonly droppedVideoFrames?: number
    readonly droppedFramePercent?: number
  }
  readonly stats?: { hardwareBackend?: string; decodedFrameCopies?: number }
  readonly canvas?: {
    readonly width: number
    readonly height: number
    readonly left: number
    readonly top: number
    readonly cssWidth: number
    readonly cssHeight: number
  }
  readonly videoElements: number
  readonly canvasElements: number
}

interface RangeRequest {
  readonly start: number
  readonly end: number
  readonly status: number
}

const repository = resolve(import.meta.dirname, '..')
const sourceFps = Number(process.env.AIR_UHD_SOURCE_FPS ?? 30)
const fixture = resolve(repository, `qualification/fixtures/uhd-h264-${sourceFps}.mkv`)
const mediaPort = 9444
const appPort = 4174
const debuggerPort = 9229
const minimumFps = Number(process.env.AIR_UHD_MIN_FPS ?? 27)
const maximumDropPercent = Number(process.env.AIR_UHD_MAX_DROP_PERCENT ?? 5)
const fixtureDuration = Number(process.env.AIR_UHD_DURATION_SECONDS ?? 8)
const rangeRequests: RangeRequest[] = []
const children: ChildProcess[] = []
let mediaServer: Server | undefined
let runtime: ChromeRuntime | undefined
let browserProfile: string | undefined

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function executable(candidates: readonly (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue
    const result = spawnSync('which', [candidate], { encoding: 'utf8' })
    if (result.status === 0) return result.stdout.trim()
  }
  throw new Error(`No supported executable found: ${candidates.filter(Boolean).join(', ')}`)
}

function generateFixture(): void {
  if (existsSync(fixture)) {
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate',
      '-of', 'default=noprint_wrappers=1', fixture,
    ], { encoding: 'utf8' })
    if (probe.status === 0
      && probe.stdout.includes('width=3840')
      && probe.stdout.includes('height=2160')
      && probe.stdout.includes(`avg_frame_rate=${sourceFps}/1`)) return
  }

  mkdirSync(resolve(fixture, '..'), { recursive: true })
  const ffmpeg = executable(['ffmpeg'])
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=3840x2160:rate=${sourceFps}:duration=${fixtureDuration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${fixtureDuration}`,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-crf', '27', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '5.2',
    '-g', String(sourceFps * 2), '-keyint_min', String(sourceFps * 2),
    '-c:a', 'aac', '-b:a', '128k',
    fixture,
  ], { cwd: repository, stdio: 'inherit' })
  assert(result.status === 0, `ffmpeg failed with exit code ${result.status}`)
}

function startMediaServer(): Promise<void> {
  const size = statSync(fixture).size
  mediaServer = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range')
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'video/x-matroska')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    if (new URL(request.url ?? '/', `http://${request.headers.host}`).pathname !== '/uhd-h264.mkv') {
      response.writeHead(404).end()
      return
    }
    const range = request.headers.range
    let start = 0
    let end = size - 1
    let status = 200
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      start = match[1] ? Number(match[1]) : 0
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      status = 206
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    }
    response.setHeader('Content-Length', end - start + 1)
    rangeRequests.push({ start, end, status })
    response.writeHead(status)
    if (request.method === 'HEAD') response.end()
    else createReadStream(fixture, { start, end }).pipe(response)
  })
  return new Promise((resolve, reject) => {
    mediaServer!.once('error', reject)
    mediaServer!.listen(mediaPort, '127.0.0.1', resolve)
  })
}

function startProcess(command: string, args: readonly string[], cwd: string): ChildProcess {
  const child = spawn(command, args, { cwd, detached: true, stdio: 'inherit' })
  children.push(child)
  return child
}

async function waitFor<T>(description: string, probe: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ''}`)
}

async function snapshot(): Promise<Snapshot> {
  return runtime!.evaluate<Snapshot>(
    'window.__AIR_VIDEO_QUALIFICATION__?.snapshot()',
  )
}

function assertUhdState(value: Snapshot, phase: string): void {
  assert(!value.error, `${phase}: player reported ${value.error}`)
  assert(value.ready, `${phase}: player is not ready`)
  assert(value.backend === 'mediabunny', `${phase}: expected mediabunny, received ${value.backend}`)
  const track = value.tracks?.find((candidate) => candidate.kind === 'video' && candidate.selected)
  assert(track?.width === 3840 && track.height === 2160,
    `${phase}: expected a selected 3840x2160 track, received ${JSON.stringify(track)}`)
  assert((track.frameRate ?? 0) >= sourceFps - 1 && (track.frameRate ?? 0) <= sourceFps + 1,
    `${phase}: expected a ${sourceFps} FPS track, received ${track.frameRate}`)
  assert(value.canvas?.width === 3840 && value.canvas.height === 2160,
    `${phase}: backing canvas is ${value.canvas?.width}x${value.canvas?.height}`)
  assert(value.canvas?.left === 180 && value.canvas.top === 120
    && value.canvas.cssWidth === 1560 && value.canvas.cssHeight === 780,
  `${phase}: canvas geometry is ${JSON.stringify(value.canvas)}`)
  assert(value.videoElements === 1 && value.canvasElements === 2,
    `${phase}: leaked DOM layers (video=${value.videoElements}, canvas=${value.canvasElements})`)
  assert(value.stats?.decodedFrameCopies === 0,
    `${phase}: expected direct DOM canvas presentation, received ${value.stats?.decodedFrameCopies} copies`)
}

async function run(): Promise<void> {
  assert(Number.isFinite(minimumFps) && minimumFps > 0, 'AIR_UHD_MIN_FPS must be positive')
  assert(Number.isInteger(sourceFps) && sourceFps > 0, 'AIR_UHD_SOURCE_FPS must be a positive integer')
  assert(Number.isFinite(maximumDropPercent) && maximumDropPercent >= 0,
    'AIR_UHD_MAX_DROP_PERCENT must be non-negative')
  generateFixture()
  await startMediaServer()

  startProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(appPort)],
    resolve(repository, 'examples/solid-tv-app'))
  await waitFor('Vite application', async () => {
    const response = await fetch(`http://127.0.0.1:${appPort}`)
    return response.ok ? true : undefined
  })

  const chrome = executable([process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
  browserProfile = await mkdtemp(join(tmpdir(), 'air-uhd-chrome-'))
  const mediaUrl = `http://127.0.0.1:${mediaPort}/uhd-h264.mkv`
  const appUrl = `http://127.0.0.1:${appPort}/?qualification=1&source=${encodeURIComponent(mediaUrl)}`
  startProcess(chrome, [
    '--headless=new',
    `--remote-debugging-port=${debuggerPort}`,
    `--user-data-dir=${browserProfile}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    '--window-size=1920,1080', appUrl,
  ], repository)

  runtime = await waitFor('Chrome DevTools', () => ChromeRuntime.connect(
    `http://127.0.0.1:${debuggerPort}/json`,
  ), 15_000)
  const initial = await waitFor('initial UHD frames', async () => {
    const value = await snapshot()
    if (value.error) throw new Error(value.error)
    return value.ready && (value.quality?.presentedFrames ?? 0) >= sourceFps * 4 ? value : undefined
  }, 45_000)
  assertUhdState(initial, 'initial playback')
  assert((initial.quality?.measuredFps ?? 0) >= minimumFps,
    `initial playback: ${initial.quality?.measuredFps?.toFixed(2)} FPS is below ${minimumFps}`)
  assert((initial.quality?.droppedFramePercent ?? 100) <= maximumDropPercent,
    `initial playback: ${initial.quality?.droppedFramePercent?.toFixed(2)}% drops exceed ${maximumDropPercent}%`)
  assert(rangeRequests.some((request) => request.status === 206
    && request.end - request.start + 1 < statSync(fixture).size),
  'initial playback: MediaBunny did not use a partial HTTP range request')

  await runtime.evaluate('window.__AIR_VIDEO_QUALIFICATION__.seek(3)', true)
  const sought = await waitFor('seek to advance', async () => {
    const value = await snapshot()
    return (value.quality?.mediaTimeSeconds ?? 0) >= 3.25 ? value : undefined
  })
  assertUhdState(sought, 'seek')

  const previousSession = sought.sessionId
  await runtime.evaluate(
    `window.__AIR_VIDEO_QUALIFICATION__.reload(${JSON.stringify(`${mediaUrl}?reload=1`)})`, true,
  )
  const reloaded = await waitFor('reloaded UHD frames', async () => {
    const value = await snapshot()
    if (value.error) throw new Error(value.error)
    return value.ready && value.sessionId !== previousSession
      && (value.quality?.presentedFrames ?? 0) >= sourceFps ? value : undefined
  }, 45_000)
  assertUhdState(reloaded, 'reload')

  const report = {
    result: 'passed',
    generatedAt: new Date().toISOString(),
    browser: await runtime.evaluate<string>('navigator.userAgent'),
    source: { width: 3840, height: 2160, fps: sourceFps, durationSeconds: fixtureDuration },
    thresholds: { minimumFps, maximumDropPercent },
    initial,
    sought,
    reloaded,
    rangeRequests,
  }
  console.log(JSON.stringify(report, undefined, 2))
  const artifactDirectory = resolve(repository, 'qualification/artifacts')
  await mkdir(artifactDirectory, { recursive: true })
  await writeFile(resolve(artifactDirectory, 'uhd-browser.json'),
    `${JSON.stringify(report, undefined, 2)}\n`, 'utf8')
}

async function cleanup(): Promise<void> {
  runtime?.close()
  await new Promise<void>((resolve) => mediaServer?.close(() => resolve()) ?? resolve())
  const exits: Promise<void>[] = []
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null) continue
    exits.push(new Promise((resolve) => {
      child.once('exit', () => resolve())
      setTimeout(resolve, 2_000)
    }))
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* process already ended */ }
  }
  await Promise.all(exits)
  if (browserProfile) {
    await rm(browserProfile, { recursive: true, force: true }).catch(async () => {
      await delay(250)
      await rm(browserProfile!, { recursive: true, force: true })
    })
  }
}

try {
  await run()
} finally {
  await cleanup()
}
