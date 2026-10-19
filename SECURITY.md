# Security policy

## Supported versions

The latest `0.1.x` release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for an exploitable problem. Use the
repository's **Security → Report a vulnerability** flow (GitHub private
security advisories) and include:

- affected version and platform;
- a concise reproduction, including whether a physical device is involved;
- impact (for example: permission bypass, arbitrary file read/write, local
  WebSocket origin bypass, command injection);
- any suggested fix.

You will get an acknowledgement through the advisory. Please allow time for a
fix before public disclosure.

## Scope

In scope:

- bypassing the three-state permission model;
- reaching the mirror WebSocket or RPC routes from a non-local origin;
- path traversal or unintended writes through `phone_push` / `phone_pull`;
- injection through remote paths, URLs, or text commands;
- leaking device content or local files through logs, screenshots, or tool
  results.

Out of scope:

- risks that require an already-compromised local account or a malicious
  `adb`;
- the behavior of third-party apps on the phone;
- scrcpy, jmuxer, or Android platform-tools vulnerabilities (report those
  upstream, though a note is welcome if this integration makes them worse).

This plugin intentionally grants phone control to the local agent. The
permission settings exist to bound that control, not to sandbox a hostile
local process.
