"""Capture the README screenshots with sample data.

Needs Python Playwright and Chrome:  pip install playwright && python -m playwright install chrome
Run from the repository root:          python scripts/screenshots/capture.py [path-to-chrome.exe]
Writes docs/screenshots/*.png. The ClearWrite API is replaced by a stub, so no app is started.
"""
import asyncio, json, subprocess, sys
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "screenshots"
WORK = ROOT / "release" / "screenshots-raw"
STATS_JSON = json.loads(subprocess.run(["node", str(ROOT / "scripts/screenshots/sample-stats.mjs")], capture_output=True, text=True, check=True).stdout)
STATE = {"provider":"gemini","proofreadingMode":"local","monitorEnabled":True,"monitorStatus":"Watching for writing","englishDialect":"american","englishDialects":{"american":"American English","british":"British English","australian":"Australian English"},"dictionaryWords":["ClearWrite","Nisar"],"learnedPatterns":[{"from":"recieve","to":"receive","accepts":3,"rejects":0,"trusted":True},{"from":"teh","to":"the","accepts":2,"rejects":0,"trusted":True}],"theme":"system","monitorStatus":"Watching Notepad for writing","showUnderlines":True,"suggestionStyle":"inline","aiReviewScope":"unsure","shortcut":"Ctrl+Shift+Space","excludedApps":[],"allowedApps":[],"restrictToAllowedApps":False,"lastFocusedApp":"notepad.exe","updates":{"status":"current","supported":True,"automatic":True,"currentVersion":"0.2.0-beta.10"},"automaticUpdates":True,"startupEnabled":True,"models":[],"geminiConfigured":False,"session":{"status":"unavailable"}}
VF=[{"kind":"Spelling","message":"Possible spelling mistake.","original":"recieve","suggestions":["receive"],"edits":[{"start":2,"end":9,"text":"receive"}],"choice":0},{"kind":"Grammar","message":"Use was with it.","original":"were","suggestions":["was"],"edits":[{"start":39,"end":43,"text":"was"}],"choice":0}]
VIEW = {"mode":"companion","status":"suggestion","appLabel":"Notepad","statusLine":"2 possible mistakes","pinned":True,"replaceSupported":True,"text":"I recieve the file yesterday and it were to large.","_f":[{"kind":"Spelling","message":"Possible spelling mistake.","original":"recieve","suggestions":["receive"],"edits":[{"start":2,"end":9,"text":"receive"}],"choice":0},{"kind":"Grammar","message":"Use 'was' with 'it'.","original":"were","suggestions":["was"],"edits":[{"start":39,"end":43,"text":"was"}],"choice":0}],"canApply":True,"applyMode":"spans","suggestion":{"findings":VF,"source":"local","sourceLabel":"On-device check","text":"I receive the file yesterday and it was to large.","needsChoice":0}}
STATE["stats"] = STATS_JSON
STUB = """
(() => { const S = %s, V = %s; const noop = () => () => {};
window.clearWrite = new Proxy({}, { get: (_, k) => {
  if (k === 'getState') return async () => S;
  if (k === 'onState') return (cb) => { setTimeout(() => cb(S), 10); return () => {}; };
  if (k === 'onAssistant') return (cb) => { setTimeout(() => cb(V), 10); return () => {}; };
  if (k === 'onCard') return (cb) => { setTimeout(() => cb({index:0, finding:V._f[0]}), 10); return () => {}; };
  if (k === 'onBadge') return (cb) => { setTimeout(() => cb({status:'issues', count:2}), 10); return () => {}; };
  if (typeof k === 'string' && k.startsWith('on')) return noop;
  return async () => S; } }); })();
""" % (json.dumps(STATE), json.dumps(VIEW))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=sys.argv[1] if len(sys.argv) > 1 else None, channel=None if len(sys.argv) > 1 else "chrome", args=["--allow-file-access-from-files"])
        shots=[("index",1280,860,[]),("index-general",1280,860,["[data-page=settings]"]),("index-writing",1280,860,["[data-page=settings]","[data-tab=writing]"]),("index-privacy",1280,860,["[data-page=settings]","[data-tab=privacy]"]),("index-ai",1280,860,["[data-page=settings]","[data-tab=ai]"]),("index-appearance",1280,860,["[data-page=settings]","[data-tab=appearance]"]),("index-about",1280,1100,["[data-page=settings]","[data-tab=about]"]),("index-narrow",700,860,[]),("index-history",1280,860,["[data-page=history]"]),("index-full",1280,1545,[]),("assistant",380,560,[]),("card",300,200,[]),("badge",60,60,[])]
        for scheme in ["light","dark"]:
          for name, w, h, clicks in shots:
            pg = await b.new_page(viewport={"width":w,"height":h}, color_scheme=scheme)
            await pg.add_init_script(STUB)
            pg.on("pageerror", lambda e: print("ERR", name, e))
            await pg.goto((ROOT / "public" / f"{name.split('-')[0]}.html").as_uri())
            await pg.wait_for_timeout(400)
            for c in clicks: await pg.click(c); await pg.wait_for_timeout(200)
            await pg.screenshot(path=str(WORK / f"{scheme}-{name}.png"), full_page=False)
        await b.close()
def publish():
    picks = [("light-index-full", "home-light", None), ("dark-index", "home-dark", None), ("dark-index-history", "history-dark", None),
             ("light-index-general", "settings-general-light", None), ("dark-index-appearance", "settings-appearance-dark", None), ("light-index-about", "settings-about-light", None),
             ("light-assistant", "panel-light", None), ("dark-assistant", "panel-dark", None),
             ("light-card", "suggestion-card-light", (0, 0, 300, 165)), ("dark-card", "suggestion-card-dark", (0, 0, 300, 165))]
    OUT.mkdir(parents=True, exist_ok=True)
    for source, name, box in picks:
        image = Image.open(WORK / f"{source}.png").convert("RGB")
        (image.crop(box) if box else image).save(OUT / f"{name}.png", optimize=True)
        print("wrote", OUT / f"{name}.png")

WORK.mkdir(parents=True, exist_ok=True)
asyncio.run(main())
publish()
