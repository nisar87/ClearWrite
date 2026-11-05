# Releasing ClearWrite

## Prerequisites for maintainers

- Windows x64, Node.js >=22.12, npm, Git. GitHub CLI for publishing.
- Install locked dependencies using npm ci.
- Build the sibling official WritingAssistantDevKit/packages/local package first
  (README). The current release was prepared with DevKit revision
  0a36fefeb913055c8c7a1a29b63d82b96b2e841a. Retain its dist license/notices.
- Building downloads NSIS/build tools. Recipients do NOT need these tools.
- Set npm_config_cache and ELECTRON_BUILDER_CACHE to a drive with free space.

## Build and verify

1. Run npm run check and npm test on Windows.
2. Commit the intended release source. Run npm run dist:win.
3. Inspect release/win-unpacked/resources/app/build-manifest.json. Check source
   revision, dirty flag and exact bundled package versions. No user files belong
   in resources/app. PS/C# helpers stay unpacked because Windows loads them by path.
4. Launch release/win-unpacked/ClearWrite.exe --distribution-smoke with a fresh
   CLEARWRITE_DATA_DIR. Read distribution-smoke.json there. It tests hidden HTML
   windows/preload, offline WASM/context correction, ChatGPT imports and encryption,
   and helper compilation. It does NOT sign in or test real provider inference.
5. On a clean Windows account/VM, test install, launch, tray, shortcut, monitoring,
   uninstall, and each optional provider with that user's account. This manual
   matrix is required before calling a build stable; unit tests alone do not prove it.
6. Publish the installer, ZIP and SHA256SUMS.txt as a GitHub prerelease. Describe
   untested scenarios, unsigned publisher status, and DevKit noncommercial limits.

The installer is per-user, supports a custom directory and adds shortcuts.
No self-update service or background task is installed. Download the next release
manually. Settings survive uninstall/upgrades. ZIP copies use the same per-user
settings unless an explicit data-folder environment override is set.

## Distribution boundary

Only src (excluding tests/fixture), public, assets, licenses and resolved runtime
packages enter the app. The DevKit's compiled dist and package metadata are copied,
not its checkout or sessions. Electron is a build dependency, not copied inside
the application node_modules. Every runtime package retains its licenses.

This beta ships the NONCOMMERCIAL ChatGPT DevKit. Do not advertise it as a
business-use-compatible MIT-only binary. An unrestricted business distribution
would need a separate DevKit permission or a build without that component.

Never upload release/staging-* directories or development data. Release artifacts
belong in GitHub Releases, not Git history. Never share your data or dictionary.
