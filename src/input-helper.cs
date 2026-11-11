using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

// Long-running keyboard/clipboard helper for ClearWrite (started by input-helper.ps1).
//
// Protocol: one request per stdin line, "<id> <action> <target> <runtimeId> <expected> <replacement>",
// where the last three fields are base64 UTF-8 (or "-"). One JSON response line per request;
// text in responses is base64 UTF-8, so stdout stays ASCII.
//
// Safety rules:
// - Text is pasted only over a selection that was just copied and equals the expected text,
//   in the same window and focused element.
// - The user's clipboard is snapshotted in all formats (not just text) and restored after
//   ClearWrite's own temporary use. A restore is skipped if something else has been copied since.
// - ClearWrite's temporary clipboard content is marked so Windows clipboard history and cloud
//   clipboard do not record it.
// - The helper pumps window messages while it waits, so other apps' clipboard calls never block on it.
public static class ClearWriteInputHost {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint format);
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr memory);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(int exStyle, string className, string name, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);

  const uint CF_UNICODETEXT = 13;
  const uint GMEM_MOVEABLE = 0x0002;
  const long SnapshotLimit = 64L * 1024 * 1024;
  static IntPtr owner;
  static readonly BlockingCollection<string> requests = new BlockingCollection<string>();

  class Snapshot { public List<KeyValuePair<uint, byte[]>> Formats = new List<KeyValuePair<uint, byte[]>>(); public bool Empty; }
  static Snapshot pendingSnapshot;
  static uint pendingSequence;
  static DateTime pendingDue;

  // ---- Message pumping and waits --------------------------------------------------------
  static void Pump() {
    MSG msg;
    while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
  }
  static void Wait(int ms) {
    var started = Environment.TickCount;
    do { Pump(); Thread.Sleep(10); } while (unchecked(Environment.TickCount - started) < ms);
  }
  static bool WaitForClipboard(uint before, int timeoutMs) {
    var started = Environment.TickCount;
    while (unchecked(Environment.TickCount - started) < timeoutMs) {
      if (GetClipboardSequenceNumber() != before) { Wait(30); return true; }
      Wait(15);
    }
    return GetClipboardSequenceNumber() != before;
  }

  // ---- Keyboard ---------------------------------------------------------------------------
  static INPUT Key(ushort key, uint flags) { var input = new INPUT(); input.type = 1; input.U.ki.wVk = key; input.U.ki.dwFlags = flags; return input; }
  static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  static void Chord(ushort key) {
    var started = Environment.TickCount;
    while (IsDown(0x10) || IsDown(0x11) || IsDown(0x12) || IsDown(0x5B) || IsDown(0x5C)) {
      if (unchecked(Environment.TickCount - started) > 2000) throw new InvalidOperationException("Release Ctrl, Shift, and Alt, then try again.");
      Wait(25);
    }
    var inputs = new [] { Key(0x11, 0), Key(key, 0), Key(key, 2), Key(0x11, 2) };
    var inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (inserted != (uint)inputs.Length) throw new InvalidOperationException("Windows rejected simulated keyboard input (" + inserted + "/" + inputs.Length + " events; error " + Marshal.GetLastWin32Error() + ").");
  }
  static bool Activate(IntPtr target) {
    var foreground = GetForegroundWindow();
    var foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    var targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
    var currentThread = GetCurrentThreadId();
    var attachedForeground = foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    var attachedTarget = targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
    try {
      if (IsIconic(target)) ShowWindow(target, 9);
      BringWindowToTop(target);
      SetActiveWindow(target);
      return SetForegroundWindow(target);
    } finally {
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
  static void FocusTarget(IntPtr target, string failure) {
    if (target == IntPtr.Zero || !IsWindow(target)) throw new InvalidOperationException(failure);
    if (GetForegroundWindow() != target && !Activate(target)) throw new InvalidOperationException(failure);
    Wait(120);
    if (GetForegroundWindow() != target) throw new InvalidOperationException("The original app is no longer active. Nothing was replaced.");
  }

  // ---- UI Automation ----------------------------------------------------------------------
  // Queried from compiled code: from a PowerShell expression, managed UIA reported native edit
  // controls in other apps as a Pane without ValuePattern.
  static string FocusedRuntimeId() {
    try {
      var focused = AutomationElement.FocusedElement;
      return focused == null ? "" : string.Join(".", focused.GetRuntimeId());
    } catch (Exception) { return ""; }
  }
  static string CheckFocusedField(string runtimeId, string expected) {
    var focused = AutomationElement.FocusedElement;
    if (focused == null) return "The original text field is no longer focused. Nothing was replaced.";
    if (string.Join(".", focused.GetRuntimeId()) != runtimeId) return "The focused text field changed. Nothing was replaced.";
    object pattern;
    if (!focused.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || ((ValuePattern)pattern).Current.IsReadOnly) return "This text field cannot be safely replaced.";
    if (!string.Equals(((ValuePattern)pattern).Current.Value, expected, StringComparison.Ordinal)) return "The text changed since this suggestion was created. Nothing was replaced.";
    return "";
  }
  // The editor ClearWrite read: the focused element, or one of its first six ancestors when the
  // focus reader resolved a container around the focused field (common in browsers and Electron
  // apps). Null when focus has moved to a different editor.
  static AutomationElement FindEditor(string runtimeId) {
    if (string.IsNullOrEmpty(runtimeId)) return null;
    try {
      var element = AutomationElement.FocusedElement;
      for (int depth = 0; element != null && depth < 7; depth++) {
        if (string.Join(".", element.GetRuntimeId()) == runtimeId) return element;
        element = TreeWalker.RawViewWalker.GetParent(element);
      }
    } catch (Exception) { }
    return null;
  }

  // Classic edit controls ignore Ctrl+A, so select through TextPattern when available.
  static bool SelectAllFocused() {
    try {
      var focused = AutomationElement.FocusedElement;
      object pattern;
      if (focused == null || !focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return false;
      ((TextPattern)pattern).DocumentRange.Select();
      return true;
    } catch (Exception) { return false; }
  }

  // ---- Clipboard --------------------------------------------------------------------------
  static void OpenOrThrow() {
    for (int attempt = 0; attempt < 40; attempt++) {
      if (OpenClipboard(owner)) return;
      Wait(15);
    }
    throw new InvalidOperationException("Another app is using the clipboard. Try again.");
  }
  // Handle-based GDI formats cannot be copied as bytes; Windows synthesizes them from CF_DIB.
  static bool Copyable(uint format) {
    if (format == 2 || format == 3 || format == 9 || format == 14) return false;          // BITMAP, METAFILEPICT, PALETTE, ENHMETAFILE
    if (format == 0x80 || format == 0x82 || format == 0x83 || format == 0x8E) return false; // owner-display/display formats
    if (format >= 0x200 && format <= 0x3FF) return false;                                     // private and GDI object ranges
    return true;
  }
  static Snapshot TakeSnapshot() {
    var snapshot = new Snapshot();
    OpenOrThrow();
    try {
      long total = 0;
      uint format = 0;
      while ((format = EnumClipboardFormats(format)) != 0) {
        if (!Copyable(format)) continue;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) continue;
        long size = (long)GlobalSize(handle).ToUInt64();
        if (size <= 0 || total + size > SnapshotLimit) continue;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) continue;
        try {
          var bytes = new byte[size];
          Marshal.Copy(pointer, bytes, 0, (int)size);
          snapshot.Formats.Add(new KeyValuePair<uint, byte[]>(format, bytes));
          total += size;
        } finally { GlobalUnlock(handle); }
      }
      snapshot.Empty = snapshot.Formats.Count == 0;
    } finally { CloseClipboard(); }
    return snapshot;
  }
  static void SetBytes(uint format, byte[] bytes) {
    var memory = GlobalAlloc(GMEM_MOVEABLE, new UIntPtr((ulong)Math.Max(bytes.Length, 1)));
    if (memory == IntPtr.Zero) return;
    var pointer = GlobalLock(memory);
    if (pointer == IntPtr.Zero) { GlobalFree(memory); return; }
    try { Marshal.Copy(bytes, 0, pointer, bytes.Length); } finally { GlobalUnlock(memory); }
    if (SetClipboardData(format, memory) == IntPtr.Zero) GlobalFree(memory);
  }
  // Marks ClearWrite-written content so clipboard history and cloud clipboard skip it.
  static void MarkPrivate() {
    SetBytes(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"), new byte[] { 0, 0, 0, 0 });
    SetBytes(RegisterClipboardFormat("CanIncludeInClipboardHistory"), new byte[] { 0, 0, 0, 0 });
    SetBytes(RegisterClipboardFormat("CanUploadToCloudClipboard"), new byte[] { 0, 0, 0, 0 });
  }
  static void WriteText(string text) {
    OpenOrThrow();
    try {
      EmptyClipboard();
      SetBytes(CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\0"));
      MarkPrivate();
    } finally { CloseClipboard(); }
  }
  static string ReadText() {
    OpenOrThrow();
    try {
      var handle = GetClipboardData(CF_UNICODETEXT);
      if (handle == IntPtr.Zero) return "";
      var pointer = GlobalLock(handle);
      if (pointer == IntPtr.Zero) return "";
      try { return Marshal.PtrToStringUni(pointer) ?? ""; } finally { GlobalUnlock(handle); }
    } finally { CloseClipboard(); }
  }
  static void Restore(Snapshot snapshot) {
    OpenOrThrow();
    try {
      EmptyClipboard();
      if (!snapshot.Empty) {
        foreach (var entry in snapshot.Formats) SetBytes(entry.Key, entry.Value);
        // The user's content was already recorded when they copied it; do not record it twice.
        MarkPrivate();
      }
    } finally { CloseClipboard(); }
  }
  // Restores now if nothing else has been copied since ClearWrite wrote to the clipboard.
  static void FlushPendingRestore(bool force) {
    if (pendingSnapshot == null || (!force && DateTime.UtcNow < pendingDue)) return;
    var snapshot = pendingSnapshot;
    pendingSnapshot = null;
    if (GetClipboardSequenceNumber() == pendingSequence) {
      try { Restore(snapshot); } catch (Exception) { }
    }
  }

  // ---- Actions ------------------------------------------------------------------------------
  static string Normalize(string value) { return (value ?? "").Replace("\r\n", "\n").Replace("\r", "\n"); }
  // When the selection really ended with a paragraph break (copied text ends in one), the pasted
  // text keeps it, so replacing a whole paragraph never merges it with the next one.
  static string MissingBreaks(string copied, string replacement) {
    var raw = copied ?? "";
    int end = raw.Length;
    while (end > 0 && (raw[end - 1] == '\r' || raw[end - 1] == '\n')) end--;
    var breaks = raw.Substring(end);
    if (breaks.Length == 0 || replacement.EndsWith("\n") || replacement.EndsWith("\r")) return "";
    return breaks;
  }
  static bool ExcludeTrailingBreaks(string expected) {
    try {
      var focused = AutomationElement.FocusedElement;
      object pattern;
      if (focused == null || !focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return false;
      var selection = ((TextPattern)pattern).GetSelection();
      if (selection.Length != 1) return false;
      var range = selection[0];
      for (int step = 0; step < 4; step++) {
        var text = range.GetText(-1) ?? "";
        if (text.Length == 0 || (text[text.Length - 1] != '\r' && text[text.Length - 1] != '\n')) break;
        if (range.MoveEndpointByUnit(System.Windows.Automation.Text.TextPatternRangeEndpoint.End, System.Windows.Automation.Text.TextUnit.Character, -1) != -1) return false;
      }
      if (Normalize(range.GetText(-1)).TrimEnd('\n') != Normalize(expected).TrimEnd('\n') || Normalize(range.GetText(-1)).EndsWith("\n")) return false;
      range.Select();
      Wait(60);
      return true;
    } catch (Exception) { return false; }
  }

  static string SelectionTail() {
    try {
      var focused = AutomationElement.FocusedElement;
      object pattern;
      if (focused == null || !focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return "";
      var selection = ((TextPattern)pattern).GetSelection();
      if (selection.Length != 1) return "";
      var text = selection[0].GetText(-1) ?? "";
      int end = text.Length;
      while (end > 0 && (text[end - 1] == '\r' || text[end - 1] == '\n')) end--;
      return text.Substring(end).Length > 0 ? "x" + text.Substring(end) : "";
    } catch (Exception) { return ""; }
  }
  // Word and Outlook can add a paragraph break when copying a selection; ignore trailing breaks.
  static bool SameSelection(string copied, string expected) { return Normalize(copied).TrimEnd('\n') == Normalize(expected).TrimEnd('\n'); }

  static string Capture(long id) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    var target = GetForegroundWindow();
    POINT point;
    GetCursorPos(out point);
    var snapshot = TakeSnapshot();
    var before = GetClipboardSequenceNumber();
    string text = "";
    bool copied;
    try {
      Chord(0x43);
      copied = WaitForClipboard(before, 900);
      if (copied) text = ReadText();
    } finally {
      if (GetClipboardSequenceNumber() != before) { try { Restore(snapshot); } catch (Exception) { } }
    }
    return "{\"id\":" + id + ",\"ok\":true,\"target\":" + target.ToInt64() + ",\"copied\":" + (copied ? "true" : "false") +
      ",\"text\":\"" + B64(text) + "\",\"x\":" + point.X + ",\"y\":" + point.Y + "}";
  }

  // mode "selection": the user's selection must still equal `expected`.
  // mode "field": the focused field must be `runtimeId` with value `expected`; it is selected whole.
  static string Replace(long id, string mode, IntPtr target, string runtimeId, string expected, string replacement) {
    FocusTarget(target, "The original app could not be focused. Nothing was replaced.");
    if (mode == "field") {
      var problem = CheckFocusedField(runtimeId, expected);
      if (problem.Length > 0) throw new InvalidOperationException(problem);
      if (!SelectAllFocused()) Chord(0x41);
      Wait(60);
    } else runtimeId = FocusedRuntimeId();
    // Some editors (RichEdit) leave a selected paragraph break off the clipboard; UI Automation
    // still reports it, so the pasted text can keep it.
    var selectedTail = mode == "field" ? "" : SelectionTail();
    var snapshot = TakeSnapshot();
    var before = GetClipboardSequenceNumber();
    bool pasted = false;
    try {
      Chord(0x43);
      var copied = WaitForClipboard(before, 900);
      var copiedText = copied ? ReadText() : "";
      if (!copied || !SameSelection(copiedText, expected)) {
        throw new InvalidOperationException(mode == "field"
          ? "ClearWrite could not select exactly this field's text, so nothing was replaced. Use Copy instead."
          : "The original text is no longer selected, so nothing was replaced. Select it again and press the shortcut, or use Copy.");
      }
      // A selection that ends with a paragraph break: leave the break in place by shrinking the
      // selection to the text before it (UI Automation), so the paste can never merge paragraphs.
      // Editors without that support get the break appended to the pasted text instead.
      var keep = "";
      if (MissingBreaks(copiedText, replacement).Length > 0 || selectedTail.Length > 0) {
        if (!ExcludeTrailingBreaks(expected)) keep = MissingBreaks(copiedText.Length > 0 ? copiedText : selectedTail, replacement);
      }
      WriteText(replacement + keep);
      var written = GetClipboardSequenceNumber();
      if (GetForegroundWindow() != target) throw new InvalidOperationException("The original app is no longer active. Nothing was replaced.");
      if (runtimeId.Length > 0 && FocusedRuntimeId() != runtimeId) throw new InvalidOperationException("The focused text field changed. Nothing was replaced.");
      Chord(0x56);
      pasted = true;
      // The app reads the clipboard while it handles Ctrl+V; restore once it has had time.
      pendingSnapshot = snapshot;
      pendingSequence = written;
      pendingDue = DateTime.UtcNow.AddMilliseconds(1200);
    } finally {
      if (!pasted && GetClipboardSequenceNumber() != before) { try { Restore(snapshot); } catch (Exception) { } }
    }
    return "{\"id\":" + id + ",\"ok\":true}";
  }

  // Replaces individual spans inside a rich editor (TextPattern) without touching the rest of
  // the document. Each span is "before\u0001original\u0001after\u0001replacement"; spans are
  // separated by \u0002 and given last-to-first. A span is replaced only when before+original+after
  // occurs exactly once in the document, the narrowed range reads back as `original`, and copying
  // the selected range yields `original`. Stops at the first span that cannot be verified.
  static string ReplaceSpans(long id, IntPtr target, string runtimeId, string payload) {
    FocusTarget(target, "The original app could not be focused. Nothing was replaced.");
    var spans = payload.Split('\u0002');
    int applied = 0;
    string problem = "";
    foreach (var raw in spans) {
      var parts = raw.Split('\u0001');
      if (parts.Length != 4 || parts[1].Length == 0) { problem = "Invalid change."; break; }
      string before = parts[0], original = parts[1], after = parts[2], replacement = parts[3];
      var focused = FindEditor(runtimeId);
      if (focused == null) { problem = "The focused text field changed."; break; }
      object pattern;
      if (!focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) { problem = "This editor does not support changing single words. Use Copy instead."; break; }
      var document = ((TextPattern)pattern).DocumentRange;
      var needle = before + original + after;
      var found = document.FindText(needle, false, false);
      if (found == null) { problem = "The text around a change is no longer the same."; break; }
      var rest = document.Clone();
      rest.MoveEndpointByRange(System.Windows.Automation.Text.TextPatternRangeEndpoint.Start, found, System.Windows.Automation.Text.TextPatternRangeEndpoint.End);
      if (rest.FindText(needle, false, false) != null) { problem = "A change could not be located unambiguously."; break; }
      if (before.Length > 0 && found.MoveEndpointByUnit(System.Windows.Automation.Text.TextPatternRangeEndpoint.Start, System.Windows.Automation.Text.TextUnit.Character, before.Length) != before.Length) { problem = "A change could not be located exactly."; break; }
      if (after.Length > 0 && found.MoveEndpointByUnit(System.Windows.Automation.Text.TextPatternRangeEndpoint.End, System.Windows.Automation.Text.TextUnit.Character, -after.Length) != -after.Length) { problem = "A change could not be located exactly."; break; }
      if (found.GetText(-1) != original) { problem = "A change could not be located exactly."; break; }
      found.Select();
      Wait(60);
      var snapshot = TakeSnapshot();
      var copiedBefore = GetClipboardSequenceNumber();
      bool pasted = false;
      try {
        Chord(0x43);
        if (!WaitForClipboard(copiedBefore, 900) || !SameSelection(ReadText(), original)) { problem = "The selected text did not match the change."; break; }
        WriteText(replacement);
        var written = GetClipboardSequenceNumber();
        if (GetForegroundWindow() != target || FindEditor(runtimeId) == null) { problem = "The original field is no longer active."; break; }
        Chord(0x56);
        pasted = true;
        // Wait until the editor shows the replacement (it has read the clipboard) before the
        // next span or restoring the user's clipboard; give up waiting after 1.5 s.
        var expectedNow = before + replacement + after;
        var started = Environment.TickCount;
        bool visible = false;
        while (unchecked(Environment.TickCount - started) < 1500) {
          Wait(40);
          try { if (((TextPattern)pattern).DocumentRange.FindText(expectedNow, false, false) != null) { visible = true; break; } } catch (Exception) { }
        }
        if (!visible) Wait(300);
        if (GetClipboardSequenceNumber() == written) { try { Restore(snapshot); } catch (Exception) { } }
        applied++;
      } finally {
        if (!pasted && GetClipboardSequenceNumber() != copiedBefore) { try { Restore(snapshot); } catch (Exception) { } }
      }
    }
    return "{\"id\":" + id + ",\"ok\":true,\"applied\":" + applied + ",\"total\":" + spans.Length + ",\"problem\":\"" + B64(problem) + "\"}";
  }

  // Screen rectangles (physical pixels) of each span's original words in the focused editor,
  // located like ReplaceSpans (unique context, exact read-back). Read-only: no focus change, no
  // selection, no clipboard. Spans: "before\u0001original\u0001after" separated by \u0002.
  // A span that cannot be located exactly gets no rectangles.
  static string WordBounds(long id, IntPtr target, string runtimeId, string payload) {
    var result = new StringBuilder("{\"id\":" + id + ",\"ok\":true,\"bounds\":[");
    var spans = payload.Length == 0 ? new string[0] : payload.Split('\u0002');
    TextPattern text = null;
    if (GetForegroundWindow() == target) {
      try {
        var focused = FindEditor(runtimeId);
        object pattern;
        if (focused != null && focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) text = (TextPattern)pattern;
      } catch (Exception) { text = null; }
    }
    for (int index = 0; index < spans.Length; index++) {
      if (index > 0) result.Append(',');
      result.Append('[');
      var parts = spans[index].Split('\u0001');
      if (text != null && parts.Length == 3 && parts[1].Length > 0) {
        try {
          var document = text.DocumentRange;
          var needle = parts[0] + parts[1] + parts[2];
          var found = document.FindText(needle, false, false);
          if (found != null) {
            var rest = document.Clone();
            rest.MoveEndpointByRange(System.Windows.Automation.Text.TextPatternRangeEndpoint.Start, found, System.Windows.Automation.Text.TextPatternRangeEndpoint.End);
            bool unique = rest.FindText(needle, false, false) == null;
            bool narrowed = (parts[0].Length == 0 || found.MoveEndpointByUnit(System.Windows.Automation.Text.TextPatternRangeEndpoint.Start, System.Windows.Automation.Text.TextUnit.Character, parts[0].Length) == parts[0].Length)
              && (parts[2].Length == 0 || found.MoveEndpointByUnit(System.Windows.Automation.Text.TextPatternRangeEndpoint.End, System.Windows.Automation.Text.TextUnit.Character, -parts[2].Length) == -parts[2].Length);
            if (unique && narrowed && found.GetText(-1) == parts[1]) {
              bool first = true;
              foreach (var rect in found.GetBoundingRectangles()) {
                if (rect.IsEmpty || rect.Width <= 0 || rect.Height <= 0) continue;
                if (!first) result.Append(',');
                first = false;
                result.Append("[" + (int)Math.Round(rect.X) + "," + (int)Math.Round(rect.Y) + "," + (int)Math.Round(rect.Width) + "," + (int)Math.Round(rect.Height) + "]");
              }
            }
          }
        } catch (Exception) { }
      }
      result.Append(']');
    }
    return result.Append("]}").ToString();
  }

  static string B64(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? "")); }
  static string Unb64(string value) { return value == "-" ? "" : Encoding.UTF8.GetString(Convert.FromBase64String(value)); }

  static string Handle(string line) {
    var parts = line.Split(' ');
    long id = 0;
    long.TryParse(parts[0], out id);
    try {
      if (parts.Length < 2) throw new InvalidOperationException("Invalid request.");
      FlushPendingRestore(true);
      var action = parts[1];
      long target = parts.Length > 2 ? long.Parse(parts[2]) : 0;
      if (action == "validate") {
        var size = Marshal.SizeOf(typeof(INPUT));
        if (size != (IntPtr.Size == 8 ? 40 : 28)) throw new InvalidOperationException("Unexpected native INPUT size: " + size + ".");
        return "{\"id\":" + id + ",\"ok\":true}";
      }
      if (action == "capture") return Capture(id);
      if (action == "replace-selection" || action == "replace-field") {
        if (parts.Length < 6) throw new InvalidOperationException("Invalid request.");
        return Replace(id, action == "replace-field" ? "field" : "selection", new IntPtr(target), Unb64(parts[3]), Unb64(parts[4]), Unb64(parts[5]));
      }
      if (action == "word-bounds") {
        if (parts.Length < 5) throw new InvalidOperationException("Invalid request.");
        return WordBounds(id, new IntPtr(target), Unb64(parts[3]), Unb64(parts[4]));
      }
      if (action == "replace-spans") {
        if (parts.Length < 5) throw new InvalidOperationException("Invalid request.");
        return ReplaceSpans(id, new IntPtr(target), Unb64(parts[3]), Unb64(parts[4]));
      }
      throw new InvalidOperationException("Unknown input action.");
    } catch (Exception error) {
      return "{\"id\":" + id + ",\"ok\":false,\"error\":\"" + B64(error.Message) + "\"}";
    }
  }

  public static void Run() {
    // Physical pixels on every monitor, so word rectangles and the cursor position are exact.
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    // A message-only window owns ClearWrite's clipboard writes (SetClipboardData needs an owner).
    owner = CreateWindowEx(0, "STATIC", "ClearWrite input", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) requests.Add(line);
      requests.CompleteAdding();
    });
    reader.IsBackground = true;
    reader.Start();
    Console.Out.WriteLine("{\"ready\":true}");
    Console.Out.Flush();
    while (!requests.IsCompleted) {
      Pump();
      FlushPendingRestore(false);
      string line;
      if (!requests.TryTake(out line, 20)) continue;
      if (line.Trim().Length == 0) continue;
      var response = Handle(line.Trim());
      Console.Out.WriteLine(response);
      Console.Out.Flush();
    }
    FlushPendingRestore(true);
  }
}
