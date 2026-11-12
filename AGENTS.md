# KickTV for webOS — Agent Instructions

## Purpose and scope

KickTV is a third-party Kick live-stream viewing application for LG webOS TVs. Prioritize reliable playback, remote-control usability, responsive UI, and maintainable code. Follow the repository's actual implementation over assumptions in this document; if they conflict, inspect and report the discrepancy before changing architecture.

These instructions apply to the entire repository unless a more specific `AGENTS.md` overrides them.

## Architecture

- The current target architecture is **direct HLS on the TV** (`direct-hls`): the webOS app performs stream discovery and any necessary JavaScript challenge handling, obtains the HLS URL, and plays media from the provider/CDN directly.
- **Do not assume a Python, Streamlink, proxy, or self-hosted server is required.** Legacy server-related code or documentation may exist; verify whether it is active before touching it.
- Do not introduce a backend, proxy, external runtime service, or new network dependency without explicit approval and a clear technical justification.
- Keep stream discovery/challenge handling, playback, UI controls, settings, and (future) chat logically separated. Avoid unnecessary coupling.
- Treat URLs, tokens, cookies, and responses from external services as untrusted. Do not log or commit secrets or session data. Do not weaken browser/webOS security protections to make a feature work.

## Platform and performance

- Target LG OLED C3 with webOS 25; verify compatibility with the actual webOS browser/runtime and the project's existing APIs before adopting features.
- Prefer lightweight, locally bundled assets and broadly supported web standards. Avoid CDN dependencies for core UI assets and unnecessary frameworks.
- Minimize expensive layout/repaint work, excessive polling, and persistent overlays. Hidden controls and gradients must actually disappear to avoid unnecessary static OLED elements.
- Preserve HLS playback stability, buffer behavior, reconnection handling, and resource cleanup. Do not restart playback merely to update layout or show/hide controls.

## Interface and navigation

- Design for a television viewed from a distance, not a desktop browser. Keep controls compact but focus/activation targets comfortably sized.
- Use **Phosphor Icons** as the consistent icon family. Prefer official, locally bundled assets; do not hand-draw replacement icons, mix icon families, or use emoji as control icons.
- The visual direction is a minimal Twitch-like control bar and settings hierarchy, with a smooth black-to-transparent gradient behind lower controls.
- Support directional navigation, OK/Enter, and Back using the project's existing focus-management conventions. Focus must remain visible and predictable; hidden or disabled elements must not receive focus.
- Preserve accessible labels and visible states (focused, selected, disabled). Do not rely on color alone to communicate state.
- Controls and their gradient should share visibility transitions and not obstruct video or remote interactions when hidden.
- The product has **exactly two intended viewing modes**: theater (video with chat alongside) and fullscreen (video without chat). Do not invent a third viewing mode.
- Keep the player controls independent of screen dimensions and chat layout so switching modes will not recreate the media player or interrupt playback.

## Feature boundaries and roadmap

Implement only the requested step. The intended order is:

1. Visual refresh: Phosphor Icons and compact controls, preserving existing actions.
2. Settings UI: submenus, switches, and radio selection for available qualities.
3. Essential playback controls: play/pause, volume/mute, theater/fullscreen behavior.
4. Investigate and, if feasible, implement live DVR/seeking based on the actual accessible HLS window or provider capabilities.
5. Integrate Kick chat, including remote navigation and theater layout.
6. Refine diagnostics, animations, stability, and performance.

This is a **roadmap, not authorization** to implement future steps. Do not add nonfunctional controls that appear actionable. If a planned control has no implementation, clearly disable it or omit it from focus until it works.

For live playback, distinguish pausing the HTML media element from DVR/time-shift support. Never claim that the stream supports arbitrary seeking without verifying the available media timeline. Do not add server-side recording as a shortcut without approval.

## Change discipline

- Inspect relevant source files, existing conventions, and available tests before editing. Make the smallest coherent change that satisfies the request.
- Preserve working features: direct HLS discovery/playback, existing quality selection, reload, official-player fallback, statistics, remote navigation, and visibility behavior where present.
- Avoid speculative refactors, unrelated dependency upgrades, generated custom SVGs, and architecture changes outside the task.
- Reuse existing components and styles. Keep UI state, playback state, and network state distinct.
- Handle failures explicitly and provide a usable recovery path; avoid silent failures and infinite retries.
- Never hardcode credentials, tokens, cookies, private URLs, or personal data. Keep sensitive values out of commits and logs.
- If requirements are ambiguous or conflict with existing behavior, explain the tradeoff and ask before making a consequential change.

## Validation and delivery

- Run the repository's relevant lint, build, and tests when available; do not invent test commands or claim tests were run when they were not.
- Check focus movement, OK/Back behavior, visibility transitions, disabled controls, and that controls cannot capture input when hidden.
- For playback-related changes, check startup, stream changes, recovery, cleanup, and no unexpected reloads. State clearly what still requires on-device testing.
- At completion, summarize: changes made, files changed, tests/checks actually run and their results, remaining limitations, and any manual webOS validation needed.
- Do not start the next roadmap phase without explicit authorization.
