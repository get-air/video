import { createSignal, onCleanup } from 'solid-js'
import type { VideoBackend } from '@get-air/video'
import {
  createSolidVideo,
  solidVideoHole,
  type SolidVideoRect,
  type SolidRendererLike,
} from '@get-air/video/solid'

const videoRect: SolidVideoRect = { x: 180, y: 120, width: 1560, height: 780 }

export function App(props: { renderer: SolidRendererLike }) {
  const parameters = new URLSearchParams(window.location.search)
  const [source, setSource] = createSignal(parameters.get('source') ?? '/sample.mkv')
  const [backends, setBackends] = createSignal<readonly VideoBackend[]>(['mediabunny', 'html'])
  const video = createSolidVideo(() => ({
    renderer: props.renderer,
    rect: videoRect,
    source: source(),
    backend: backends(),
    autoplay: true,
    subtitles: [{
      id: 'english',
      src: '/sample.en.vtt',
      label: 'English',
      language: 'en',
      default: true,
    }],
  }))

  const keydown = (event: KeyboardEvent) => {
    if (event.key === '1') setBackends(['mediabunny', 'html'])
    if (event.key === '2') setBackends(['mediabunny'])
    if (event.key === '3') setBackends(['html'])
    if (event.key === 'n') setSource((value) =>
      value === '/sample.mkv' ? '/sample-2.mkv' : '/sample.mkv')
  }
  window.addEventListener('keydown', keydown)
  onCleanup(() => window.removeEventListener('keydown', keydown))

  return (
    <node w={1920} h={1080} color={0x10141fff}
      effects={{ holePunch: solidVideoHole(videoRect, 24) }}>
      <node x={80} y={46} w={video.loading() ? 220 : 360} h={12}
        color={video.error() ? 0xff5f57ff : 0x40d99bff} />
      <node x={80} y={1018} w={video.subtitleCues().length ? 360 : 180} h={8}
        color={0x8ea6c9ff} />
    </node>
  )
}
