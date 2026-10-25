# Installing on your DSH Host

Use official `@deepseek-ai/dsh@0.2.1-alpha.2`, Node.js 24+, and a Host you manage.
No server address, SSH target, service unit or private data directory is built into this repo.

1. Build the client with `npm run build` in this directory, inspect the generated diff,
   and create an archive with `npm pack`. Record its source revision and SHA-256 privately.
2. Back up your profile and DSH_HOME, including the Cookie signing secret and account verifier.
   Protect the backup as credentials. Keep the existing workspace and Session data in place.
3. Install the archive with the official PluginManager, which reads `dsh.bundle.patch`, or
   install it in your Host application and append `bundle.patch.json` to your profile.
   Avoid registering the same plugin twice. See the [root guide](../../README.md).
4. Check the plugin's active state. If installation reports that a restart is required,
   restart the corresponding DSH Host in a maintenance window, with no running Sessions.
5. Reload the client and check login, settings, native bridge availability, Back ordering,
   and retained Session/draft state. Test 360/390/412 CSS px and actual Android WebView.

For an HTTPS read audit, explicitly set `B0_BASE=https://dsh.example.com` and either
`B0_CREDENTIAL_FILE` or `B0_COOKIE_FILE` to a private file, then run
`node plugins/mobile-ui/audit-public.mjs` from the repository root. Never commit or share
those files. This audit does not replace visual, device or notification-delivery checks.

To disable, use the official plugin manager or set the profile row to `disabled: true`.
To uninstall, remove only this plugin registration/package. Preserve all Host data and other
plugins. Refer to [UPGRADE.md](UPGRADE.md) for replacement and rollback.
