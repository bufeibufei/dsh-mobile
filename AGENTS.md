# Collaboration

- Keep changes and PRs small and focused; use `codex/<task>` branches for new work unless the user specifies otherwise.
- Keep official DSH pinned to `0.2.1-alpha.2`. Preserve plugin IDs, package names, Android applicationId and Kotlin packages for compatibility.
- Test observable behavior through module APIs or rendered components; do not test sliced source text.
- Keep credentials, signing keys, private paths, host data and deployment evidence out of Git.
- Regenerate `plugins/mobile-ui/client.js` with its build script after changing the template, CSS or embedded modules; review the generated diff.
- Report exact commands and pass/fail/skip counts. Distinguish unit tests, builds, browser checks and device/Host verification.
- Do not modify another checkout, commit, push or deploy unless the user asks.
