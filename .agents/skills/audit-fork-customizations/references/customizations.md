# Fork customization catalog

This is the detailed behavior contract for the `so2liu/paseo` fork. The summary table in
`CLAUDE.md` is a routing index; this catalog is the audit checklist.

Status vocabulary:

- **fork** — behavior remains owned by fork code.
- **upstream** — upstream now provides the equivalent behavior; do not restore the obsolete fork
  implementation.
- **mixed** — upstream owns the base and the fork preserves additional behavior.
- **guardrail** — process or delivery invariant rather than a product surface.

## Messaging and composer

| ID      | Required behavior                                                                                                                                                                                                                       | Origin/status                      | Primary anchors and validation                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MSG-001 | Sending while an agent runs queues by default. The preference persists and old `interrupt` values migrate to steering.                                                                                                                  | `cd38ba86b`, fork/mixed            | `packages/app/src/hooks/use-settings/storage.ts`; storage and migration tests                                                                                   |
| MSG-002 | Queued messages persist on the daemon, sync across clients, survive reconnect, and acknowledged rows remain visible until handled.                                                                                                      | `a1ba06e3d`, `6678f1665`, fork     | protocol queue messages; `message-queue-service.ts`; composer queue/outbox tests                                                                                |
| MSG-003 | A completed turn must not replay an already queued user message.                                                                                                                                                                        | `6b3611abc`, fork                  | queue service and provider settlement tests                                                                                                                     |
| MSG-004 | Active Claude, Codex, and Pi turns receive real steering through the current `steerActiveTurn`/`SteerResult` contract.                                                                                                                  | fork behavior on upstream API      | provider `agent.ts` files; queue service tests; provider steering tests                                                                                         |
| MSG-005 | Autocomplete, queued-message editing, slash-command clearing, dictation replacement, and submit clearing must replace the native/DOM-owned input, not only publish parent state.                                                        | upstream IME input plus fork flows | `packages/app/src/composer/index.tsx`; `MessageInput.replaceText`; browser input tests                                                                          |
| MSG-006 | On desktop/web, Up at the start of the input enters history, repeated Up/Down traverses it, and Down past the newest entry restores the draft. Visible text and selection use the live input snapshot without losing unpublished edits. | `1f2266bc6`, repaired in #59, fork | `composer/input-history.ts`; `composer/index.tsx` uses live `event.input`, active navigation state, and `replaceUserInput`; production composer Playwright test |
| MSG-007 | Mobile defaults to voice mode; text and voice controls remain visually distinct and narrow web layouts must not enter native voice-first mode.                                                                                          | `4d3b69e45`, `18647bf6c`, fork     | composer layout/input files; `composer/layout.test.ts`                                                                                                          |

## Timeline and conversation rendering

