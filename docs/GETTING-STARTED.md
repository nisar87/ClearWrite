# ClearWrite for Windows

## Install

Use Windows 10/11, 64-bit Intel/AMD (x64). ARM64 and 32-bit builds are not provided.
Run the Setup-x64.exe download, choose a folder, and open ClearWrite
from the desktop or Start menu. No administrator account, Node.js, npm, Git,
Python, Java, browser extension, or separate dictionary download is required.

Alternatively, extract the ENTIRE Windows-x64 ZIP into a writable folder and
run ClearWrite.exe. Do not move just the EXE or run it inside the ZIP.
The ZIP needs no installation but stores settings on this Windows account,
not on the USB drive. Keep roughly 1 GB free for installation/extraction.

Windows PowerShell 5.1, .NET Framework and Windows accessibility components
normally included with Windows 10/11 are required. Organisation security
policies may block PowerShell helpers or accessibility access. Do not disable
antivirus or organisational protections to run this application.

This beta is unsigned. Windows may show an unknown-publisher warning. Obtain
it only from https://github.com/nisar87/ClearWrite/releases and compare the
SHA-256 checksum with SHA256SUMS.txt. Do not ignore an antivirus detection.

## Start writing

1. Offline only is the default; no account or internet is required for checking.
2. Turn on the "Checking" switch at the top of the ClearWrite window and type in an editable text field.
3. Review the writing panel's suggestions. Copy them or use Apply where supported.
4. Alternatively select text and press Ctrl+Shift+Space.
5. Closing the main window leaves ClearWrite in the tray. Use Quit there to exit.

English spelling and basic grammar are supported offline. Choose your English
dialect in Settings. Offline checking is not exhaustive or AI-level understanding.
Use the shortcut when an editor does not expose its text. Some editors are
copy-only, and elevated/remote/protected windows may not work automatically.

## Optional ChatGPT

The ChatGPT component is included; no DevKit installation is required.
Choose ChatGPT in Settings, click Continue with ChatGPT, sign in using YOUR
account in the browser and authorise plan usage. Then select a returned model
and choose AI-assisted on the Home page.

An eligible ChatGPT Plus/Pro account and internet access are required for this
plan-based integration. Having a free ChatGPT account alone is not sufficient.
Account/workspace restrictions and usage limits can prevent access. Sign-in is
not a guarantee of inference access. No separate API key is required for an
eligible, successfully authorised plan-based connection.

Official requirements: https://developers.openai.com/siwc/quickstart
If access is denied by your organisation, contact its administrator or use
Offline only/Gemini. ClearWrite cannot bypass account restrictions.

The bundled ChatGPT DevKit is NONCOMMERCIAL ONLY. This includes restrictions
on employer/client/business-related use even when the application is free.
Read SIWC-DEVKIT-LICENSE.txt before using it. ClearWrite's MIT license does not
override that component's license. This distribution is for personal,
noncommercial use; obtain appropriate permissions before business deployment.

Alternatively, choose Gemini, save your own Gemini API key, verify it, then
enable AI-assisted. Provider billing and limits are separate.

## Updates

Setup-installed copies check GitHub 20 seconds after startup and every six hours.
Settings > Updates has a manual check and an automatic-check toggle. Updates are
separate from AI/offline proofreading; GitHub receives normal network metadata,
never your writing, personal dictionary or AI credentials.

Choose Download update when notified. Once downloaded and checksum-verified,
choose Restart and install and confirm. No update installs simply because you
quit. Settings, provider credentials and the personal dictionary are retained.
If a download fails or you cancel, retry later. The app is not uninstalled merely
to start downloading. Interrupting the actual installation may require manually
running Setup again. ZIP/source copies must still be updated manually.

Beta versions receive beta-channel releases; stable versions check stable
releases. Downgrades are disabled. This beta is unsigned; checksum verification
over GitHub HTTPS is not equivalent to publisher signing. Publisher certificates
are not bundled, and no GitHub token is shipped in the application.

## Privacy and removal

Monitoring and AI are off initially. Offline checking stays on the device.
AI-assisted sends eligible text to the selected provider after you pause.
Do not enable monitoring for sensitive apps; configure exclusions or an allowlist.
ClearWrite does not send messages or automatically apply suggestions.

Installed/ZIP copies store settings, encrypted provider credentials, logs, and
the personal dictionary in %APPDATA%\ClearWrite. CLEARWRITE_DATA_DIR overrides
the settings/credential folder; CLEARWRITE_DICTIONARY_DIR overrides the dictionary.
Never share those folders. Each person signs in independently.

Uninstall through Windows Settings > Apps, or delete the extracted ZIP folder
after quitting. User data is retained. To remove it permanently, disconnect
providers first, quit ClearWrite and remove %APPDATA%\ClearWrite yourself.

This is a beta: packaged startup/offline checks do not prove every third-party
editor works, and ChatGPT sign-in/inference still needs a real account test.
