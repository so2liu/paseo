# CLAUDE.md

Paseo is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, GitHub Copilot, OpenCode, and Pi.

## Fork ownership, upstream sync, and deployment

This repository is our fork of `getpaseo/paseo`, customized according to the owner's preferences. We build and deploy this customized fork on the owner's Mac and to the owner's iPhone for everyday development use.

- Treat `so2liu/paseo` (`origin`) as our fork and `getpaseo/paseo` (`upstream`) as the upstream project.
- Agents may commit completed, verified, in-scope work and push it to `origin` without waiting for a separate commit or push request. If the owner explicitly asks to keep changes local, leave them uncommitted, create a draft only, or not push, follow that instruction. Never push directly to `upstream`.
- **Never push to `main` — not even a docs-only or one-line change.** Branch, push the branch, open a PR against `so2liu/paseo`, and let the automated review run. "The change is trivial" and "the owner asked me to push" are not exemptions; pushing means pushing a branch. Release tags are the one exception — `git push origin v0.2.2-LY.2` is a tag push, not a branch push, and is how [docs/fork-releases.md](docs/fork-releases.md) says to cut a release.
- When the owner asks to pull, sync, or update from upstream, handle the Git operations for them and update from the **newest upstream release tag by publish date**.
  - **Never sync from `upstream/main`, and never from a bare commit SHA.** `main` carries unreleased, unstabilized work; basing the fork on it imports breakage that upstream has not shipped to anyone yet, and there is no version number to anchor our own `-LY.N` line to. The base is always a tag. "Take the newest commit" is not a shortcut to "take the newest release" — if the newest release is a week old, a week old is the correct base.
  - **Pick by recency, not by channel — a beta is a perfectly good base when it is the newest.** Betas and stables compete on equal footing; never hold out for a stable, and never assume the newest tag is a prerelease either. List upstream's releases with their dates and take the top one. The failure this rule replaces: an earlier version of it said to sync from "the latest beta", and at `v0.2.3` every remaining prerelease (`v0.2.0-beta.4` and older) was already behind the newest stable, so following it would have synced backwards a whole minor line.
