using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using Accessibility;

// This component only reads the focused editing surface. No clipboard, input injection,
// desktop-wide tree search, process-memory writes, or application-name adapters.
public static class ClearWriteEditorReader {
  const int Limit = 6000;
  static readonly bool Fallbacks = Environment.GetEnvironmentVariable("CLEARWRITE_EDITOR_FALLBACKS") != "0";
  static readonly string Session = Guid.NewGuid().ToString("N");
  public delegate Dictionary<string, object> NativeReader(long window, string appName, string[] excluded);
  public static NativeReader NativeFallback;
  static Dictionary<string, Sample> samples = new Dictionary<string, Sample>();
  class Sample { public string Text; public TextPatternRange Range; public DateTime Seen; public int Context; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct GUIINFO {
    public int Size, Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public RECT CaretRect;
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object value);

  static Dictionary<string, object> Away(string reason, string process) {
    return new Dictionary<string, object> { { "active", false }, { "reason", reason }, { "processName", process } };
  }
  static string ProcessName(int pid) { return Process.GetProcessById(pid).ProcessName.ToLowerInvariant(); }
  static bool Contains(string[] list, string value) { return Array.IndexOf(list, value) >= 0; }
  static bool Related(AutomationElement element, AutomationElement root) {
    for (int depth = 0; element != null && depth < 24; depth++) {
      if (element.Current.IsPassword) throw new UnauthorizedAccessException();
      if (Automation.Compare(element, root)) return true;
      element = TreeWalker.RawViewWalker.GetParent(element);
    }
    return false;
  }
  public static bool NativeBelongsToWindow(long foreground, long child) {
    return foreground != 0 && child != 0 && (foreground == child || IsChild(new IntPtr(foreground), new IntPtr(child)));
  }
  static bool BelongsToForeground(AutomationElement element, AutomationElement root, IntPtr foreground) {
    // Web/hosted providers can expose fragment roots with different UIA identities,
    // and deep DOM trees can exceed the old 24-parent check. A native child HWND
    // is positive ownership evidence, without trusting process ID alone.
    for (int depth = 0; element != null && depth < 64; depth++) {
      var current = element.Current;
      if (current.IsPassword) throw new UnauthorizedAccessException();
      if (Automation.Compare(element, root) || NativeBelongsToWindow(foreground.ToInt64(), current.NativeWindowHandle)) return true;
      element = TreeWalker.RawViewWalker.GetParent(element);
    }
    return false;
  }
  static string Id(AutomationElement element) { return string.Join(".", Array.ConvertAll(element.GetRuntimeId(), n => n.ToString())); }
  static string ClassName(IntPtr window) { var text = new StringBuilder(128); GetClassName(window, text, text.Capacity); return text.ToString(); }
  static bool NativeFocusMatches(IntPtr foreground, IntPtr expected) {
    uint pid; uint thread = GetWindowThreadProcessId(foreground, out pid);
    var info = new GUIINFO(); info.Size = Marshal.SizeOf(typeof(GUIINFO));
    return GetForegroundWindow() == foreground && GetGUIThreadInfo(thread, ref info) && info.Focus == expected;
  }
  public static bool CanReadTextRange(ControlType role, bool collapsed, object readOnly) {
    return (role == ControlType.Edit || role == ControlType.Document || role == ControlType.ComboBox)
      && collapsed && readOnly is bool && !(bool)readOnly;
  }
  public static bool CanReadValueRole(ControlType role) {
    return role == ControlType.Edit || role == ControlType.Document || role == ControlType.ComboBox;
  }
  public static bool IsNonTextInteraction(ControlType role) {
    return role == ControlType.Slider || role == ControlType.ScrollBar || role == ControlType.ProgressBar
      || role == ControlType.Spinner || role == ControlType.Button || role == ControlType.CheckBox
      || role == ControlType.RadioButton || role == ControlType.Hyperlink || role == ControlType.MenuItem || role == ControlType.TabItem;
  }

