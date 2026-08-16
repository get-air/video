# 4K browser qualification

`npm run qualify:uhd` performs a real end-to-end MediaBunny test.

The runner:

1. generates an ignored 3840×2160 H.264/AAC Matroska fixture with FFmpeg;
2. starts a CORS-enabled HTTP range server;
3. starts the real SolidTV example;
4. launches headless Chrome/Chromium with WebCodecs;
5. verifies decoded dimensions, cadence, drops, direct canvas presentation,
   geometry, range loading, seek, reload, and DOM-layer cleanup invariants;
6. writes `qualification/artifacts/uhd-browser.json`.

Defaults are a 30 FPS source, minimum 27 measured FPS, maximum 5% drops, and an
eight-second fixture. Override with:

```sh
AIR_UHD_SOURCE_FPS=60 \
AIR_UHD_MIN_FPS=50 \
AIR_UHD_MAX_DROP_PERCENT=10 \
npm run qualify:uhd
```

Hosted CI uses a 24 FPS source with a 22 FPS floor and the same 5% drop ceiling
because shared runners do not provide a stable hardware decoder. It still
requires actual 4K frame presentation and uploads the JSON evidence artifact.
