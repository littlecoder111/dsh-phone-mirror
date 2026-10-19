# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-19

### Added

- Right-sidebar phone mirror with scrcpy 4.1 and jmuxer/MSE decoding.
- Touch, swipe, hardware keys, wake, volume and text input in the panel.
- Left-sidebar footer entry that opens the mirror tab.
- Agent tools: `phone_devices`, `phone_screenshot`, `phone_ui`, `phone_tap`,
  `phone_swipe`, `phone_key`, `phone_text`, `phone_open`, `phone_ls`,
  `phone_pull`, `phone_push`.
- Two-way file transfer with a 300 MB default per-file limit.
- Three-state permissions for view, control, keys, input and files, with
  full-control / mirror-only / ask-each-time / custom presets.
- Persisted permission settings in `$DSH_HOME/dsh-phone-mirror.json`.
- DSH approval integration for the "ask each time" mode.
- Chinese and non-ASCII text input via scrcpy clipboard paste.