| ID     | Required behavior                                                                                                                                                                               | Origin/status                                                | Primary anchors and validation                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| TL-001 | Reconnect/resume shows the latest bounded tail quickly, without duplicate answers or replacing an unchanged visible conversation.                                                               | `20e34747f`, `48285b8e5`, `0af36d5ca`, `1dac1907b`, mixed    | `packages/app/src/timeline/`; reducer and viewed-sync tests                                            |
| TL-002 | Committed history can be read without loading or resuming the agent.                                                                                                                            | `949a616cd` lineage, fork on upstream store                  | `AgentManager.hasCommittedTimeline` and `readLiveOrCommittedTimeline`; daemon timeline-cache read test |
| TL-003 | The daemon uses upstream `FileAgentTimelineStore`; the removed SQLite store and epoch/backfill patches are not restored.                                                                        | upstream since v0.5.0                                        | timeline store wiring; shutdown flush tests                                                            |
| TL-004 | Long conversations collapse logical assistant/execution groups without hiding the final answer or the assistant text immediately preceding the last tool-call run.                              | `1f2266bc6`, `b0a7b4d7b`, `5f68829e4`, fork                  | `execution-collapse.ts`; execution-collapse tests                                                      |
| TL-005 | Initial long-history projection splits by user-question index so the latest conclusion is readable immediately.                                                                                 | `0bb0b0e04`, fork                                            | agent-stream projection/render strategy tests                                                          |
| TL-006 | Native mobile-lite projection remains available and usable for long conversations.                                                                                                              | `d137fe81e`, fork                                            | `docs/mobile-lite.md`; mobile-lite projection tests                                                    |
| TL-007 | Chat outline stays mounted at every web panel width and native exposes its touch scrubber. The removed fork right-side locator is not restored.                                                 | `062bf7761`, mixed                                           | `agent-stream/chat-outline/`; chat-outline tests/e2e                                                   |
| TL-008 | Desktop rows retain full-width flex wrappers so centered message content does not drift after mounted/live transitions.                                                                         | `98f2ad6db`, fork behavior carried through upstream refactor | `strategy-web.tsx` `streamRowStyle`; strategy-web browser tests                                        |
| TL-009 | iPad sidebar resizing/toggling must not leave stale chat row geometry or block the toggle. Use the current upstream pagination/layout state machine rather than retired native-history modules. | `b9bf1d30f`, `1978c2552`, mixed/upstream                     | native strategy/layout and tooltip tests; iPad manual check                                            |

## Review, unread, and lifecycle semantics

| ID      | Required behavior                                                                                                                                          | Origin/status                               | Primary anchors and validation                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| REV-001 | Opening, focusing, typing in, sending from, switching away from, or leaving a workspace never acknowledges review or clears its green attention indicator. | `7c37cb5d2`, `44fd3f6b3`, `86a5374e8`, fork | sidebar projections; review-status hook; review tests             |
| REV-002 | Only explicit **Mark as done** completes review. A Done workspace offers explicit **Ready to review** restoration.                                         | `2937e83ef`, `f947e4f81`, `b0e9da2d9`, fork | `use-workspace-review-status.ts`; sidebar menu/row/swipe surfaces |
| REV-003 | Parent agents remain available while child agents work; provider retries or extension/custom-message continuations must not publish false completion.      | `98baeea5c` and lifecycle fixes, fork       | agent-state buckets; Pi/provider settlement tests; lifecycle docs |
| REV-004 | Idle agents stay resident indefinitely and are not collected for elapsed idle time. The old fork one-hour TTL is retired because upstream is stronger.     | `8f927c417`, upstream since v0.2.5          | `docs/agent-lifecycle.md`; agent manager lifecycle tests          |

## Voice and speech

| ID        | Required behavior                                                                                                                   | Origin/status     | Primary anchors and validation                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| VOICE-001 | Streaming partial dictation is visible; errors recover instead of sticking in failed state; retry/discard/confirm remain reachable. | `85335dccc`, fork | composer input and dictation controls tests                                   |
| VOICE-002 | Lost Command-key/IME key-up events do not leave numbered shortcut badges active.                                                    | fork              | `keyboard/modifier-reset-listeners.ts`; focused test                          |
| VOICE-003 | iOS composer shift survives transient zero keyboard-progress samples while Android still uses progress as visibility.               | `0f3c9cc7b`, fork | `keyboard-shift-policy.ts`; `use-keyboard-shift-style.test.ts`                |
| VOICE-004 | Volcengine streaming ASR remains a first-class persisted STT provider with hotwords and protocol/runtime coverage.                  | `2cc4b5089`, fork | `server/speech/providers/volcengine/`; config/protocol/STT tests; speech docs |

## Readability, selection, and copy

