# Contributing

Thanks for considering a contribution. This project is a DeepSeek Harness
plugin that mirrors and controls an Android phone; changes that affect device
control, permissions, or file transfer get extra review.

## Development setup

- Node.js 20+.
- A DeepSeek Harness checkout or installation with the Web UI.
- Android platform-tools (`adb`) and a phone with USB debugging enabled.
- No package dependencies and no build step.

```bash
git clone <your-fork-url> dsh-phone-mirror
cd dsh-phone-mirror
npm run check
```

`npm run check` runs `node --check` on both halves. It does not need
`node_modules`.

## Trying a change

1. Install the directory as a DSH plugin bundle.
2. Refresh the Web UI.
3. Open the Phone Mirror panel from the phone icon at the bottom of the left
   sidebar, or call `phone_devices` from the agent.
4. Verify the affected path on a real device when possible: mirror, touch,
   keys, text (ASCII and non-ASCII), screenshots, UI tree, push/pull, and each
   permission mode.

Controls and file operations must respect the permission model. If you add a
new agent tool, gate it through the existing `requirePhonePermission` helper
and document its capability in the permission settings.

## Code style

- Plain ESM JavaScript; no bundler, no TypeScript, no runtime dependencies.
- The browser half is a `window.__ModuleLoader__` factory that returns
  `{ inject, apply }`.
- Keep the host half self-contained; Node built-ins only.
- Use the host theme tokens (`--dsw-alias-*`) for panel styling, and keep
  strings in both `locale/en.json` and `locale/zh.json` for display metadata.
- Keep WebSocket messages and tool output bounded. Do not log device content
  or filesystem paths beyond what the user needs.

## Pull requests

- Keep the change focused and explain the user-visible effect.
- Include the commands you ran and the device/Android version you tested with.
- Update `README.md`, `README.en.md`, and `CHANGELOG.md` for behavior
  changes.
- Do not commit a real device serial, personal screenshots, `phone-files/`,
  permission config files, or absolute paths from your machine.
- By contributing you agree that your contribution is licensed under the MIT
  license of this repository.

## Reporting bugs

Use the issue templates. For security issues, follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.
