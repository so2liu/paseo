# CLAUDE.md

Paseo is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, GitHub Copilot, OpenCode, and Pi.

## Fork ownership, upstream sync, and deployment

This repository is our fork of `getpaseo/paseo`, customized according to the owner's preferences. We build and deploy this customized fork on the owner's Mac and to the owner's iPhone for everyday development use.

- Treat `so2liu/paseo` (`origin`) as our fork and `getpaseo/paseo` (`upstream`) as the upstream project.
- Agents may commit completed, verified, in-scope work and push it to `origin` without waiting for a separate commit or push request. If the owner explicitly asks to keep changes local, leave them uncommitted, create a draft only, or not push, follow that instruction. Never push directly to `upstream`.
- **Never push to `main` — not even a docs-only or one-line change.** Branch, push the branch, open a PR against `so2liu/paseo`, and let the automated review run. "The change is trivial" and "the owner asked me to push" are not exemptions; pushing means pushing a branch. Release tags are the one exception — `git push origin v0.2.2-LY.2` is a tag push, not a branch push, and is how [docs/fork-releases.md](docs/fork-releases.md) says to cut a release.
- When the owner asks to pull, sync, or update from upstream, handle the Git operations for them and update from the **newest upstream release tag by publish date**, not from an arbitrary `upstream/main` commit. **Pick by recency, not by channel — a beta is a perfectly good base when it is the newest.** Betas and stables compete on equal footing; never hold out for a stable, and never assume the newest tag is a prerelease either. List upstream's releases with their dates and take the top one. The failure this rule replaces: an earlier version of it said to sync from "the latest beta", and at `v0.2.3` every remaining prerelease (`v0.2.0-beta.4` and older) was already behind the newest stable, so following it would have synced backwards a whole minor line.
- Preserve our custom features and behavior when updating. Rebase, merge, or port the custom commits onto the selected base tag as appropriate, and verify that the resulting tree still contains the intended customizations.
- When both our fork and upstream contain a fix for the same bug, prefer the upstream implementation. Remove or adapt our redundant fix only after confirming that the upstream fix covers the same behavior; retain unrelated custom behavior.
- Every daemon deployment and every iOS build or installation for the owner's iPhone must be produced from the current customized fork state. Never deploy an unmodified upstream checkout, upstream tag, or upstream prebuilt artifact in place of our customized version.
- **Routine iPhone deployments must overwrite `Paseo Debug` while retaining Release performance.** App variant and compiler configuration are independent axes: use `APP_VARIANT=development` for the `Paseo Debug` identity (`com.so2liu.paseo.debug`), and use Xcode `Release` configuration for the optimized runtime. From `packages/app`, the expected flow is `CI=1 APP_VARIANT=development npx expo prebuild --platform ios`, followed by `CI=1 APP_VARIANT=development npx expo run:ios --configuration Release --device <physical-device-udid> --no-bundler`. Do not use `APP_VARIANT=production` for routine owner-device installs: its `com.so2liu.paseo` bundle identifier creates a second app instead of replacing `Paseo Debug`. Do not infer runtime performance from the `Paseo Debug` name; a development app variant built with Xcode Release has Release performance. Use Xcode Debug configuration only when an interactive native debugging session is explicitly needed. Three device-side prerequisites bite in confusing ways — Developer Mode blocking the _build_ rather than the install, a never-before-seen device needing one Xcode GUI build to register, and `expo run:ios` failing at install after a clean compile. Read [docs/development.md](docs/development.md#ios-physical-device-deployment) before deploying to a device for the first time, and install with `xcrun devicectl device install app` rather than letting Expo do it.
- Treat owner fleet upgrades as a matched deployment unless the owner explicitly narrows the scope: update the Linux daemon on `box`, and update both the macOS Desktop app and the separately installed macOS daemon on every targeted owner Mac, all from the same customized-fork commit. Installing the Desktop app alone does not update an already-running external daemon.
- **On a Mac, any Paseo "update" or "upgrade" means a whole-machine upgrade: Desktop app plus the separately installed daemon/CLI.** This applies even when the request calls out one component, such as "upgrade the local daemon"; naming a component identifies the immediate concern but does not narrow the deployment. Only an explicit exclusion such as "only upgrade the daemon; do not upgrade Desktop" narrows the scope.
- For a whole-machine Mac upgrade, rebuild the client app (`packages/app`) and Desktop wrapper (`packages/desktop`) into the macOS Desktop app, install `/Applications/Paseo.app`, and upgrade the separately installed macOS daemon/CLI from the same customized-fork commit. Restart the daemon and verify the installed Desktop app plus CLI/daemon versions. The upgrade is not complete after replacing only the app, only the Desktop wrapper, or only the daemon.

### Resolving an upstream sync

A sync merge is mostly mechanical, but the failures are silent — a dropped dependency
or a broken type shows up long after the merge looks clean. Work in this order.

- **Never resolve a conflict with `git checkout --theirs <file>` (or `--ours`).** It
  replaces the **entire file**, not the conflicting hunks, so every fork change
  elsewhere in that file is discarded without a warning. The `v0.2.3` sync lost
  `packages/app`'s `mermaid` dependency and `build:mermaid-webview` scripts this
  way — the conflict was one version line, but the whole file was swapped. Edit the
  conflict markers directly and keep the rest of the merged content.
  `--theirs` is only safe when the file is entirely upstream's and the fork has never
  touched it — prove it with `git log v<base>..HEAD -- <file>` first, as with
  `CHANGELOG.md`.
- **Version-only conflicts still take the upstream number.** All `package.json`
  versions follow upstream (see [docs/development.md](docs/development.md#custom-fork-build-identity)) — just change the
  version lines rather than the file.
- **For `package-lock.json`, take upstream's and then run `npm install`.** That
  reconciles the lockfile against the merged manifests and restores fork-only
  dependencies. Confirm afterwards that the fork dependency is back in all three
  places: the manifest, the lockfile, and `node_modules`.
- **Rebuild the whole stack before believing a type error.** `npm run build:client`
  does not rebuild `relay` or `highlight`, so their stale `dist` declarations produce
  errors in files that neither side edited — during this sync, `relay-transport.ts`
  and `daemon-client-relay-e2ee-transport.ts` both failed that way and were fine after
  `npm run build:server`. Diagnose only after a full rebuild.
- **Expect semantic conflicts that Git merges cleanly.** When upstream adds a required
  field to a type and the fork has customized a fixture or caller for it, the merge
  succeeds and the types break. `npm run typecheck` is what catches these, so it is
  mandatory after a sync, not optional. `strategy-web.test.tsx` needed upstream's new
  `olderHistoryProgressKey` added to the two fixtures we had customized.
- **When upstream fixes the same bug we did, compare the actual values before
  deferring.** The rule to prefer upstream's implementation assumes it covers our
  behavior. Upstream's `v0.2.3` raised the idle-agent TTL from 2 minutes to 30, but the
  owner asked for a full hour — so our fix was not redundant and stayed. The sweep
  interval in the same hunk was never ours, and took upstream's value.
- **Verify the customizations survived, explicitly.** Grep for each one after the merge
  rather than assuming: the Volcengine STT provider, the SQLite timeline store, the
  `mermaid` dependency, `so2liu` in `electron-builder.yml`, the fork's Expo project ID
  in `app.config.js`, and the one-hour idle TTL.
- **The LY counter restarts when the upstream base moves.** After syncing to `0.2.3`,
  the next fork release is `v0.2.3-LY.1`, not `LY.3`.

### Two delivery channels, and why owner machines report an upstream version

The fork ships desktop builds two different ways. Both are correct; do not "fix" one into the other.

| Channel                                                   | App version reports | Auto-update                                         |
| --------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| Tag `vX.Y.Z-LY.N` → `fork-macos-release.yml` builds a DMG | `0.2.2-LY.1`        | Participates — the feed serves the next `LY.N`      |
| Hand-built (the routine owner upgrade above)              | `0.2.2`             | Does not participate — replaced by the next rebuild |

- **The release version scheme is `<upstream version>-LY.<n>` — a hyphen, not a plus.** SemVer ignores `+build.metadata` when comparing, so `0.2.2+LY.2` and `0.2.2+LY.1` rank equal and auto-update would never fire. The counter has to sit in the prerelease position. See [docs/fork-releases.md](docs/fork-releases.md) for the full rules, including why the separator must be `LY.3` and not `LY-3`.
- **Do not confuse that with the `+LY` runtime marker.** `daemon-version.ts` appends `+LY` to whatever version is installed purely to mark "this is a fork build". It carries no counter, and it is not the release version.
- **A hand-built install reporting a plain upstream version is expected, not a regression.** Routine owner upgrades deliberately leave `packages/desktop/package.json` on the upstream version, so the installed app reports e.g. `0.2.2` while the feed's newest is `0.2.2-LY.1`. Since `0.2.2-LY.1 < 0.2.2`, that machine's "check for updates" will always say it is current. That is fine — those machines are updated by rebuilding, not by the feed. Only put a machine on the auto-update track by installing a CI-built LY DMG, or by setting the desktop package version to the target `X.Y.Z-LY.N` before building locally.
- **Never use the reported version to decide whether a daemon upgrade landed.** Consecutive fork commits usually share one workspace version, so old and new both report `0.2.2+LY`. Assert on the release path instead — see [docs/development.md](docs/development.md#macos-launchd-daemon-upgrade-safety).

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Mobile + web client (Expo)
- `packages/cli` — Docker-style CLI (`paseo run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access
- `packages/desktop` — Electron desktop wrapper
- `packages/website` — Marketing site (paseo.sh)

## Docs

`docs/` is the source of truth for system-level and process-level knowledge. **"The docs", "check the docs", or "check the X docs" always mean this directory — not the web.** Look here before fetching anything online; the docs capture gotchas and conventions you cannot derive from the code or external sources.

At the start of non-trivial work, list `docs/` and skim anything relevant to the task. When you learn something meta worth preserving — a gotcha, a convention, a workflow, a piece of system context that will outlive the current task — update an existing doc or propose a new one. Code-level facts belong in inline comments next to the code; system, process, and gotcha-level facts belong in `docs/`.

| Doc                                                                | What's in it                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/product.md](docs/product.md)                                 | What Paseo is, who it's for, where it's going                                                                                  |
| [docs/architecture.md](docs/architecture.md)                       | System design, package layering, WebSocket protocol, agent lifecycle, data flow                                                |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)                 | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                                  |
| [docs/data-model.md](docs/data-model.md)                           | File-based JSON persistence, Zod schemas, atomic writes, no migrations                                                         |
| [docs/glossary.md](docs/glossary.md)                               | Authoritative terminology — UI label wins, no synonyms                                                                         |
| [docs/coding-standards.md](docs/coding-standards.md)               | Type hygiene, error handling, state design, React patterns, file organization                                                  |
| [docs/design.md](docs/design.md)                                   | Theme tokens — colors, fonts, spacing, radii, icons                                                                            |
| [docs/forms.md](docs/forms.md)                                     | Form architecture — non-React form model, form kit, load-state gating; the schedule form is the golden example                 |
| [docs/hover.md](docs/hover.md)                                     | Hover — the canonical pattern (plain View + onPointerEnter/Leave, separate inner Pressable) and the three ways agents break it |
| [docs/unistyles.md](docs/unistyles.md)                             | Unistyles gotchas — `useUnistyles()` is forbidden, alternatives in order                                                       |
| [docs/floating-panels.md](docs/floating-panels.md)                 | Anchored popovers — Portal/Modal escape for Android, lifecycle gates, keyboard-shared-value, status-bar offset, the flash      |
| [docs/expo-router.md](docs/expo-router.md)                         | Expo Router route ownership, startup restore, and native blank-screen gotchas                                                  |
| [docs/file-icons.md](docs/file-icons.md)                           | Material icon theme integration for the file explorer                                                                          |
| [docs/file-preview.md](docs/file-preview.md)                       | File preview render modes, Mermaid bundle, HTML sandbox, and security boundaries                                               |
| [docs/providers.md](docs/providers.md)                             | Adding a new agent provider end-to-end                                                                                         |
| [docs/speech-providers.md](docs/speech-providers.md)               | Speech slots, provider selection, Volcengine streaming ASR setup, hotwords, adding a provider                                  |
| [docs/forge-providers.md](docs/forge-providers.md)                 | Adding a git forge: registry/manifest, drop-in checklist, self-host/GHES, the two facts tiers                                  |
| [docs/custom-providers.md](docs/custom-providers.md)               | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                              |
| [docs/service-proxy.md](docs/service-proxy.md)                     | Service proxy: exposing workspace scripts at public URLs, DNS setup, reverse proxy config                                      |
| [docs/development.md](docs/development.md)                         | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP                                                     |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                 | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                           |
| [docs/protocol-validation.md](docs/protocol-validation.md)         | zod-aot generated inbound WebSocket validation, patched compiler regressions, schema-purity rules                              |
| [docs/terminal-performance.md](docs/terminal-performance.md)       | Terminal latency pipeline, coalescing/backpressure invariants, benchmark + perf spec usage                                     |
| [docs/testing.md](docs/testing.md)                                 | TDD workflow, determinism, real dependencies over mocks, test organization                                                     |
| [docs/mobile-testing.md](docs/mobile-testing.md)                   | Maestro and mobile test workflows                                                                                              |
| [docs/mobile-panels.md](docs/mobile-panels.md)                     | Compact left/center/right panel ownership, worklet motion, gesture revisions, and Fabric constraints                           |
| [docs/mobile-lite.md](docs/mobile-lite.md)                         | Native companion scope, text-first rendering, background timeline policy, and notification invariants                          |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md)     | Isolated in-process daemon test harness                                                                                        |
| [docs/browser-capture-harness.md](docs/browser-capture-harness.md) | Real-Electron browser screenshot harness and compositor-surface gotcha                                                         |
| [docs/android.md](docs/android.md)                                 | App variants, local/cloud builds, EAS workflows                                                                                |
| [docs/docker.md](docs/docker.md)                                   | Running the daemon and bundled web UI in Docker, volumes, agent images, security                                               |
| [docs/release.md](docs/release.md)                                 | Release playbook, draft releases, completion checklist                                                                         |
| [docs/fork-releases.md](docs/fork-releases.md)                     | This fork's macOS release flow — `vX.Y.Z-LY.N` tags, the auto-built DMG, update feed, signing secrets                          |
| [docs/terminal-activity.md](docs/terminal-activity.md)             | Terminal activity indicators — source-agnostic tracker, agent hook reporting, adding a new hook provider                       |
| [SECURITY.md](SECURITY.md)                                         | Relay threat model, E2E encryption, DNS rebinding, agent auth                                                                  |

## Quick start

```bash
npm run dev                          # Start the dev daemon
npm run dev:app                      # Start Expo against the dev daemon
npm run dev:desktop                  # Start Electron desktop dev
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

Repo dev commands use checkout-local state by default. In this checkout, `PASEO_HOME` resolves to `.dev/paseo-home`, and `npm run cli -- ...` targets that same dev home automatically. The packaged desktop app and production-style daemon keep using `~/.paseo` on port `6767`.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Paseo daemon on port 6767 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **A launchd-managed macOS daemon must remain launchd-owned during upgrades.** Do not run `paseo daemon restart` while `com.paseo.daemon` is loaded: that command starts a detached supervisor, while launchd keeps trying to start its own copy. Do not use `launchctl submit` as a one-shot recovery mechanism; submitted jobs are kept alive after failure and can repeat destructive actions. Before any permitted restart, inspect the current process manager and prepare an out-of-band recovery path that does not depend on the daemon being restarted. See [docs/development.md](docs/development.md#macos-launchd-daemon-upgrade-safety).
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **Before changing app routes, startup routing, remembered workspace restore, or active workspace selection, read [docs/expo-router.md](docs/expo-router.md).**
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Two separate contracts:
  - **Protocol contract (always):** schema changes must not break parsing in either direction. An old client must still parse messages from a new daemon; a new daemon must still parse messages from an old client.
    - New fields: `.optional()` with a sensible default.
    - Never flip optional → required, remove fields, or narrow types (`string` → `enum`, `nullable` → non-null).
    - Removed fields stay accepted (we stop sending them, not stop reading them).
    - Test with: "does a 6-month-old client still parse this?" and "does a 6-month-old daemon still send something this client accepts?"
    - Wire schemas are pure structural declarations. Do not add `.transform()`, `.catch()`, or `.preprocess()` to WebSocket message schemas; put normalization in an explicit post-validation pass.
    - Plain `z.union()` is forbidden when every branch has a shared literal tag. Use `z.discriminatedUnion()` unless generated-code regression tests prove that specific shape is miscompiled.
    - `.default()` is acceptable on primitive leaves only. Never put defaults on item schemas for large arrays or big inbound containers.
  - **Feature contract (per-feature):** a new feature may require a new daemon capability. The client detects whether the capability is present and either runs the feature or shows "Update the host to use this." That's it.
    - **No fallback paths.** Don't write a degraded version of a new feature that runs on old daemons. Don't fan out across legacy RPCs to simulate a missing capability. The user upgrades or doesn't get the feature.
    - **No defensive branches scattered through the feature.** Capability detection happens in one place; downstream code reads a clean shape.
    - **Capability flags live in `server_info.features.*`** with a single `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` comment marking the cleanup site.
    - Existing functionality keeps working across versions — that's the protocol contract doing its job. New-feature degradation is not the goal.
    - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

- **All back-compat shims are tagged and dated for cleanup.** Every shim that exists for old-client/old-daemon support carries a `COMPAT(name)` comment with the version it was added in and a target removal date (typically 6 months out). One grep — `rg "COMPAT\("` — should produce the full list of cleanup work. Don't bury back-compat in untagged `??`-fallbacks or optional-chain tunnels — that's how it stops being deletable.

## Platform gating

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Electron is still the Metro `web` platform, but desktop dev/build sets `PASEO_WEB_PLATFORM=electron`, so Metro first looks for `.electron.*` files and falls back to normal `.web.*` files. Use this when the implementation depends on Electron-only behavior such as `webviewTag`, desktop preload APIs, or the Electron bridge. Keep plain browser web in `.web.*`, and keep native fallbacks in the base file or `.native.*`.
  ```
  components/
    browser-pane.electron.tsx ← Electron <webview> implementation
    browser-pane.web.tsx      ← plain web fallback
    browser-pane.tsx          ← native fallback
  ```
  Import as `@/components/browser-pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $PASEO_HOME/daemon.log
