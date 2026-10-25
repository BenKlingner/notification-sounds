# Security scope

Notification sounds is a trusted local Paseo plugin. Its server runs with the
Paseo daemon user's filesystem and desktop-session permissions. It is not a
sandbox for untrusted users, plugins, or local processes.

## Boundaries and controls

- Paseo owns connection authentication and access to plugin RPCs. This plugin
  does not expose an HTTP listener or implement separate user accounts.
- Shared Zod schemas validate RPC inputs. Custom sound IDs are confined to the
  library; explicit imports intentionally accept user-selected host paths.
- Existing symlinks, junctions, non-regular audio files, traversal IDs, and Windows
  alternate data stream IDs are rejected. Linux library operations anchor every
  directory component with open descriptors to resist parent replacement races.
- **On macOS and Windows, directory validation uses pathname APIs. A concurrent
  local process that can replace directories can still redirect an operation.**
  Do not treat the library as a confinement boundary against such a process.
  Hardlinks and hostile filesystem mounts are also outside that boundary.
- Reads are bounded to 5 MB per file. Imports use exclusive file creation, a
  serialized and bounded mutation queue, a 5,000-file / 256 MB library budget,
  four directory levels, and scan entry/time limits. An incomplete inventory
  prevents further imports. These budgets do not constrain files added externally.
- Audio is sent only to the connected Paseo client. There are no background
  third-party network requests, telemetry endpoints, credentials, or secret storage.
  About-page links open GitHub only when selected; the logo is embedded and works offline.
- External commands use fixed executables and argument arrays, without a shell.
  D-Bus calls have time/output limits. Media holds expire, and only successfully
  paused players are candidates for resuming.
- Client audio caches and pending playback are bounded. Disposal cancels pending
  plugin work; Paseo owns cancellation of audio already handed to the host.
- Missing or failed project context suppresses notifications when project rules
  exist, so a lookup failure cannot bypass a project mute.
- React Native text rendering handles display strings. There is no HTML injection,
  dynamic code evaluation, SQL, webhook, redirect, or browser cookie handling.

## Verification and remaining release checks

`npm test` exercises filesystem confinement, exclusive imports and quotas,
playback/cache lifecycle, project rule failures, audio transformations, and media
transition races. `npm run typecheck` validates the current Paseo API contract.
The lockfile pins the development dependency tree; there are no production
package dependencies. Run `npm audit` again when preparing a release.

Tests use a mocked Paseo host and D-Bus transport. Live media-player behavior,
macOS/Windows behavior, mobile playback, compact/wide layouts, and light/dark
appearance still require manual release testing. Security checks do not establish
rights to distribute assets: retain the recorded-sound permission separately and
keep the restrictions in OVERVIEW.md with every release. The MIT license covers
the plugin code, not the separately licensed Envato recordings.