  public static Dictionary<string, object> Read(long handle, int ownPid, string[] excluded, string[] allowed, bool restricted) {
    var foreground = new IntPtr(handle);
    uint hostPid; uint thread = GetWindowThreadProcessId(foreground, out hostPid);
    string host = "";
    try {
      host = ProcessName((int)hostPid);
      if (hostPid == ownPid) return Away("self", "clearwrite");
      if (Contains(excluded, host)) return Away("excludedApp", host);
      if (restricted && !Contains(allowed, host)) return Away("notAllowed", host);
      var gui = new GUIINFO(); gui.Size = Marshal.SizeOf(typeof(GUIINFO));
      GetGUIThreadInfo(thread, ref gui);
      if (Fallbacks && gui.Focus != IntPtr.Zero && (gui.Focus == foreground || IsChild(foreground, gui.Focus)) && ClassName(gui.Focus).StartsWith("Scintilla", StringComparison.Ordinal)) {
        return ReadScintilla(foreground, gui.Focus, host);
      }
      var focus = AutomationElement.FocusedElement;
      if (focus == null) return Away("noFocus", host);
      var root = AutomationElement.FromHandle(foreground);
      if (!BelongsToForeground(focus, root, foreground)) return Away("foreignEditor", host);
      if (focus.Current.ProcessId == ownPid) return Away("self", "clearwrite");
      // Hosted editors may have a renderer PID; restrictions always apply to the host,
      // and an excluded renderer is still rejected before field text is accessed.
      if (Contains(excluded, ProcessName(focus.Current.ProcessId))) return Away("excludedApp", host);
      AutomationElement candidate = focus;
      bool uncertain = false, readOnly = false;
      for (int depth = 0; candidate != null && depth < 6; depth++) {
        var current = candidate.Current;
        if (current.IsPassword) return Away("password", host);
        if (!current.IsEnabled) return Away("disabled", host);
        // Changing a seek bar/volume/progress value is not a text edit. Do not
        // read its value or climb past it into the surrounding web document.
        if (IsNonTextInteraction(current.ControlType)) return Away("nonTextControl", host);
        object value;
        if (CanReadValueRole(current.ControlType) && candidate.TryGetCurrentPattern(ValuePattern.Pattern, out value)) {
          var pattern = (ValuePattern)value;
          if (pattern.Current.IsReadOnly) { readOnly = true; break; }
          var text = pattern.Current.Value ?? "";
          if (text.Length <= Limit) {
            bool direct = Automation.Compare(candidate, focus);
            bool replace = direct && (current.ControlType == ControlType.Edit || current.ControlType == ControlType.ComboBox);
            return Snapshot(foreground, candidate, host, text, "value", null, "", replace);
          }
          // A long rich document can still expose a bounded paragraph via TextPattern.
        }
        if (Fallbacks && candidate.TryGetCurrentPattern(TextPattern.Pattern, out value)) {
          var pattern = (TextPattern)value;
          var selection = pattern.GetSelection();
          if (selection.Length == 1) {
            var caret = selection[0];
            var readOnlyValue = caret.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
            bool collapsed = caret.CompareEndpoints(TextPatternRangeEndpoint.Start, caret, TextPatternRangeEndpoint.End) == 0;
            if (readOnlyValue is bool && (bool)readOnlyValue) { readOnly = true; break; }
            // TextPattern alone is not evidence of an editor. Require a collapsed caret,
            // explicit writable range, an editing role and focus inside this container.
            if (CanReadTextRange(current.ControlType, collapsed, readOnlyValue)) {
              var range = pattern.DocumentRange;
              string text = range.GetText(Limit + 1);
              bool partial = text.Length > Limit;
              if (partial) { range = caret.Clone(); range.ExpandToEnclosingUnit(TextUnit.Paragraph); text = range.GetText(Limit + 1); }
              if (text.Length <= Limit) return Snapshot(foreground, candidate, host, text, "text", partial ? range : null, "", false);
              return Away("tooLong", host);
            }
            uncertain = true;
          } else uncertain = true;
        }
        if (!Fallbacks || Automation.Compare(candidate, root)) break;
        candidate = TreeWalker.RawViewWalker.GetParent(candidate);
      }
      // MSAA is a separate generic fallback for providers without usable UIA patterns.
      if (Fallbacks && !readOnly && !uncertain && NativeFallback != null) {
        var native = NativeFallback(handle, host, excluded);
        if (native != null) return native;
      }
      if (Fallbacks && !readOnly && !uncertain && gui.Focus != IntPtr.Zero && (gui.Focus == foreground || IsChild(foreground, gui.Focus))) {
        var legacy = ReadLegacy(foreground, gui.Focus, host);
        if (legacy != null) return legacy;
      }
      return Away(readOnly ? "readonly" : uncertain ? "uncertainEditor" : "unsupported", host);
    } catch (TimeoutException) { return Away("providerTimeout", host); }
    catch (UnauthorizedAccessException) { return Away("password", host); }
    catch (ElementNotAvailableException) { return Away("fieldGap", host); }
    catch { return Away("providerError", host); }
  }

