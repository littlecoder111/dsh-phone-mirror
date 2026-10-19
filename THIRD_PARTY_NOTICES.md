# Third-party notices

This project is MIT-licensed. It bundles or adapts the following third-party
software. Those components remain under their own licenses.

## scrcpy

- Project: https://github.com/Genymobile/scrcpy
- Copyright: Genymobile and scrcpy contributors
- License: Apache License 2.0 (see [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt))
- Bundled file: `resources/scrcpy-server-v4.1`

The official scrcpy server is pushed to the connected device at runtime and is
not modified by this project.

## jmuxer

- Project: https://github.com/samirkumarexit/jmuxer
- Copyright: Samir Kumar Das
- License: MIT (see [LICENSES/jmuxer-MIT.txt](LICENSES/jmuxer-MIT.txt))
- Bundled file: `resources/jmuxer.min.js`

jmuxer remuxes the H.264 stream into fragmented MP4 for MSE playback in the
browser.

## Minimal WebSocket framing

The WebSocket handshake and frame helpers in `index.js` are adapted from
`@nszzj/dsh-android-scrcpy` (MIT, Copyright (c) nszzj), which follows RFC 6455.
The code was reduced and renamed for this project.

MIT License text for that adaptation is the same as the jmuxer license above.

## Trademarks

Android is a trademark of Google LLC. Microsoft Edge, DeepSeek, and other
names are trademarks of their respective owners. This project is not
affiliated with or endorsed by them.
