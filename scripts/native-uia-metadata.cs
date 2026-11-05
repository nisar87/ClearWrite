using System;
using System.Collections.Generic;
using Interop.UIAutomationClient;

public static class NativeUiaMetadata {
  class Entry { public IUIAutomationElement Node; public int Depth; }
  public static List<Dictionary<string, object>> Inspect(long window) {
    IUIAutomation automation = new CUIAutomation8Class();
    var queue = new Queue<Entry>();
    queue.Enqueue(new Entry { Node = window == 0 ? automation.GetFocusedElement() : automation.ElementFromHandle(new IntPtr(window)), Depth = 0 });
    var nodes = new List<Dictionary<string, object>>();
    while (queue.Count > 0 && nodes.Count < 1000) {
      var entry = queue.Dequeue(); var node = entry.Node;
      nodes.Add(new Dictionary<string, object> {
        {"depth", entry.Depth}, {"type", node.CurrentControlType}, {"class", node.CurrentClassName},
        {"framework", node.CurrentFrameworkId}, {"focus", node.CurrentHasKeyboardFocus},
        {"password", node.CurrentIsPassword}, {"textPattern", node.GetCurrentPropertyValue(30040)}, {"valuePattern", node.GetCurrentPropertyValue(30043)}, {"readOnly", node.GetCurrentPropertyValue(30046)}
      });
      if (Convert.ToBoolean(node.CurrentIsPassword) || entry.Depth >= 32) continue;
      var child = automation.RawViewWalker.GetFirstChildElement(node);
      int count = 0;
      while (child != null && count++ < 50 && queue.Count < 1000) {
        queue.Enqueue(new Entry { Node = child, Depth = entry.Depth + 1 });
        child = automation.RawViewWalker.GetNextSiblingElement(child);
      }
    }
    return nodes;
  }
}
