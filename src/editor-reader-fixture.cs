using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Test-owned windows only. No messages, clipboard operations or keystrokes are
// sent to another application. The reader runs on the caller's MTA thread.
public static class ClearWriteEditorFixture {
  static Form form;
  static TextBox edit;
  static RichTextBox rich;
  static ManualResetEvent ready = new ManualResetEvent(false);
  static int passed;
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); passed++; }
  static void OnUi(Action action) { form.Invoke(action); Thread.Sleep(120); }
  static Dictionary<string, object> Read(string[] excluded = null, string[] allowed = null, bool restricted = false) {
    long handle = 0; OnUi(() => handle = form.Handle.ToInt64());
    if (GetForegroundWindow().ToInt64() != handle) throw new Exception("Fixture did not acquire focus; no other app was inspected.");
    return ClearWriteEditorReader.Read(handle, 0, excluded ?? new string[0], allowed ?? new string[0], restricted);
  }
  static string Text(Dictionary<string, object> result) { return result.ContainsKey("text") ? (string)result["text"] : ""; }
  public static int Run() {
    Exception uiError = null;
    var ui = new Thread(() => {
      try {
        form = new Form { Text = "ClearWrite editor compatibility test", Width = 540, Height = 250, ShowInTaskbar = false, TopMost = false };
        edit = new TextBox { Left = 20, Top = 20, Width = 470, Text = "This is the original sample." };
        rich = new RichTextBox { Left = 20, Top = 65, Width = 470, Height = 100, Text = "This is a rich text sample." };
        form.Controls.Add(edit); form.Controls.Add(rich);
        form.Shown += (sender, args) => { form.Activate(); edit.Focus(); ready.Set(); };
        Application.Run(form);
      } catch (Exception error) { uiError = error; ready.Set(); }
    });
    ui.SetApartmentState(ApartmentState.STA); ui.Start();
    if (!ready.WaitOne(5000)) throw new Exception("Fixture startup timed out.");
    if (uiError != null) throw uiError;
    try {
      Thread.Sleep(200);
      var first = Read();
      Check((bool)first["active"] && Text(first) == "This is the original sample.", "Editable ValuePattern was not read.");
      Check(!(bool)first["changed"], "Focus alone must not count as typing.");
      Check((bool)first["replaceSupported"], "Direct normal textbox replacement regressed.");
      OnUi(() => edit.Text = "This is the edited sample.");
      var changed = Read();
      Check((bool)changed["changed"], "Text edit was not detected.");
      Check(!(bool)Read()["changed"], "Unchanged text was reported as another edit.");
      Check((string)first["key"] == (string)changed["key"], "Stable editor identity changed while typing.");
      var host = Process.GetCurrentProcess().ProcessName.ToLowerInvariant();
      Check((string)Read(new [] {host})["reason"] == "excludedApp", "Excluded host was read.");
      Check((string)Read(null, new [] {"not-this-app"}, true)["reason"] == "notAllowed", "Host allowlist was ignored.");
      Check((bool)Read(null, new [] {host}, true)["active"], "Allowed host was not read.");
      OnUi(() => edit.ReadOnly = true);
      var readOnly = Read();
      Check(!(bool)readOnly["active"] && !readOnly.ContainsKey("text"), "Read-only text leaked into a snapshot.");
      OnUi(() => { edit.ReadOnly = false; edit.UseSystemPasswordChar = true; edit.Text = "fixture-secret"; });
      var password = Read();
      Check(!(bool)password["active"] && !password.ContainsKey("text"), "Password text leaked into a snapshot.");
      OnUi(() => { rich.Focus(); rich.Select(rich.TextLength, 0); });
      var document = Read();
      Check((bool)document["active"] && Text(document).Contains("rich text sample"), "Rich editor was not detected.");
      Check(!(bool)document["replaceSupported"], "Rich document must remain copy-only.");
      OnUi(() => { rich.Text = new string('a', 6200) + "\nThis is the current paragraph."; rich.Select(rich.TextLength, 0); });
      var bounded = Read();
      Check((bool)bounded["active"] && Text(bounded).Length <= 6000 && Text(bounded).Contains("current paragraph"), "Long document did not use bounded caret context.");
      OnUi(() => rich.ReadOnly = true);
      var reading = Read();
      Check(!(bool)reading["active"] && !reading.ContainsKey("text"), "Reading a rich document was treated as writing.");
      return passed;
    } finally { OnUi(() => form.Close()); ui.Join(3000); }
  }
}
