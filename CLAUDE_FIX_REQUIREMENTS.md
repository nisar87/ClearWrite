# ClearWrite Stability And Product Fix Brief

You are working in the existing ClearWrite Windows desktop application. Your task is to audit and fix the app, not merely describe possible fixes. The user's primary goal is a dependable AI writing companion that stays available while they write, quickly identifies useful spelling/grammar corrections, and presents them in a polished, easy-to-use interface.

## User impact and current evidence

The floating correction window repeatedly appears, disappears, reappears, or fails to return. It has also appeared late, on the wrong monitor, behind other applications, or with stale/partial text. This has persisted through several visibility-focused patches and has reduced trust in the app. Do not add another isolated visibility patch.

The current repository is `E:\ClearWrite-GitHub`, Electron app source is under `src/` and `public/`, and the latest known branch was clean `main`. Preserve user data in `data/`, credentials, provider configuration, and existing unrelated work. Do not reset, clean, or overwrite user data.

Relevant current implementation and evidence to investigate:

- `src/main.js`: `createAssistantWindow()` hides the assistant on blur under some state combinations, has a delayed restore on `hide`, and manages showing/raising through several other functions. `startPanelKeepAbove()` periodically attempts to re-show and promote the window. Review every visibility, focus, blur, restore, dismiss, pause, and show path as one lifecycle.
- `src/focus-monitor.ps1`: polls Windows UI Automation every 150 ms, repeatedly reads focused editable values, and sends JSON snapshots. Investigate field changes, transient UIA failures, focus transitions, text update timing, unsupported controls, and how stale snapshots affect renderer/main state.
- `src/monitor-session.js` and tests: currently model states such as `searching`, `focused`, `editing`, `reviewing`, `suggestion`, and `dismissed`. Verify that transitions and revisions cannot result in stale work, visibility oscillation, duplicate requests, or hidden active suggestions.
- `src/panel-position.js` and `src/main.js`: panel coordinates use Electron screen APIs. This machine has three displays with mixed scaling and non-contiguous/negative-or-large virtual coordinates. Logs and native inspection showed the assistant window on display 1 while the user was working on display 2, and not topmost. Verify actual Windows physical bounds, DPI scaling, monitor work areas, saved positions, drag/resize, reconnection, and startup restore.
- `data/startup.log` contains frequent `monitor panel promoted without focus` entries. Treat repetitive promotion as a symptom to explain/remove, not a success metric.
- Existing commands: `npm run check` and `npm test`. Existing test files are in `src/`.

## Required working method

1. Inspect the full repository, current git status/history, existing UI, and all related lifecycle code before editing. Do not assume earlier fixes are correct. Identify the root causes and write a short diagnosis before implementation.
2. Make a coherent, minimal architecture change that removes conflicting show/hide/raise mechanisms. Avoid timer-based “force visible” loops, repeated `setAlwaysOnTop`, blind retries, and scattered competing window state. Use one explicit lifecycle/state owner and one documented policy for visibility.
3. Keep changes scoped to ClearWrite. Preserve existing provider integrations, encrypted credentials, privacy settings, tray behavior, keyboard shortcuts, and user preferences unless a specific defect requires a migration. Never log captured user text, prompts, or secrets.
4. Add regression tests for the identified root causes. Prefer deterministic tests around pure state transitions, stale revisions, debounce/cancellation, and bounds/clamping; supplement with Windows integration checks where unit tests cannot represent native window behavior.
5. Run `npm run check` and `npm test`. Report actual results. Do not claim multi-monitor or cross-app behavior is verified unless you ran those tests on Windows and describe the evidence.
6. Keep a rollback path: do not force-push, rewrite history, or destroy existing user files. Make a focused commit only if asked; otherwise leave changes reviewable and summarize changed files.

## Product behavior requirements

### Stable companion window

- The assistant must not disappear merely because the user types, pauses, backspaces, switches between writing fields, or waits for a local/AI response.
- Do not use hide-then-reopen animation or window recreation to represent loading, no issue found, or a new suggestion. Keep one window instance and update its content/state in place.
- Visibility must have clear, testable causes. It may hide only for an explicit user action (close/dismiss/pause, according to the chosen product policy), app shutdown, or a clearly documented safety condition. Focus/blur noise and short UIA read gaps must not toggle visibility.
- Add an obvious way to reopen it (tray command and/or configurable shortcut). A dismissed panel should remain dismissed until the user explicitly restores it or moves to a clearly new eligible writing context; it must not fight the user's dismissal.
- Do not steal keyboard focus from the user's text field when monitoring starts, a suggestion arrives, or the panel updates. A pin/always-visible control is welcome if it has predictable semantics. Do not force topmost over full-screen apps or security prompts.
- Do not show a generic empty popup on every focus event. Distinguish a genuine editable writing field from reading, navigation, unsupported controls, and transient focus. While enabled, show a stable, quiet status in the assistant; only surface a correction when there is useful feedback. Keep the manual shortcut functional when monitoring is paused.

