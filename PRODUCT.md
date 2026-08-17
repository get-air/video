# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Air applications and viewers using browser-based playback on desktop, Samsung Tizen, LG webOS, and Vizio SmartCast televisions. Television viewers operate from several feet away with a directional remote rather than a pointer.

## Product Purpose

`@get-air/video` provides one controller API for loading media, playback, seeking, volume, fit, audio selection, subtitles, and telemetry across browser and television backends.

## Positioning

One stable controller survives source and backend changes while platform adapters retain their native playback path.

## Operating Context

The SolidTV example is both an integration sample and an on-device playback laboratory. It must expose enough state to verify controller input, duration, seeking, backend selection, buffering, audio, and subtitles on a real television.

## Capabilities and Constraints

- Playback UI must work without touch, hover, or a pointer.
- Vizio uses the platform HTML video pipeline; MediaBunny is an explicit browser/WebCodecs path.
- The authored television surface is 1920×1080 with overscan-safe margins.
- Runtime source URLs may be supplied through query parameters for isolated device testing.

## Brand Commitments

The product is Air. The television interface inherits Air Horizon's black broadcast surface, chalk typography, and cyan focus signal.

## Evidence on Hand

- Working video controller and SolidTV renderer integrations in this repository.
- Existing Air television tokens and focus behavior in the sibling Air application.
- Locally generated and staged media fixtures for deterministic testing.

## Product Principles

- A remote action must produce immediate, visible feedback.
- Playback state is more important than decorative chrome.
- The active focus target is never ambiguous.
- Unsupported platform capabilities are explained rather than silently ignored.

## Accessibility & Inclusion

All essential actions are reachable with arrows and Enter, use large targets and readable type, and retain strong focus contrast at television distance.
