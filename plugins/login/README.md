# B0 personal login plugin

This is an additive Host plugin for fixed official DSH `0.2.1-alpha.2`.
`POST /jarvis-auth` checks the private single-user password and calls the
official `connection.authenticatedUrl()` plus `authorizeIndex()` **inside the
Host** with a synthetic `GET /?token=…`. The request from the App is never
passed to `authorizeIndex()`, and the token never enters an App response.
Official DSH owns the 303, authority-bound Cookie, page, HTTP, WebSocket and
file access. `POST /jarvis-auth/password` admits an existing official Cookie,
checks the old password, then atomically replaces only the private password
verifier. No chat/Session/file protocol or model path changes.

The plugin reads `$DSH_HOME/jarvis-auth.json` (service owner, mode 0600).
The file contains a random 32-byte salt and a 64-byte `scrypt` verifier,
not a plaintext password. Requests are bounded to 4096 body bytes; unknown
and wrong accounts receive the same 401. Failed attempts are bounded by IP,
account and pair for 15 minutes. Login issuance and password changes share a
bounded four-request queue, so a successful old-password login cannot be
issued after a password change commits.
The app's selected authority must be in the plugin's candidate profile
`config.authorities`, and also in DSH's existing trusted hosts. The plugin uses
the official Connection Host/Origin fence; public requests require the HTTPS
proxy marker. Password login alone accepts an opaque `Origin: null` emitted by
some native WebView navigations after checking the fixed Host allowlist and the
official Host/Fetch-Site fence without that opaque marker. Explicit external
Origins and `Sec-Fetch-Site: cross-site` are rejected; password change keeps
the full official Origin/Cookie check. Replies use `Cache-Control:
no-store`; the plugin never logs bodies, passwords, token URLs or Cookies.

## Install and configure

Use this directory's `bundle.patch.json` in your DSH Web profile. Resolve the entry
`./index.mjs` to this plugin's absolute path and add `config.authorities`, for example
`["dsh.example.com"]` (include the port for a non-default HTTPS port). Configure the
same authority in DSH's own trusted hosts. See the [root installation guide](../../README.md).

Create a private DSH_HOME and a separate private delivery directory, then initialize
credentials as the service owner (or an administrator assigning that owner's UID/GID):

```sh
node plugins/login/provision.mjs /absolute/private/dsh-home/jarvis-auth.json \
  /absolute/private/delivery/initial-login.txt "$(id -u)" "$(id -g)"
```

The verifier and delivery file are mode 0600. Provisioning an existing verifier does
not reset it. Deliver the random initial credentials privately, then remove the delivery
file after the user has saved them. Do not pass passwords on the command line.
For public HTTPS, configure the reverse proxy to preserve HttpOnly/SameSite and add Secure
to the official Cookie; do not log token-bearing URLs or request bodies.

## Test

```sh
node --test plugins/login/*.test.mjs
node plugins/login/smoke-dsh.mjs
```

The HTTP behavior tests explicitly skip when the environment denies loopback listeners
(EPERM/EACCES); they do not treat that as a login behavior pass.

The optional smoke script requires the pinned official SDK installed at the repository
root, or `B0_DSH_APP` pointing to a separate SDK application directory. It starts an
isolated loopback Host with temporary DSH_HOME, workspace and fictional credentials;
it checks login, password change, HTTP/WS/file access and restart persistence without
sending a model prompt. It requires permission to listen on loopback. SDK/native bindings
must match the local platform; it is not Android or production verification.

## Upgrade and disable

Back up your private profile and DSH_HOME before changing code. Update only the plugin
entry, preserve the account verifier and DSH signing secret, then restart your Host and
verify login, existing Cookies and password change. Set the plugin row to `disabled: true`
or remove it to disable password login while leaving official DSH authentication intact.

`switch-profile.mjs` optionally switches a reviewed private profile atomically:
prepare `provider.patch.before` and `provider.patch.candidate` in a private staging directory,
then run `node plugins/login/switch-profile.mjs activate ABS_LIVE_PROFILE ABS_STAGE_DIR`.
Use `rollback` with the same paths to restore the prior profile. It refuses changed live
bytes; do not force an older profile over newer settings. Restart the corresponding DSH
service yourself after reviewing the switch.

Fixed DSH has no single-Cookie revocation API. A password change leaves already-issued
Cookies valid until their original expiry (up to 30 days). Rotating the DSH signing secret
invalidates all Cookies and is a separate operator action.