| ID     | Required behavior                                                                                                                | Origin/status                         | Primary anchors and validation                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| UI-001 | `uiBaseFontSize` caps at 32 and text line heights scale without clipping.                                                        | `e77ab63c6`, `08ae40ca2`, fork        | settings storage; appearance and markdown-style tests                              |
| UI-002 | `createControlGeometry` reads `theme.controlHeight`, not a static module-level ramp, so controls scale with large text.          | `08ae40ca2`, repaired after v0.5 sync | `components/ui/control-geometry.ts`; control-geometry test                         |
| UI-003 | Cross-paragraph assistant selection works on iOS.                                                                                | `ebc2d22fc`, fork                     | native message/selection renderers; assistant selection tests and iOS manual check |
| UI-004 | Copying a conclusion keeps the complete conclusion, and inline code remains inline in rich-text consumers.                       | `550c100cf`, `37f803363`, fork        | rich clipboard and assistant selection-copy tests                                  |
| UI-005 | Markdown, code, diff, plan, question, HTML, and large-text controls avoid accidental taps and remain usable at large font sizes. | `08ae40ca2`, fork/mixed               | platform renderers; focused component tests; mobile manual check                   |

## Files, previews, and attachments

| ID       | Required behavior                                                                                                                                        | Origin/status                  | Primary anchors and validation                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| FILE-001 | Native and Desktop relay/socket/pipe downloads use the active encrypted binary transfer rather than direct HTTP.                                         | `968297cab`, `831c48437`, fork | download store/hook; Desktop downloads tests        |
| FILE-002 | Binary download activity refreshes the idle timeout during long transfers.                                                                               | `d12bc7a25`, fork              | client daemon download implementation/test          |
| FILE-003 | Attachments allow up to 1 GB. Chunked upload yields to the event loop and aborts on error responses as well as explicit rejection.                       | `02a59bb45`, `c1c5f0992`, fork | daemon client and websocket upload paths/tests      |
| FILE-004 | Selecting images never pushes mobile composer controls below the reachable safe area.                                                                    | `18647bf6c`, fork              | composer layout test and phone manual check         |
| FILE-005 | Mermaid and sandboxed HTML preview behavior uses upstream markdown Mermaid/file-pane implementations. Removed fork `file-preview/` modules stay retired. | upstream since v0.5.0          | Mermaid fence runtime; file-pane render-mode tests  |
| FILE-006 | File download and device-pairing actions remain reachable from the appropriate workspace/host surfaces.                                                  | `84bd5f256`, fork/mixed        | workspace tab menus, host page, pairing modal tests |

## Hosts, workspaces, and sidebar

| ID       | Required behavior                                                                                                          | Origin/status                                                   | Primary anchors and validation                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| HOST-001 | Host priority order persists and drives host pickers and new-workspace defaults.                                           | `587d52038`, fork                                               | sidebar-order/host-order stores and tests                              |
| HOST-002 | Newline-separated relay links import correctly; hosts can be transferred/migrated and import actions stay reachable.       | `1d1a91668`, `7ad527736`, `ad103ec35`, fork                     | host-transfer utility/modal tests                                      |
| HOST-003 | Healthy probes recover disconnected profiles and relay reconnect probes retain the working client.                         | `66cffd0c8`, fork                                               | host runtime tests                                                     |
| HOST-004 | Desktop mirrors the host registry to an atomic mode-`0600` backup and restores it after Chromium storage loss.             | `c66b8bf50`, fork                                               | desktop host-registry-backup tests                                     |
| WS-001   | Workspace/session pinning synchronizes across clients and remains available from the sidebar workflow.                     | `64e93c07e`, `5989855ef`, mixed with upstream workspace pinning | workspace pin protocol/session/sidebar tests                           |
| WS-002   | Workspace rows expose creation time, preserve project identity across grouping modes, and retain owner-preferred ordering. | `fb565a1d5`, `20906d354`, fork                                  | sidebar projections/meta rows/tests                                    |
| WS-003   | Sidebar rows distinguish worktrees/local directories and bare file links resolve against real workspace files.             | `82b405d59`, fork                                               | workspace-kind-label and file-link resolver tests                      |
| WS-004   | New workspace creation keeps the explicitly selected device instead of replacing it with project preference.               | `b88fd3bd8`, fork                                               | new-workspace initial-context test                                     |
| WS-005   | Compact new-workspace UI shows host before project and never loses the project selector.                                   | `5f68829e4`, restored by `4b970a3ce`, fork/mixed                | compact JSX branch and phone-width e2e                                 |
| WS-006   | Mobile workspace header presents compact project/machine context; remote hosts retain their configured badge/name.         | `5f68829e4`, now upstream host-badge implementation             | `WorkspaceHeaderProjectRow`; host appearance tests; phone manual check |