  static Dictionary<string, object> Snapshot(IntPtr foreground, AutomationElement element, string process, string text, string source, TextPatternRange range, string context, bool replace) {
    if (!Related(AutomationElement.FocusedElement, element)) return Away("focusChanged", process);
    var current = element.Current;
    var rect = current.BoundingRectangle;
    return MakeSnapshot(foreground, process, current.ProcessId, Id(element), text, source, range, context, replace,
      current.ControlType.ProgrammaticName, current.Name, current.AutomationId, (int)rect.X, (int)rect.Y, (int)rect.Width, (int)rect.Height);
  }
  public static Dictionary<string, object> NativeSnapshot(long foreground, string host, int pid, string runtime, string text, string name, string automationId, int x, int y, int width, int height) {
    return MakeSnapshot(new IntPtr(foreground), host, pid, "uia3:" + runtime, text, "uia3-value", null, "", false,
      "ControlType.Edit", name, automationId, x, y, width, height);
  }
  static Dictionary<string, object> MakeSnapshot(IntPtr foreground, string process, int pid, string runtime, string text, string source, TextPatternRange range, string context, bool replace, string type, string name, string automationId, int x, int y, int width, int height) {
    if (GetForegroundWindow() != foreground) return Away("focusChanged", process);
    string key = Session + "|" + foreground.ToInt64() + "|" + pid + "|" + runtime + context;
    Sample previous;
    bool known = samples.TryGetValue(key, out previous);
    bool comparable = known && DateTime.UtcNow - previous.Seen < TimeSpan.FromSeconds(10);
    if (comparable && (range != null || previous.Range != null)) {
      try { comparable = range != null && previous.Range != null && range.CompareEndpoints(TextPatternRangeEndpoint.Start, previous.Range, TextPatternRangeEndpoint.Start) == 0; }
      catch { comparable = false; }
    }
    bool changed = comparable && previous.Text != text;
    int revision = known ? previous.Context + (comparable ? 0 : 1) : 0;
    if (samples.Count >= 32 && !samples.ContainsKey(key)) samples.Clear();
    samples[key] = new Sample { Text = text, Range = range == null ? null : range.Clone(), Seen = DateTime.UtcNow, Context = revision };
    return new Dictionary<string, object> {
      {"active", true}, {"key", key + ":context:" + revision}, {"processId", pid}, {"processName", process}, {"runtimeId", runtime},
      {"controlName", name}, {"automationId", automationId}, {"controlType", type}, {"editable", true},
      {"readOnly", false}, {"changed", changed}, {"target", foreground.ToInt64()}, {"text", text},
      {"x", x}, {"y", y}, {"width", width}, {"height", height}, {"replaceSupported", replace},
      {"tooLong", false}, {"reader", source}
    };
  }

  static Dictionary<string, object> ReadLegacy(IntPtr foreground, IntPtr focus, string process) {
    object raw; var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    if (AccessibleObjectFromWindow(focus, 0xFFFFFFFC, ref iid, out raw) != 0) return null;
    var accessible = raw as IAccessible;
    object child = 0;
    for (int depth = 0; accessible != null && depth < 6; depth++) {
      var state = Convert.ToInt32(accessible.get_accState(child));
      if ((state & 0x20000000) != 0) return Away("password", process);
      if ((state & 0x40) != 0) return Away("readonly", process);
      int role = Convert.ToInt32(accessible.get_accRole(child));
      if (role == 42 && (state & 4) != 0 && (state & 1) == 0) {
        string text = accessible.get_accValue(child) ?? "";
        if (text.Length > Limit) return Away("tooLong", process);
        if (!NativeFocusMatches(foreground, focus)) return Away("focusChanged", process);
        RECT rect; GetWindowRect(focus, out rect); uint pid; GetWindowThreadProcessId(focus, out pid);
        return MakeSnapshot(foreground, process, (int)pid, "legacy:" + focus.ToInt64() + ":" + child, text, "legacy", null, "", false,
          "ControlType.Edit", "", "", rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
      }
      object next = accessible.accFocus;
      if (next is IAccessible) { accessible = (IAccessible)next; child = 0; }
      else if (next is int && (int)next > 0 && Convert.ToInt32(child) == 0) child = next;
      else return null;
    }
    return null;
  }

  static long Scalar(IntPtr window, uint message, long parameter, Stopwatch clock) {
    if (clock.ElapsedMilliseconds > 180) throw new TimeoutException();
    UIntPtr result;
    if (SendMessageTimeout(window, message, new IntPtr(parameter), IntPtr.Zero, 0x22, 20, out result) == IntPtr.Zero) throw new TimeoutException();
    return unchecked((long)result.ToUInt64());
  }
  static Dictionary<string, object> ReadScintilla(IntPtr foreground, IntPtr focus, string process) {
    if (!IsWindowEnabled(focus)) return Away("disabled", process);
    var clock = Stopwatch.StartNew();
    if (Scalar(focus, 2140, 0, clock) != 0) return Away("readonly", process);
    long caret = Scalar(focus, 2008, 0, clock);
    long line = Scalar(focus, 2166, caret, clock);
    long start = Scalar(focus, 2167, line, clock);
    long end = Scalar(focus, 2136, line, clock);
    if (start < 0 || end < start || end - start > 2048) return Away("tooLong", process);
    int codepage = (int)Scalar(focus, 2137, 0, clock);
    var bytes = new byte[(int)(end - start)];
    // Scalar SCI_GETCHARAT requires no cross-process pointers or remote memory.
    // Limit both bytes and wall-clock time; never change the document or selection.
    for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)Scalar(focus, 2007, start + i, clock);
    var encoding = codepage == 65001 ? new UTF8Encoding(false, true) : Encoding.GetEncoding(codepage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
    string text = encoding.GetString(bytes);
    if (!NativeFocusMatches(foreground, focus)) return Away("focusChanged", process);
    RECT rect; GetWindowRect(focus, out rect); uint pid; GetWindowThreadProcessId(focus, out pid);
    return MakeSnapshot(foreground, process, (int)pid, "scintilla:" + focus.ToInt64(), text, "scintilla", null, ":line:" + line, false,
      "ControlType.Document", "", "", rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
  }
}
