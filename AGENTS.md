# KickLeaf for webOS — Agent Instructions

These instructions apply to the repository unless a more specific `AGENTS.md` overrides them. KickLeaf is an independent Kick viewing app for LG webOS TVs. The functional baseline for these instructions is v0.2.9. Check the source and manifests before changing behavior.

## Runtime architecture

- `app/appinfo.json` defines the application ID `com.kickleaf.client`. The packaged JavaScript service is `com.kickleaf.client.service`. Target the LG OLED C3 with webOS 25 and verify API compatibility on the device when needed.
- Direct HLS is the default. The web app discovers the stream and the native video element receives media from the CDN. The current discovery makes ordinary requests and has no JavaScript challenge handler. Preserve its origin, TLS, and request restrictions.
- `native-hls` uses the optional Python discovery backend. The official iframe is an explicit fallback with its own limitations. Keep the HLS diagnostic independent of Kick playback. See the [player guide](docs/PLAYER.md).
- Theater and fullscreen are the two HLS viewing layouts. Theater starts public, read-only chat through the packaged Luna service. Centrifugo transport and the local FIFO/DOM ACK are independent. Keep video playback independent of chat and preserve queue admission, credit, deduplication, draining, and cleanup. See the [chat guide](docs/CHAT.md).
- Get explicit approval before adding a backend, proxy, runtime dependency, or external service. Treat external URLs, credentials, cookies, images, and message content as untrusted. Keep secrets, signed URLs, raw chat data, and private captures out of logs and commits.

## UI and performance

- Design for television viewing and Magic Remote navigation. Preserve visible focus, accessible labels, arrow/OK/Back behavior, and the priority of the virtual keyboard. Hidden or disabled controls must be excluded from navigation.
- Use locally bundled Phosphor icons for player controls. Keep transient controls and gradients linked, and avoid persistent overlays or excessive polling. Layout changes must preserve the video instance and its buffer.
- The code supports pause and limited resume inside the accessible HLS window. Manual live seeking and DVR remain future work. Avoid exposing controls for capabilities the current runtime cannot provide.

## Changes and verification

- Keep scope to the requested change. Reuse existing boundaries among discovery, playback, controls, transport, and rendering. Preserve behavior of optional modes and cleanup on channel changes, reload, and exit.
- Use the [test guide](docs/TESTES.md) and [telemetry guide](docs/TELEMETRIA-FASE-2.md). Report simulated tests separately from on-device results. For UI changes, verify focus and visibility. For playback or chat changes, verify recovery and release of prior resources.
- Check packaging with the repository's existing scripts when runtime files change. The explicit allowlist in `packaging.json` governs the IPK. Keep experimental sources, untracked documents, and raw captures out of Git unless publication is explicitly requested.
- Preserve experimental reports R001–R040 and their provenance. Attribute historical results to the tested version and scope. Follow the [changelog](CHANGELOG.md) for released behavior and keep installation instructions aligned with the current manifest.
