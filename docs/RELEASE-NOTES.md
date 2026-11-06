# ClearWrite 0.2.0-beta.3

Windows x64 personal/noncommercial beta. Download the Setup EXE for normal
installation, or extract the entire ZIP and run ClearWrite.exe. Node.js/npm,
developer tools and separate dictionary downloads are not required.

## Included

- Setup-installed clients can check GitHub for updates automatically or manually,
  download after approval, and restart/install after confirmation. No forced
  updates, downgrades, AI-provider update calls, or automatic install-on-quit.
- Settings > Updates includes progress, cancellation, retry, a release-notes link,
  and an automatic-check preference. ZIP/source copies remain manual-update only.

- Offline English spelling/basic grammar with Harper, expanded spelling candidates
  and partial statistical context; no account needed.
- Optional Gemini and ChatGPT providers, with compiled ChatGPT DevKit dependencies.
- Capability-based editor detection, isolated UIA3 hosted-editor reader, bounded
  Scintilla fallback, and rejection of sliders/playback widgets as text editors.
- Personal dictionary, per-app controls, manual selection shortcut and writing panel.
- Installer/uninstaller, ZIP alternative, getting-started instructions and checksums.
- Packaged settings/credentials are stored per Windows user, not in install files.

## Important limitations

- Beta, unsigned publisher. Check the source and SHA256SUMS.txt; do not disable
  antivirus or company security policy to install.
- Windows 10/11 x64 required; standard Windows PowerShell 5.1 and .NET components
  must be available. ARM64 and 32-bit packages are not provided.
- ChatGPT plan usage requires an eligible Plus/Pro account, successful consent,
  account policy permission and available usage. A ChatGPT subscription alone is
  not a guarantee of access. Actual ChatGPT login/inference is not yet verified
  end-to-end for this release. Use your OWN account, never the developer's session.
- This package includes the ChatGPT DevKit under its NONCOMMERCIAL license. This
  does not permit employer/client/business operations merely because the app is
  free. Read SIWC-DEVKIT-LICENSE.txt. ClearWrite's MIT license does not override it.
- Unit tests and packaged smoke checks do not establish compatibility with every
  editor. A clean-machine installer/uninstaller and full live-app matrix remain
  outstanding; use the shortcut/copy fallback for unsupported editors.
- Version 0.2.0-beta.1 needs one manual Setup upgrade to receive the updater.
- Update download integrity uses GitHub HTTPS and SHA-512 metadata. Windows
  publisher signing still requires a certificate; this beta remains unsigned.

See GETTING-STARTED.md bundled beside ClearWrite.exe for setup, privacy and removal.
