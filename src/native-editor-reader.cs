using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Native = Interop.UIAutomationClient;

// Optional UIA3 recovery for hosted/windowless providers invisible to managed UIA.
public static class ClearWriteNativeEditorReader {
  static Native.IUIAutomation automation;
  static Native.IUIAutomationElement cached;
  static long cachedWindow;
  static DateTime nextProbe;
  public static string LastStatus = "initial";
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static void Initialize() { ClearWriteEditorReader.NativeFallback = Read; }
  public static bool ValidateRuntime() {
    var client = Client();
    return client.CreateAndCondition(client.CreatePropertyCondition(30003, 50004), client.CreatePropertyCondition(30008, true)) != null;
  }
  static bool Foreground(long window) { return GetForegroundWindow().ToInt64() == window; }
  static Native.IUIAutomation Client() {
    if (automation == null) {
      automation = new Native.CUIAutomation8Class();
      var timed = (Native.IUIAutomation2)automation;
      timed.ConnectionTimeout = 2000;
      timed.TransactionTimeout = 2000;
    }
    return automation;
  }
  static bool Owned(Native.IUIAutomationElement candidate, long window) {
    for (int depth = 0; candidate != null && depth < 64; depth++) {
      if (Convert.ToBoolean(candidate.CurrentIsPassword)) return false;
      if (ClearWriteEditorReader.NativeBelongsToWindow(window, candidate.CurrentNativeWindowHandle.ToInt64())) return true;
      candidate = Client().RawViewWalker.GetParentElement(candidate);
    }
    return false;
  }
  public static Dictionary<string, object> Read(long window, string host, string[] excluded) {
    LastStatus = "foregroundCheck";
    if (window <= 0 || !Foreground(window)) return null;
    try {
      Native.IUIAutomationElement candidate = cachedWindow == window ? cached : null;
      if (candidate == null || !Convert.ToBoolean(candidate.CurrentHasKeyboardFocus)) {
        cached = null;
        var client = Client();
        LastStatus = "focusedEditQuery";
        if (DateTime.UtcNow < nextProbe) return null;
        nextProbe = DateTime.UtcNow.AddSeconds(1);
        var root = client.ElementFromHandle(new IntPtr(window));
        var role = client.CreatePropertyCondition(30003, 50004);
        var focused = client.CreatePropertyCondition(30008, true);
        candidate = root.FindFirst(Native.TreeScope.TreeScope_Descendants, client.CreateAndCondition(role, focused));
        if (candidate == null) { LastStatus = "noFocusedEdit"; return null; }
        if (!Owned(candidate, window)) { LastStatus = "ownerMismatch"; return null; }
        cached = candidate; cachedWindow = window;
      }
      // A retained web-view focus is not enough: the host must still be foreground,
      // and every read rechecks focus, enabled/password state and renderer exclusions.
      if (!Foreground(window) || !Convert.ToBoolean(candidate.CurrentHasKeyboardFocus)
        || !Convert.ToBoolean(candidate.CurrentIsEnabled) || Convert.ToBoolean(candidate.CurrentIsPassword)) return null;
      if (!Owned(candidate, window)) return null;
      var process = Process.GetProcessById(candidate.CurrentProcessId).ProcessName.ToLowerInvariant();
      if (Array.IndexOf(excluded, process) >= 0) return null;
      var value = candidate.GetCurrentPattern(10002) as Native.IUIAutomationValuePattern;
      LastStatus = "writableValueCheck";
      if (value == null || Convert.ToBoolean(value.CurrentIsReadOnly)) return null;
      string text = value.CurrentValue ?? "";
      if (text.Length > 6000) return new Dictionary<string, object> { {"active", false}, {"reason", "tooLong"}, {"processName", host} };
      if (!Foreground(window) || !Convert.ToBoolean(candidate.CurrentHasKeyboardFocus)) return null;
      var rect = candidate.CurrentBoundingRectangle;
      var id = string.Join(".", Array.ConvertAll(candidate.GetRuntimeId(), n => n.ToString()));
      LastStatus = "ready";
      return ClearWriteEditorReader.NativeSnapshot(window, host, candidate.CurrentProcessId, id, text, candidate.CurrentName,
        candidate.CurrentAutomationId, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    } catch (Exception error) {
      LastStatus = "error:" + error.GetType().Name + ":" + error.HResult.ToString("X8");
      cached = null;
      return null;
    }
  }
}
