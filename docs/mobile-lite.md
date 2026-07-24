# Mobile Lite

The native iOS and Android app is a lightweight companion. Its primary jobs are:

- switch between agent sessions
- show hosts and their connection/activity state
- send messages
- read conversation text
- preserve attention and push notifications

Desktop and browser keep the full workspace surface.

## Native presentation

Native agent timelines render user messages, assistant messages, and error activity. Tool calls,
reasoning, informational activity, todo lists, and compaction markers remain in the authoritative
timeline but are not projected into the native view.

The native live-stream reducer batches text updates to four commits per second. Lifecycle boundaries
flush immediately. Only the active native workspace tab remains mounted.

File browsing is intentionally on demand. Assistant file links can still open a file tab, but the
workspace does not mount the file explorer or proactively query terminal, checkout, or provider
configuration data.

The native composer keeps model and thinking strength visible as separate controls beside the input.
Lower-frequency mode and feature controls remain in the model sheet.

## Background and notifications

When the app backgrounds, selective timeline membership is cleared immediately. Agent attention
uses a separate delivery path, and host sessions, presence heartbeat, push-token registration, and
push notification routing remain intact. Do not suspend or disconnect host runtimes as a battery
optimization without proving that notification delivery remains correct.

On foreground resume, the visible conversation resubscribes and performs authoritative tail
catch-up.

## Future transport optimization

The current optimization is presentation- and scheduling-level. Full projected timeline pages still
cross the wire before native presentation filters execution details. A future daemon capability may
provide text-only live and history projections, but it must advance source sequence cursors across
omitted execution rows so the client does not mistake filtering for a delivery gap.