### Reliable correction flow

- Do not send a request for every keystroke. Use a responsive short debounce after a genuine user edit, minimum-content/language heuristics, and per-field deduplication. Explain and test the selected thresholds.
- Cancel or invalidate old local/AI work when the user changes field, edits again, dismisses, pauses, or starts a newer request. An older result must never replace a newer draft or appear in a different field.
- Keep the user's current text visible and intact while analysis runs. Show a compact, non-blocking progress state and recover cleanly from provider timeout, offline errors, UIA failures, and renderer reloads.
- Run the local checker where appropriate; use AI only when connected and useful. Never auto-apply a correction. Present original and suggested text clearly, highlight changed words, and make Copy and Apply reliable and separate actions. Preserve clipboard content where feasible. Applying must target the original field safely and must not paste a truncated/partial response.
- Do not claim 100% correction accuracy. Make uncertainty legible, support undo where feasible, and prefer no suggestion to an unsafe rewrite.
- Reading email/chat/document content must not trigger a correction request merely because a field is focused or content is selected. Do not read surrounding messages for replies unless the user explicitly selects text and invokes the manual action. Respect excluded apps, allowlists, password/read-only controls, pause, and privacy choices.

### Window placement and interface

- Make the assistant feel like a polished, useful writing companion, not a debug overlay. Keep the compact floating form, but use a clear header, recognizable ClearWrite identity, concise status, readable suggestion/diff, and well-labeled Copy, Apply, dismiss, and reopen/pin controls. No oversized marketing content.
- Ensure all text and controls fit at supported sizes and 100%, 125%, 150%, and mixed monitor scaling. The panel must be draggable, resizable within sensible limits, and fully reachable on all monitors after startup, display changes, and app restart.
- Use the actual monitor containing the target field/selection when placement is needed; otherwise use a consistent remembered monitor/position. Clamp against the correct work area and store/restore coordinates in a single coordinate system. Do not let a saved position become stranded or jump to a different display.
- Preserve focus in the target editor during panel display and updates. Test the panel with three monitors, mixed DPI, taskbar/work-area offsets, display unplug/reconnect, and windows spanning monitors where possible.
- Maintain visual consistency with the existing app; improve hierarchy and accessibility without gratuitous redesign. Include keyboard navigation, visible focus, tooltips for icon-only controls, and clear empty/loading/error/no-change states.

## Acceptance criteria

The work is complete only when the diagnosis is supported by code/log evidence and these cases have deterministic tests or documented manual evidence:

1. Focus a Notepad text field, type continuously, pause, backspace, and continue typing: the companion stays in the same place and never flashes, vanishes, or shows stale text.
2. Wait for local and AI results, including a delayed response followed by a newer edit: no window flicker and no stale result overwrite.
3. Switch between editable fields/apps and between writing and read-only/unsupported areas: no late appearance, false correction, or stuck state; response latency is measured and reported.
4. Explicitly dismiss, pause, resume, and reopen through the tray/shortcut: behavior is predictable and does not fight the user.
5. Copy and Apply: both act on the full intended suggestion; Apply does not shrink the window, insert partial text, lose focus unexpectedly, or damage unrelated field content.
6. Exercise Teams, Chrome text fields, Codex, and Notepad where available; also test excluded/password/read-only fields and a provider-offline case. Respect privacy settings.
7. Move/resize/restart across the user's three mixed-DPI displays: panel remains reachable, position is stable, and it does not appear split across screens or behind the active editor.
8. `npm run check` and `npm test` pass. Add regression tests for every fixed root cause and report any remaining limitations clearly.

## Final report requested

Return: (a) root causes with file/function references, (b) concise design of the corrected lifecycle, (c) changed files, (d) tests run and exact results, (e) manual Windows scenarios actually tested and results, (f) known limitations and safe rollback instructions. Do not make a broad rewrite unless the evidence shows it is necessary; if it is, explain the migration and preserve existing settings/data.
