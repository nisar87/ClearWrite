# Generic Editor Reading

ClearWrite reads editor capabilities, not a whitelist of application names. `src/editor-reader.cs` is loaded by the existing hidden PowerShell monitor on an MTA thread. It returns the same field snapshots as the old monitor. Panel visibility and window lifecycle are not owned by this reader.

## Resolution And Safety

1. Resolve the foreground host process and apply exclusions/allowlist before accessing field text. Also reject an excluded focused renderer. Remote-desktop and virtual-machine viewers are excluded before reading.
2. Verify that accessibility focus belongs to the foreground window. Ownership accepts a matching UIA root or an ancestor HWND that is the foreground window or its native child, checking at most 64 metadata-only ancestors. This handles deep web trees and hosted provider fragments without trusting process ID alone. Check passwords on the ancestor path. Separately examine at most six candidate editing containers from the focused element upward, stopping at the host root. Revalidate the resolved field before returning content.
3. Prefer an editable ValuePattern only on Edit, Document or ComboBox roles. Sliders, playback/volume bars, progress indicators, scrollbars, spinners, buttons and other explicit non-text interactions stop ancestor resolution before their values are read. A writable ValuePattern alone is not evidence of typing. The main process independently rejects snapshots with non-editor roles. Direct Edit/ComboBox controls retain the existing exact-field replacement verification. Ancestor-derived controls are copy-only.
4. Try TextPattern only for editing roles with one collapsed selection and an explicitly writable text-range attribute. Unsupported, mixed, read-only or non-collapsed selection values do not qualify. Read up to 6,001 characters; if the document exceeds the limit, use the caret paragraph instead. Oversized paragraphs remain unsupported. This uses TextPattern's selection range, not native TextPattern2; providers with no usable selection may remain unsupported.
5. Try focused legacy MSAA text controls only where no UIA read-only or ambiguous-rich-text result has been encountered. Require the focused state and text role and reject protected, read-only and disabled states. Legacy controls are copy-only.
   Before MSAA, an optional native UIA3 reader can recover a focused Edit descendant beneath hosted/windowless provider bridges. It queries only the foreground host, requires keyboard focus, enabled state, writable ValuePattern and native window ownership, and rejects passwords and excluded renderer processes. Only the accepted editor's value is read, not conversation/document contents. All UIA3 results are copy-only.
6. Scintilla window classes have a bounded current-line reader using scalar SCI_GETCHARAT messages. There are no remote pointers, process-memory writes, clipboard operations or input injection. Read-only controls are rejected. The line is limited to 2,048 encoded bytes and an approximately 180 ms work budget; individual messages have a 20 ms timeout. Encoding follows the control's code page. Other code editors are not assumed to be Scintilla.

The native Scintilla path operates only on the foreground thread's focused child window. Other paths revalidate foreground/focus before producing content. App identity is the host rather than a shared WebView2 renderer name. Password and app restriction checks must not be weakened when adding capabilities.

## Change Tracking

Up to 32 editing contexts are retained in memory, never persisted or logged. A first observation is a baseline, not a typing event. Subsequent changes in the same context become edits. Temporary read gaps do not automatically erase the baseline. Samples older than ten seconds start a new baseline. Paragraph switches and Scintilla line switches establish fresh contexts rather than interpreting navigation as typing. There is no keystroke hook; as before, accessibility cannot perfectly distinguish a user's edit from an application changing an editable field.

The helper emits a text-free heartbeat each second. The main process terminates a helper that produces no heartbeat for 15 seconds; its existing exit recovery starts another helper. A hung native/UIA request therefore does not require restarting the entire application. Restarting the reader does not call panel hide/show operations.

UIA2 and UIA3 run in separate hidden processes. In live WhatsApp testing, the managed reader stopped at a WinUI bridge; standalone UIA3 exposed the actual focused, writable HTML edit control, whereas mixing managed and native clients in one process lost that subtree. The parent reader calls a persistent UIA3 child through private redirected stdin/stdout only when needed. Host restrictions are applied before the request, renderer restrictions before reading the value, and foreground/focus are revalidated. Child input-pipe closure terminates the child. An unexpected child exit restarts the reader through the existing recovery path. UTF-8 preserves non-ASCII drafts across the pipe. No sockets or browser-debugging ports are opened.

Startup logs include `focus monitor reader ready` once compilation finishes. `foreignEditor` means foreground ownership could not be established; `focusChanged` means a final focus/window revalidation failed. First observations remain baselines, so text completed before the reader became ready requires a subsequent edit to trigger monitoring rather than automatically checking pre-existing content.

## Limits

- No guarantee of access to every third-party custom editor. Unsupported providers retain the selection-shortcut workflow.
- New rich, legacy, ancestor-derived and Scintilla paths are copy-only. Do not enable Apply until target, range, content and replacement semantics are independently verified.
- Large ValuePattern/legacy values can only be limited after their provider returns the string; rich TextPattern reads are bounded at the API call.
- Dynamic DOM replacements can invalidate ranges or runtime IDs. A conservative fresh baseline may miss the first edit rather than reuse another editor's text.
- Explicit provider editability is still a provider assertion, not a security guarantee. Read-only conversation panes, password fields, navigation, selection, IME composition and rapid app changes require real-app regression testing.
- No automatic accessibility settings changes, browser debugging connections, browser extensions, OCR, broad conversation scanning, or silent Ctrl+C are used.
- Set `CLEARWRITE_EDITOR_FALLBACKS=0` before launch to disable new fallback paths and use direct ValuePattern only for troubleshooting.

## Verification

`npm test` compiles the production reader on Windows and exercises its rich-text eligibility policy plus watchdog integration tests. It does not demonstrate compatibility with real WhatsApp, Outlook or Notepad++ versions.

Live evidence on this installation: the production helper accepted WhatsApp's compose editor with `reader=uia3-value` and `replaceSupported=false` after adding process isolation. A standalone first read took approximately 118-140 ms. These observations establish reading/detection for the tested compose field, not universal WhatsApp/version compatibility or end-to-end Apply support. Tests also cover interop checksum, native runtime construction, private IPC, refusal of an invalid target and child shutdown on pipe closure.

`npm run test:editors` creates test-owned WinForms TextBox/RichTextBox controls and checks focus-only baselines, changes, app restrictions, passwords, read-only controls and bounded long-document context. It requires an unlocked interactive desktop and permission for its window to acquire focus. It stops without inspecting another app if focus is unavailable. In the coding environment this interactive fixture was blocked by Windows foreground restrictions; it has not passed here. No live compatibility claim should be made from compilation or pure-policy tests alone.

Next manual matrix: plain and rich text controls, WhatsApp compose vs conversation, classic and new Outlook body/subject/reading pane, Notepad++ prose vs code/read-only files, browser contenteditable, Teams, ChatGPT, long drafts, emoji/IME, multiple monitors and rapid switches. Verify no typing is sent while reading or in excluded apps, and no new reader changes the panel lifecycle.