## Providers, models, push, and reliability

| ID        | Required behavior                                                                                                                  | Origin/status                                     | Primary anchors and validation              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| AGENT-001 | Mixed-project push-token registration retries rather than getting stranded.                                                        | `0fe522848`, fork                                 | push service tests                          |
| AGENT-002 | Push tokens do not accumulate per rebuild. Use upstream lease/renewal storage; the fork device-id dedupe is retired.               | upstream since v0.5.0                             | push token store and renewal tests          |
| AGENT-003 | Claude probing preserves the existing catalog on failure and keeps correct context variants, including Opus 5.                     | `7e599db6f`, `a27a1a07d`, `dcaed8008`, fork/mixed | Claude catalog/probe tests                  |
| AGENT-004 | The currently selected live model remains visible while a refreshed catalog is loading.                                            | `073e65cc8`, fork                                 | provider/model selection tests              |
| AGENT-005 | Pi incremental `message_update`, retries, extension/custom-message continuation, and steering settle correctly without false idle. | `458550b74`, `98baeea5c`, fork                    | Pi provider/runtime tests                   |
| AGENT-006 | Mobile thinking controls remain visible and show the selected strength.                                                            | `13accbde0`, `287edb5d6`, fork/mixed              | agent controls tests and phone manual check |

## Fork identity, release, and owner deployment

| ID         | Required behavior                                                                                                                                                                                      | Origin/status                                            | Primary anchors and validation                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| REL-001    | Runtime daemon/CLI versions carry `+LY`; tagged releases use `vX.Y.Z-LY.N`.                                                                                                                            | `2909a02b7`, release policy                              | daemon/app version tests; `docs/fork-releases.md`                   |
| REL-002    | Mobile and Desktop display the correct fork/Desktop version, and update feeds/artifacts target `so2liu/paseo`.                                                                                         | `6bf1b273e`, `72bc0b713`, `4beff6576`, `1ba5c0bf7`, fork | app-version, Desktop packaging/update tests; `electron-builder.yml` |
| REL-003    | Fork tag pushes do not trigger unrelated upstream publishing workflows; Windows, Docker, Nix, and full browser E2E remain intentionally manual/disabled as documented.                                 | fork guardrail                                           | GitHub workflows and `CLAUDE.md`                                    |
| DEPLOY-001 | Every owner Mac upgrade is Desktop plus external daemon/CLI from one fork commit. Desktop-managed daemons track the exact Desktop build and restart on drift; external daemons retain manual guidance. | fork guardrail/fixes through `e50a26264`, `58fb4d2c0`    | daemon manager, desktop update section, deployment docs/tests       |
| DEPLOY-002 | Routine iPhone installs overwrite `Paseo Debug` using development app identity with Xcode Release configuration. Linux owner hosts receive the matching fork daemon when fleet scope applies.          | fork guardrail                                           | `docs/development.md`; `CLAUDE.md`                                  |

## Updating this catalog

For every new fork feature or real bug fix:

1. Add or update the row in the same PR.
2. State the user-visible invariant, not only the implementation.
3. Record current anchors and meaningful validation.
4. Add a new `CLAUDE.md` summary area only when existing areas cannot express the behavior.
5. When upstream supersedes it, keep the row and mark the old implementation `upstream` or
   `mixed`; remove the row only when the product behavior is intentionally retired and documented.
