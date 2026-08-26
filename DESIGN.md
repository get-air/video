# Air Video Design

## Air Horizon television world

The Air framework player inherits Air's broadcast control-room language: a true-black field, edge-to-edge moving image, chalk-white information, cool slate secondary text, cyan live/progress signals, and a white focus frame. The interface avoids translucent glass, decorative gradients, and rounded floating cards.

## Composition

- Author at 1920×1080 with an 80px overscan-safe boundary.
- Video occupies the dominant upper stage; transport and state form one grounded lower console.
- Progress is a thin, high-contrast timeline with duration at its right edge.
- Controls read left to right as rewind, play/pause, forward, audio, subtitles, and fit.

## Interaction

- Exactly one transport target autofocuses on launch.
- Focus uses a 3px chalk frame plus a cyan surface; it never relies on scale alone.
- Arrow navigation follows the visual row. Enter performs the named action.
- Media remote keys work even when their corresponding button is not focused.
- Every action updates the status line; failures name the unavailable capability.

## Type and color

- Use a workhorse sans face available to the television runtime.
- Primary text: `#f4f7f8ff`; secondary: `#b7c0c6ff`; dim: `#7f8a92ff`.
- Focus/progress: `#25c7d9ff`; warning: `#f3c766ff`; error: `#ff6b6bff`.
- Background: `#000000ff`; control surface: `#11171cff`.

## Motion

The moving picture is the authored motion. UI changes use short color/alpha transitions only; reduced-motion and older television runtimes lose no information.
