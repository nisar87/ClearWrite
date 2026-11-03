# Contributing

Thanks for helping improve ClearWrite. Please keep changes focused and preserve the principle that suggestions are reviewed before they are applied.

## Before Opening a Pull Request

- Run `npm run check` and `npm test`.
- Test monitoring with a writable field and a read-only view; focusing or reading text should not by itself trigger a suggestion.
- Do not include real emails, messages, API keys, OAuth data, screenshots with personal information, or contents of `data/`, `cache/`, or `.env` files.
- Preserve the Sign in with ChatGPT DevKit license and third-party notices. Its included license is noncommercial; see `SIWC-DEVKIT-LICENSE.txt`.
- Keep provider credentials in OS-backed secure storage. Never add credentials to source, logs, test fixtures, or issues.

By submitting a contribution, you agree that your contribution is offered under the project's MIT license, except for files or material explicitly covered by another license. The Sign in with ChatGPT DevKit retains its separate license.