- Preserve our custom features and behavior when updating. Rebase, merge, or port the custom commits onto the selected base tag as appropriate, and verify that the resulting tree still contains the intended customizations.
- When both our fork and upstream contain a fix for the same bug, prefer the upstream implementation. Remove or adapt our redundant fix only after confirming that the upstream fix covers the same behavior; retain unrelated custom behavior.
- Every daemon deployment and every iOS build or installation for the owner's iPhone must be produced from the current customized fork state. Never deploy an unmodified upstream checkout, upstream tag, or upstream prebuilt artifact in place of our customized version.
- **Routine iPhone deployments must overwrite `Paseo Debug` while retaining Release performance.** App variant and compiler configuration are independent axes: use `APP_VARIANT=development` for the `Paseo Debug` identity (`com.so2liu.paseo.debug`), and use Xcode `Release` configuration for the optimized runtime. From `packages/app`, the expected flow is `CI=1 APP_VARIANT=development npx expo prebuild --platform ios`, followed by `CI=1 APP_VARIANT=development npx expo run:ios --configuration Release --device <physical-device-udid> --no-bundler`. Do not use `APP_VARIANT=production` for routine owner-device installs: its `com.so2liu.paseo` bundle identifier creates a second app instead of replacing `Paseo Debug`. Do not infer runtime performance from the `Paseo Debug` name; a development app variant built with Xcode Release has Release performance. Use Xcode Debug configuration only when an interactive native debugging session is explicitly needed. Three device-side prerequisites bite in confusing ways — Developer Mode blocking the _build_ rather than the install, a never-before-seen device needing one Xcode GUI build to register, and `expo run:ios` failing at install after a clean compile. Read [docs/development.md](docs/development.md#ios-physical-device-deployment) before deploying to a device for the first time, and install with `xcrun devicectl device install app` rather than letting Expo do it.
- Treat owner fleet upgrades as a matched deployment unless the owner explicitly narrows the scope: update the Linux daemon on `box`, and update both the macOS Desktop app and the separately installed macOS daemon on every targeted owner Mac, all from the same customized-fork commit. Installing the Desktop app alone does not update an already-running external daemon.
- **On a Mac, any Paseo "update" or "upgrade" means a whole-machine upgrade: Desktop app plus the separately installed daemon/CLI.** This applies even when the request calls out one component, such as "upgrade the local daemon"; naming a component identifies the immediate concern but does not narrow the deployment. Only an explicit exclusion such as "only upgrade the daemon; do not upgrade Desktop" narrows the scope.
- For a whole-machine Mac upgrade, rebuild the client app (`packages/app`) and Desktop wrapper (`packages/desktop`) into the macOS Desktop app, install `/Applications/Paseo.app`, and upgrade the separately installed macOS daemon/CLI from the same customized-fork commit. Restart the daemon and verify the installed Desktop app plus CLI/daemon versions. The upgrade is not complete after replacing only the app, only the Desktop wrapper, or only the daemon.

### Fork customization inventory — preserve during every upstream sync

This is the explicit product-behavior guardrail for our fork. During an upstream
sync, verify every row against the merged tree and its focused tests; do not assume
a conflict-free merge preserved the behavior. The list is intentionally grouped by
owner-visible outcome rather than commit, because one behavior often spans the app,
protocol, daemon, and Desktop wrapper.

This inventory supplements, but never replaces, the history-derived overlap audit in
[`docs/upstream-sync.md`](docs/upstream-sync.md#逐项复查定制). New fork behavior must
be added here in the same PR that introduces it. The detailed, item-by-item contract and audit
workflow live in [`.agents/skills/audit-fork-customizations/`](.agents/skills/audit-fork-customizations/SKILL.md).
Run that Skill after every upstream pull/sync. Every new fork feature or real bug fix must update
its customization catalog in the same PR.

| Area                               | Fork behavior that must survive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Primary anchors                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queued messages and steering       | New messages queue by default; queued state persists and syncs across clients; acknowledged messages remain visible; completed turns do not replay queued input; active Claude/Codex/Pi sessions receive real steer requests through upstream's `steerActiveTurn`/`SteerResult` contract (upstream v0.5.0 replaced our `steer()`, including its Claude priority `now`).                                                                                                                                                                                                                                                                                     | `packages/protocol/src/messages.ts`, `packages/server/src/server/agent/message-queue-service.ts`, provider `agent.ts` files, `packages/app/src/composer/message-queue.ts`                                                                                                                                                  |
| Durable and fast timelines         | Upstream's `FileAgentTimelineStore` backs the daemon timeline cache; daemon bootstrap migrates complete pre-v0.5 SQLite caches without overwriting current-format data, so committed history remains readable without loading the agent across the storage upgrade; reconnect/resume loads the latest tail without duplicate answers or unchanged refresh churn; long conversations use collapsed logical assistant/execution groups and a native mobile-lite projection; the chat outline rail stays mounted at every panel width instead of hiding on narrow panels, and native gets a touch scrubber version of it rather than upstream's web-only rail. | `packages/server/src/server/migrations/migrate-legacy-timeline-cache.ts`, `packages/server/src/server/agent/agent-manager.ts` (`hasCommittedTimeline`/`readLiveOrCommittedTimeline`), `packages/app/src/timeline/`, `packages/app/src/agent-stream/`, `packages/app/src/agent-stream/chat-outline/`, `docs/mobile-lite.md` |
| Voice-first mobile composer        | Mobile defaults to voice input; text and voice controls are visually distinct; streaming partial dictation remains visible, failures recover instead of sticking, Command-key/IME key-up loss does not leave numbered shortcut badges active, and attachments never push the composer controls below the reachable safe area.                                                                                                                                                                                                                                                                                                                               | `packages/app/src/composer/`, `packages/app/src/components/dictation-controls.tsx`, `packages/app/src/keyboard/modifier-reset-listeners.ts`, server speech runtime                                                                                                                                                         |
| Volcengine speech                  | Volcengine streaming ASR is a first-class configurable STT provider with hotwords and protocol/runtime coverage; do not narrow persisted config back to upstream-only speech providers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `packages/server/src/server/speech/providers/volcengine/`, `packages/server/src/server/speech/`, `docs/speech-providers.md`                                                                                                                                                                                                |
| Review and unread semantics        | Review completion is explicit. Opening, viewing, focusing, typing in, sending from, switching away from, or leaving a workspace must never acknowledge attention, hide its green attention indicator, or move it out of **Ready to review**. Only an explicit user action such as **Mark as done** may complete review, and Done workspaces expose an explicit **Ready to review** action to restore review state. Do not reintroduce a client-local "seen attention" store or derive review visibility from route focus/App visibility; this regression has shipped repeatedly. Parent agents remain available while children work.                        | Sidebar workspace projections, `packages/app/src/hooks/use-workspace-review-status.ts`, `packages/protocol/src/agent-state-bucket.ts`, `docs/agent-lifecycle.md`                                                                                                                                                           |
| Mobile readability and interaction | Large text scales line height and control geometry without clipping (`uiBaseFontSize` caps at 32 rather than upstream's 21, and `createControlGeometry` reads `theme.controlHeight` rather than the static ramp); cross-paragraph selection works on iOS; rich-copy keeps the complete conclusion; Markdown, code, diff, plan, and question surfaces avoid accidental taps and remain usable at large font sizes.                                                                                                                                                                                                                                           | `packages/app/src/components/message.tsx`, platform Markdown renderers, `packages/app/src/components/ui/control-geometry.ts`, rich clipboard utilities                                                                                                                                                                     |
| File downloads                     | Native relay/socket/pipe downloads use the active encrypted binary transfer instead of assuming direct HTTP. Mermaid and sandboxed HTML previews are no longer ours: upstream v0.5.0 shipped its own, and our `file-preview/` modules were removed rather than kept in parallel.                                                                                                                                                                                                                                                                                                                                                                            | `packages/app/src/stores/download-store.ts`, `packages/app/src/hooks/use-file-download.ts`                                                                                                                                                                                                                                 |
| Large attachments and backpressure | Attachment limit is 1 GB; chunked uploads yield to the event loop and abort on error responses as well as explicit rejection; mobile composer remains reachable after selecting images.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `packages/client/src/daemon-client.ts`, `packages/server/src/server/websocket-server.ts`, composer attachment/layout code                                                                                                                                                                                                  |
| Host registry and recovery         | Host priority order persists; newline-separated relay links import correctly; hosts can be transferred/migrated; healthy probes recover disconnected profiles; relay reconnect probes retain the working client; Desktop mirrors the registry to an atomic `0600` backup and restores it after Chromium storage loss.                                                                                                                                                                                                                                                                                                                                       | `packages/app/src/runtime/host-runtime.ts`, replica cache, host transfer/order utilities, `packages/desktop/src/settings/host-registry-backup.ts`                                                                                                                                                                          |
| Workspace and sidebar workflow     | Session pinning syncs across clients; workspace rows expose creation time and owner-preferred ordering; workspace creation keeps the explicitly selected device instead of replacing it with project preference; mobile surfaces project/workspace context compactly.                                                                                                                                                                                                                                                                                                                                                                                       | sidebar stores/projections, new-workspace initial-context code, session context                                                                                                                                                                                                                                            |
| Agent reliability and models       | Idle agents remain resident indefinitely and are never collected merely for elapsed idle time (the upstream v0.2.5 behavior supersedes our former one-hour TTL); mixed-project push-token registration retries; push tokens no longer accumulate per rebuild — upstream v0.5.0's lease/renewal store replaced our device-id de-duplication; Claude model probing preserves the catalog and correct context variants, including Opus 5; mobile thinking controls remain visible.                                                                                                                                                                             | `docs/agent-lifecycle.md`, `packages/server/src/server/push/token-store.ts`, `packages/app/src/push-notifications/`, Claude provider/catalog code, agent controls                                                                                                                                                          |
| Fork identity and releases         | Runtime daemon/CLI versions carry `+LY`; tagged releases use `vX.Y.Z-LY.N`; mobile and Desktop show the correct fork/Desktop version; macOS artifacts and update feeds point to `so2liu/paseo`; fork tag pushes do not trigger unrelated upstream publishing workflows.                                                                                                                                                                                                                                                                                                                                                                                     | daemon/CLI/app version utilities, `packages/desktop/electron-builder.yml`, `.github/workflows/fork-macos-release.yml`, `docs/fork-releases.md`                                                                                                                                                                             |
| Owner fleet deployment             | Every owner Mac upgrade is Desktop plus external daemon/CLI from one fork commit, with rollback and stable process ownership; Desktop-managed daemons record the exact Desktop build, auto-restart on drift, and expose one-click sync/restart; external daemons show manual upgrade steps; iOS routine installs overwrite `Paseo Debug` using Xcode Release; Linux owner hosts receive the matching custom daemon build.                                                                                                                                                                                                                                   | this section, `packages/desktop/src/daemon/daemon-manager.ts`, `packages/app/src/desktop/components/desktop-updates-section.tsx`, `docs/development.md`, `docs/fork-releases.md`                                                                                                                                           |
| Fork engineering policy            | Agents fix reported bugs through verified PRs instead of stopping at diagnosis; syncs use release tags, preserve merge ancestry, and keep customization evidence; Windows CI remains intentionally disabled; full browser E2E uses two cost-capped runners and is manual-only; Docker and Nix compatibility builds stay manual-only unless the owner explicitly re-enables automatic runs.                                                                                                                                                                                                                                                                  | `CLAUDE.md`, `docs/upstream-sync.md`, `.github/workflows/ci.yml`, `.github/workflows/docker.yml`, `.github/workflows/nix.yml`                                                                                                                                                                                              |

### Resolving an upstream sync

The full procedure — choosing the base tag, per-conflict handling, the verification
order, and the customization checklist — is in
[docs/upstream-sync.md](docs/upstream-sync.md). Read it before starting a sync. The
rules that are easiest to violate without noticing:

- **Never resolve a conflict with `git checkout --theirs` (or `--ours`).** It replaces
  the entire file, not the conflicting hunks, so fork changes elsewhere in that file
  are discarded silently. Edit the conflict markers instead.
- **Run `npm run build:server` before believing any type error.** `build:client` does
  not rebuild `relay` or `highlight`, and their stale declarations produce errors in
  files neither side touched.
- **`npm run typecheck` is mandatory after a sync**, because Git merges semantic
  conflicts cleanly — upstream adds a required field, our customized fixture lacks it,
  and nothing complains until typecheck runs.
- **When upstream fixes the same bug we did, compare the actual values before
  deferring.** Preferring upstream assumes it covers our behavior; verify that it does.
- **Merge the sync PR with a merge commit — never squash it.** Squashing flattens the
  branch into a single-parent commit, so `main` no longer records that the upstream tag
  was merged and the next sync replays every conflict this one already resolved. Use
  `gh pr merge <n> --merge`, then verify with
  `git merge-base --is-ancestor v<version> main`. Ordinary PRs still squash — the sync
  PR is the exception, and GitHub's default button is the wrong one.
- **Keep the sync PR faithful.** Don't fix upstream's bugs inside it — that hides what
  changed and creates fork-only divergence that re-conflicts on every future sync.
- **The LY counter restarts when the upstream base moves** — after syncing to `0.2.3`,
  the next fork release is `v0.2.3-LY.1`.

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

At the start of non-trivial work, list `docs/` and skim anything relevant to the task.

| Doc                                                                                  | What's in it                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/product.md](docs/product.md)                                                   | What Paseo is, who it's for, where it's going                                                                                  |
| [docs/architecture.md](docs/architecture.md)                                         | System design, package layering, WebSocket protocol, agent lifecycle, data flow                                                |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)                                   | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                                  |
| [docs/data-model.md](docs/data-model.md)                                             | File-based JSON persistence, Zod schemas, atomic writes, no migrations                                                         |
| [docs/glossary.md](docs/glossary.md)                                                 | Authoritative terminology — UI label wins, no synonyms                                                                         |
| [docs/coding-standards.md](docs/coding-standards.md)                                 | Type hygiene, error handling, state design, React patterns, file organization                                                  |
| [docs/design.md](docs/design.md)                                                     | Design system — tokens, buttons, hierarchy, density, alignment rails, states, what's forbidden                                 |
| [docs/forms.md](docs/forms.md)                                                       | Form architecture — non-React form model, form kit, load-state gating; the schedule form is the golden example                 |
| [docs/hover.md](docs/hover.md)                                                       | Hover — the canonical pattern (plain View + onPointerEnter/Leave, separate inner Pressable) and the three ways agents break it |
| [docs/unistyles.md](docs/unistyles.md)                                               | Unistyles gotchas — `useUnistyles()` is forbidden, alternatives in order                                                       |
| [docs/floating-panels.md](docs/floating-panels.md)                                   | Anchored popovers — Portal/Modal escape for Android, lifecycle gates, keyboard-shared-value, status-bar offset, the flash      |
| [docs/menus.md](docs/menus.md)                                                       | The menu engine — popover vs sheet, submenu pages, hover intent, when a decision earns a submenu                               |
| [docs/expo-router.md](docs/expo-router.md)                                           | Expo Router route ownership, startup restore, and native blank-screen gotchas                                                  |
| [docs/file-icons.md](docs/file-icons.md)                                             | Material icon theme integration for the file explorer                                                                          |
| [docs/providers.md](docs/providers.md)                                               | Adding a new agent provider end-to-end                                                                                         |
| [docs/speech-providers.md](docs/speech-providers.md)                                 | Speech slots, provider selection, Volcengine streaming ASR setup, hotwords, adding a provider                                  |
| [docs/forge-providers.md](docs/forge-providers.md)                                   | Adding a git forge: registry/manifest, drop-in checklist, self-host/GHES, the two facts tiers                                  |
| [docs/custom-providers.md](docs/custom-providers.md)                                 | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                              |
| [docs/plugins.md](docs/plugins.md)                                                   | Local plugin manifest, directory source config, RPCs, native surfaces, and attachment sources                                  |
| [docs/service-proxy.md](docs/service-proxy.md)                                       | Service proxy: exposing workspace scripts at public URLs, DNS setup, reverse proxy config                                      |
| [docs/development.md](docs/development.md)                                           | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP                                                     |
| [docs/upstream-sync.md](docs/upstream-sync.md)                                       | Syncing from upstream — choosing the base tag, conflict handling, verification order, customization checklist                  |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                                   | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                           |
| [docs/protocol-compatibility.md](docs/protocol-compatibility.md)                     | Why app/daemon versions drift, protocol vs feature contract, capability gating, COMPAT tagging                                 |
| [docs/protocol-validation.md](docs/protocol-validation.md)                           | zod-aot generated inbound WebSocket validation, patched compiler regressions, schema-purity rules                              |
| [docs/terminal-performance.md](docs/terminal-performance.md)                         | Terminal latency pipeline, coalescing/backpressure invariants, benchmark + perf spec usage                                     |
| [docs/file-observation.md](docs/file-observation.md)                                 | Recursive watcher ownership, Linux constraints, teardown invariants, and Parcel comparison                                     |
| [docs/testing.md](docs/testing.md)                                                   | TDD workflow, determinism, real dependencies over mocks, test organization                                                     |
| [docs/qa.md](docs/qa.md)                                                             | QA evidence bar for pull requests — platform matrix, version drift, performance, UI proof                                      |
| [docs/mobile-testing.md](docs/mobile-testing.md)                                     | Maestro and mobile test workflows                                                                                              |
| [docs/mobile-panels.md](docs/mobile-panels.md)                                       | Compact left/center/right panel ownership, worklet motion, gesture revisions, and Fabric constraints                           |
| [docs/mobile-lite.md](docs/mobile-lite.md)                                           | Native companion scope, text-first rendering, background timeline policy, and notification invariants                          |
| [docs/conversation-timeline-projection.md](docs/conversation-timeline-projection.md) | 长对话打开即可读——折叠按提问索引切分、首屏拉取量，以及为什么否掉服务端过滤投影                                                 |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md)                       | Isolated in-process daemon test harness                                                                                        |
| [docs/browser-capture-harness.md](docs/browser-capture-harness.md)                   | Real-Electron browser screenshot harness and compositor-surface gotcha                                                         |
| [docs/android.md](docs/android.md)                                                   | App variants, local/cloud builds, EAS workflows                                                                                |
| [docs/docker.md](docs/docker.md)                                                     | Running the daemon and bundled web UI in Docker, volumes, agent images, security                                               |
| [docs/release.md](docs/release.md)                                                   | Release playbook, draft releases, completion checklist                                                                         |
| [docs/fork-releases.md](docs/fork-releases.md)                                       | This fork's macOS release flow — `vX.Y.Z-LY.N` tags, the auto-built DMG, update feed, signing secrets                          |
| [docs/terminal-activity.md](docs/terminal-activity.md)                               | Terminal activity indicators — source-agnostic tracker, agent hook reporting, adding a new hook provider                       |
| [SECURITY.md](SECURITY.md)                                                           | Relay threat model, E2E encryption, DNS rebinding, agent auth                                                                  |
| [public-docs/hub/security.md](public-docs/hub/security.md)                           | Public Hub guide — trust boundaries, untrusted triggers, provider controls, and output authority                               |

### Writing docs

- **Integrate, don't append.** Find the doc that owns the subject and rewrite the part that is now wrong. The standard failure is finishing a task and adding a paragraph to the bottom of the closest-looking doc; ten tasks later the doc is a pile of paragraphs in discovery order. `docs/custom-providers.md` is what that looks like.
- **Don't document logic.** Prose that restates code drifts from the code and loses. Write down what the code can't tell you: why something is shaped the way it is, the gotcha that cost an afternoon, conventions nothing enforces, constraints that span packages or versions. If a reader could get it in two minutes by opening the file, cut it.
- **One fact, one doc.** Every other mention is a link. If you are about to write the same paragraph in two docs, one of them is a link.
- **Respect the layers.** `CONTRIBUTING.md` and this file name things and link out. Activity docs like `docs/qa.md` and `docs/testing.md` set the bar for a kind of work. Subject docs like `docs/unistyles.md` own one thing completely. A layer never re-explains the one below it.
- **One subject per doc.** If the subject doesn't fit in a sentence, split the doc. A section per provider, vendor, or platform is a table plus one worked example.
- **Delete.** Obsolete sections go. Prefer a `packages/app/src/thing.ts:120` reference over a pasted block.
- **New doc?** Add a row to the table above and link it from the docs that should send readers there.
- Code-level facts belong in comments next to the code, not here.

### Doc voice

Plain and short. Second person. State the rule, then the reason when the reason isn't obvious. Match the doc you're editing.

Do not:

- Write a sentence to land a point. "It's not X, it's Y", "That's not a Z, that's a W", and every other setup-and-punchline shape.
- Add a clause that only asserts importance: "and that matters", "which is what keeps it working", "this is critical".
- Use "honest", "robust", "seamless", "powerful", "simply", "just", "delightful".
- Restate something you already said, in different words, for emphasis.
- Hedge with "generally", "typically", or "you may want to" when the answer is "do this".
- Clear your throat: "It's worth noting that", "In order to", "This section covers".

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

- **NEVER auto-complete or auto-acknowledge Ready to review.** Opening, displaying, focusing, typing in, sending from, switching away from, or leaving a workspace must not clear attention, hide the green attention indicator, or move the workspace to **Done**. Review completion requires an explicit user action such as **Mark as done**. Do not add a route-focus/App-visibility effect or a client-local "seen attention" marker that changes review visibility. This exact regression has been introduced and shipped multiple times; treat any automatic acknowledgement path as a release blocker. Preserve this rule during every upstream sync and verify it with a focused regression test.
- **When the owner reports a problem, fix it — do not stop at diagnosis.** Locating the cause and then asking "要我修吗?" is not an answer; it hands the work back. Once you can point at the defect, write the fix, verify it, and open the PR in the same pass. This applies to every problem in a report, not just the first: a message listing three issues is three fixes, not one fix and two questions.
  - **Only stop and discuss when you genuinely cannot pin the cause.** Almost nothing else qualifies. This fork has exactly one reader and one user — the owner. There is no other audience whose expectations a taste call could violate, no team to align, no migration to coordinate. So questions of preference are not blockers: pick the option you would defend, ship it, and say in one line what you picked and why. The owner corrects it in the next message if it is wrong, which costs far less than a round trip for every judgment call.
  - Reserve a real question for the case where proceeding either way would be unsafe or would waste substantial work if wrong — not for "which default do you want".
  - "This is a design change, not a bug" is not grounds to stop. Design changes the owner asked for are still the work.
  - Batch the questions you truly need to the end, after the fixes that need no input are already done.
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
- **The protocol stays backward-compatible. Features don't have to.** Read [docs/protocol-compatibility.md](docs/protocol-compatibility.md) before touching `packages/protocol`. The short version:
  - **Protocol contract (always):** an old client parses messages from a new daemon, and a new daemon parses messages from an old client. New fields are optional; never narrow, never remove, never require. Wire schemas stay pure — no `.transform()`, `.catch()`, or `.preprocess()`.
  - **Feature contract (per-feature):** gate the capability once on `server_info.features.*`, then run the feature or tell the user to update the host. No fallback paths, no defensive branches.
  - **Every shim is tagged.** `// COMPAT(name): added in vX, remove after <date>` at the site that has to be deleted. `rg "COMPAT\("` is the cleanup backlog; untagged back-compat is permanent by accident.
  - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

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
  desktop/browser/pane/
    index.electron.tsx ← Electron <webview> implementation
    index.web.tsx      ← plain web fallback
    index.tsx          ← native fallback
  ```
  Import as `@/desktop/browser/pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $PASEO_HOME/daemon.log
