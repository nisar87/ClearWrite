# Third-party notices

ClearWrite's own source code is licensed under the MIT License (see `LICENSE`). ClearWrite depends on the third-party software below, installed by npm from its original publishers. Each component remains under its own license; the full license texts are installed with each package in `node_modules/<package>/`. Keep those files and this notice when redistributing ClearWrite.

## Harper (`harper.js`)

- Version: 3.0.0 (see `package-lock.json`)
- Copyright: Automattic and Harper contributors
- License: Apache License 2.0. Full text in `node_modules/harper.js/LICENSE`, and at https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/automattic/harper
- Use in ClearWrite: the on-device English spelling and grammar checker used by Offline only mode and as the fallback in AI-assisted mode. Harper's built-in English dictionary is part of this package and is used unmodified. ClearWrite does not copy, extract, or redistribute dictionary data separately.

## Windows UI Automation COM Interop

- Component: Interop.UIAutomationClient 10.19041.0, by Roman/Roemer, https://github.com/Roemer/UIAutomation-Interop.
- License: MIT, retained in `assets/windows/UIAUTOMATION-LICENSE.txt`.
- The unmodified .NET Framework interop assembly (about 151 KB) is bundled at `assets/windows/Interop.UIAutomationClient.dll`. Its NuGet source, version, package hash and assembly hash are recorded in `assets/windows/manifest.json`.
- Used only by the hidden, local UIA3 reader process for hosted editors. Runtime does not download this library or transmit text to its publisher. `scripts/fetch-uia-interop.ps1` is an explicit developer-only restore tool and validates pinned hashes.

## Electron Runtime

- License: MIT. Full text in `node_modules/electron/LICENSE`
- Source: https://github.com/electron/electron
- Electron bundles Chromium and other components under their own licenses, listed in `node_modules/electron/dist/LICENSES.chromium.html`.

## Offline spelling candidates and statistical context

- Mnemonist 0.40.7 (MIT), copyright Guillaume Plique and contributors: https://github.com/Yomguithereal/mnemonist. ClearWrite uses its SymSpell index. Full license in `node_modules/mnemonist/LICENSE.txt`; retain its dependency licenses as well.
- `assets/offline/english.json.gz` is a filtered, compressed adaptation of Wolf Garbe's SymSpell English unigram and bigram frequency dictionaries. Sources, pinned revision, checksums, and retained entry counts are in `assets/offline/manifest.json`. Source: https://github.com/wolfgarbe/SymSpell.
- SymSpell describes its word frequencies as Google Books Ngram data intersected with SCOWL vocabulary. Attribution: Google Books Ngram datasets, Google and contributing libraries; SCOWL (Spell Checker Oriented Word Lists), Kevin Atkinson and component contributors; SymSpell dictionary compilation, Wolf Garbe and contributors.
- Google Books Ngram data: Creative Commons Attribution 3.0 Unported, https://creativecommons.org/licenses/by/3.0/. License text is retained in `assets/offline/CC-BY-3.0.txt`.
- SCOWL and component notices: retained in full in `assets/offline/SCOWL-Copyright.txt`. SymSpell's MIT notice: `assets/offline/SYMSPELL-LICENSE.txt`.
- Modifications by ClearWrite: retain 30,000 frequent ASCII words of 2-24 letters, retain word pairs whose words are in that vocabulary and count is at least 50, and gzip the resulting JSON. No endorsement by the data creators is implied. Keep the model, manifest, attribution and license files together when redistributing.
- Model rebuilding explicitly downloads upstream data during development only. Runtime proofreading never downloads data or sends user text to these sources.

## Other npm dependencies

Other packages pulled in by Electron and Harper (for example `fflate`, `@electron/get`, `semver`, `debug`) are listed with their licenses in `package-lock.json` and keep their license files in `node_modules/`.

## Optional: Sign in with ChatGPT DevKit (`@siwc/local`)

Only used for the optional ChatGPT provider. It is not published to npm and is not installed unless you build it next to ClearWrite (see README). It is covered by its own noncommercial license, included as `SIWC-DEVKIT-LICENSE.txt`. The MIT License does not extend or replace it.

## Personal dictionary

Your personal dictionary contains only words you add. It is stored in your app-data folder (`%APPDATA%\ClearWrite\personal-dictionary.json`), not in this repository, and is never redistributed.
