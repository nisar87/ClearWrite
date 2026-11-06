# Windows updater verification

Verified on 2026-11-06 on the maintainer's Windows x64 PC. This is not a
clean-machine/VM certification or a guarantee for every Windows security policy.

## Builds

- Bootstrap client: 0.2.0-beta.2, source e1747e6.
- Update target: 0.2.0-beta.3, source 26f8ae3.
- Same per-user installation and original custom directory across the update.
- Actual public GitHub Release feed, metadata, blockmap and installer were used.

## Results

- 106 existing tests plus 10 updater tests passed; syntax checks passed.
- Installed client correctly reported the current version before the next release.
- Automatic checks could be disabled in Settings.
- Older client discovered the newer release through GitHub.
- A real download was cancelled; retry downloaded and verified the installer.
- Declining installation left the app running and the verified download available.
- Approving installation replaced the installed version and restarted ClearWrite
  in the original custom installation directory.
- The normal Windows profile retained its AI mode/provider, dialect, personal
  dictionary and update preference. An encrypted synthetic test file survived and
  could still be decrypted by the updated application.
- Post-install offline correction passed. Temporary dictionary/test-file changes
  were removed and original preferences restored.
- Packaged smoke checks, dependency/privacy inventory checks and ZIP integrity
  checks passed. No provider credentials are included in the artifacts.

The test supplied both outcomes of the app's confirmation dialog inside its
test-owned process. It did not automate authentication, security dialogs or
another person's messages. Earlier harness revisions assumed that a process-only
data-folder environment override would survive the installer restart and that
the existing user's mode was Offline. Those were incorrect test assumptions:
NSIS restarted with the normal user profile and correctly retained its AI mode.
Final results were checked against installed version, restart logs, profile reads
and an independent post-install check, not inferred from a harness exit status.

## Remaining limitations

- Windows publisher/code signing is not configured. HTTPS and artifact checksums
  are not publisher authentication; signing needs an appropriate certificate.
- No power-loss/forced-shutdown test during actual installation was performed.
  Recovery may require running Setup manually. Download cancellation/failure is
  separate from interrupting a running installer.
- Full live-editor compatibility and ChatGPT sign-in/inference remain separate
  test matrices. Updater verification does not establish them.
- ZIP/source distributions remain manual-update only. Older clients without the
  updater need a one-time manual Setup upgrade.
