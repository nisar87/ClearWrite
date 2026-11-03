# ClearWrite

ClearWrite is a Windows desktop writing assistant. It offers automatic proofreading while you edit, plus a manual selection shortcut for grammar fixes, rewrites, and reply drafts.

## Features

- **Live writing monitor:** off by default. When enabled, it observes editable UI Automation value fields and waits for a detected text change and a short pause before requesting a suggestion. Read-only documents, password fields, and excluded apps are ignored.
- **Per-app controls:** use a blocklist, or enable an allowlist so only selected apps are monitored. The current focused app can be added from the Live writing page. Pause monitoring for one hour or until tomorrow from the app or tray.
- **Manual shortcut:** select text and press `Ctrl+Shift+Space` to open the assistant. The shortcut continues to work when live monitoring is paused.
- **Review before use:** see the original and suggested text, with changes highlighted. Copy a suggestion or apply it in supported single-line fields. Full-document controls are copy-only to avoid replacing an entire document unintentionally.
- **Multiple providers:** connect ChatGPT plan usage with Sign in with ChatGPT, or configure a Google Gemini API key in Settings.
- **Multi-monitor support:** the assistant opens on the display containing the selection and can be moved by dragging its header.

ClearWrite does not read surrounding Teams/email conversations to draft replies. To suggest a reply, select the relevant text and choose **Suggest a reply**.

## Requirements

- Windows 10 or 11
- Node.js 22.12 or later and npm
- A configured provider: eligible ChatGPT plan access through the DevKit, or a Gemini API key
- For ChatGPT plan integration, the official [Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit)

## Setup From Source

The DevKit's `@siwc/local` package is not published to npm. ClearWrite uses it as a local package, so clone both repositories side by side and build the SDK first:

```powershell
git clone https://github.com/nisar87/ClearWrite.git ClearWrite
git clone https://github.com/openai/sign-in-with-chatgpt-devkit.git WritingAssistantDevKit

cd WritingAssistantDevKit
npm ci
npm run build -w @siwc/local

cd ..\ClearWrite
npm ci
npm run check
npm test
npm start
```

The sibling folder must be named `WritingAssistantDevKit` because the local package reference in `package.json` points to `../WritingAssistantDevKit/packages/local`.

On first run, configure a provider in Settings. The default shortcut is `Ctrl+Shift+Space`. Automatic monitoring and Windows startup are opt-in. Use the Live writing page to pause or resume monitoring; configure additional excluded app process names in Settings.

You can also run `start-clearwrite.cmd` after installing dependencies; it sets local runtime data and Electron cache folders relative to the checkout.

## Privacy And Local Data

- By default, application data is stored in the project's ignored `data/` directory. Set `CLEARWRITE_DATA_DIR` to use another location.
- ChatGPT sign-in credentials are managed by the official DevKit and protected using Windows secure storage. ClearWrite does not store your ChatGPT password.
- Gemini API keys are encrypted with Electron's Windows secure storage.
- Live monitoring is disabled by default. When enabled, it sends the text of an editable field to the selected provider after a detected change and pause. UI Automation cannot always distinguish a person's keystrokes from an app changing an editable field, so exclude sensitive apps and keep monitoring paused when it is not needed. Manual actions send only the selected text and chosen action. Review each suggestion; ClearWrite never applies a live suggestion automatically.
- Automatic monitoring ignores password fields, read-only document controls, and by default ClearWrite, Command Prompt, PowerShell, Windows Terminal, and Registry Editor. Additional process names can be excluded in Settings.
- When the allowlist is enabled, ClearWrite compares the focused app's process name with the list before reading the field text. Non-allowed app text is not read or sent to a provider.
- ClearWrite does not keep a draft history. Provider processing and retention are governed by the provider's terms and settings.
- Keep `data/`, `cache/`, `.env` files, and local logs private. They are excluded by `.gitignore`; do not force-add them to a public repository.

## Compatibility Notes

The Windows monitor relies on UI Automation and works only with text fields that expose usable accessibility information. Some apps, remote sessions, protected/elevated windows, and custom editors may not expose text reliably. Manual selection uses the system clipboard and keyboard input, so apps that block clipboard access may not support replacement. In those cases, copy the suggestion and paste it yourself.

## Development

```powershell
npm run check
npm test
npm start
```

ClearWrite-authored source is licensed under MIT; see `LICENSE`. The separate Sign in with ChatGPT DevKit is under its own noncommercial license, included here as `SIWC-DEVKIT-LICENSE.txt`. MIT does not extend or replace that license, grant commercial rights to DevKit code, or grant access to OpenAI services or marks. Keep the DevKit license and third-party notices intact.
