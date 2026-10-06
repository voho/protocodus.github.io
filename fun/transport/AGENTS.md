# Transport project decisions

## Supported devices

The user decided on 2026-10-06 that Transport is a computer-only game because phone support adds friction.

- Support desktop and laptop browsers with a keyboard and mouse or trackpad. Preserve desktop keyboard accessibility, trackpad scrolling and zoom, display density support, and laptop-sized layouts.
- Phones and tablets show only the exact message `please use computer to play the game` before the game starts. Do not generate or restore a world, initialize gameplay, or alter saved games on these devices.
- Do not add phone gameplay, mobile navigation, bottom sheets, touch placement, multi-touch map gestures, phone safe-area layouts, or phone gameplay test matrices unless the user explicitly changes this decision.
- A narrow computer window, browser zoom, or a touchscreen on a computer does not by itself make it a phone. Keep computer gameplay usable with keyboard and pointer controls.
- Verify the unsupported-device message with a small entry-screen check; gameplay and UI checks target computers.

This decision overrides older phone requirements in feature notes. [DESIGN.md](DESIGN.md), [README.md](README.md), and [ARCHITECTURE.md](ARCHITECTURE.md) describe the current computer interface.
