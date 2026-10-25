# Upgrade and rollback

Keep the Host pinned to DSH `0.2.1-alpha.2`. A DSH version change needs separate API,
slot, CSS and Android compatibility review.

Before replacing the plugin, record the installed package version, active plugin state,
profile and a known-good archive. Build and test the candidate, inspect its `npm pack`
contents, and record its SHA-256. Take a private recoverable Host checkpoint and wait until
Sessions are idle. Do not change model configuration or other plugin entries in the same step.

Install the candidate using official PluginManager or the local package/profile procedure
in [DEPLOYMENT.md](DEPLOYMENT.md). Inspect the returned application state; if a restart is
required, restart only the corresponding Host. Reload the client and verify the active
version, login, settings, Back, drawer, file viewer and notification settings. Preserve the
existing DSH_HOME, Cookie signing secret, account verifier, Sessions and workspace.

If installation fails, inspect current package/plugin state before retrying. A timeout does
not prove that nothing changed. Do not automatically overwrite an unfamiliar state. For a
reviewed rollback, reinstall the known-good archive and restore only its profile row if
needed, restart when required, and verify again. Do not restore an entire old data snapshot
as a routine code rollback; newer Sessions/files must survive.

Disable the mobile plugin independently through PluginManager or its profile row. Official
DSH remains available, but mobile presentation and its native settings/Back contribution
will be absent until re-enabled. Browser tests do not prove Android or production behavior.
