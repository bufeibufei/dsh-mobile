# Mobile Web Client extension

Client plugin for official DSH `0.2.1-alpha.2`. It uses native slots and layout actions,
keeping official Session, model, trajectory, usage, file and authentication behavior.

At widths up to 700 CSS px, the native left sidebar becomes a 288px overlay. The header
menu opens it; selecting a Session closes it without intercepting row actions. The native
preset chip remains visible. Touch layouts expose row/tool/JSON actions and usable menu
targets; selection rules preserve editable and message text. Desktop layout remains native.

The mobile Settings root puts `Jarvis` first (servers, connection/file feedback, account,
and Notifications when available), followed by `DSH` (General, Models, Built-in plugins,
Agent presets). Each DSH entry opens its original control panel. Detail Back restores the
root's scroll and focus; closing and reopening starts at the root. The three native entries
send only `servers`, `connection`, or `account` through `window.JarvisB0Settings.postMessage`
on user clicks. Without Android's listener, an unavailable message is shown.

## Back and optional integrations

Since `0.1.15-image-button`, an `添加图片` button occupies the official
`conversation.input.left` list slot at widths ≤ 700 CSS px; desktop renders nothing.
It also works with old APKs, where it simply opens the old file chooser. Android
chooses the picker; this button sends no native bridge message.

The slot has no owner props: its session-scoped standard props supply `sessionId`,
`useSession`, `useInput`, `inputActions` and other registered session hooks.
The button uses that `sessionId`, leaving the permission/plan slots intact.
In pinned DSH `0.2.1-alpha.2`, `conversation.input` is the official `InputHub`
instance. Its `canPickFiles(sessionId)` and `pickFiles(sessionId)` methods are the
same methods used by the official `file` contribution. `commandUi` has no public
contribution lookup/invoke API (its dispatch and registry are private), so the
button calls these runtime service methods directly, without a DOM fallback.
Compatibility caveat: the published `SessionInputResolver` interface omits these
runtime methods; recheck them on any future SDK upgrade. Missing methods disable
the button. The input/session hooks trigger availability checks after effects;
file intake has no dedicated observable, so document focus/pointerdown also
rechecks it, including while disabled. Every click checks availability again.

Icon audit: alpha.2 exports no `IconImage*`, `IconPicture*` or `IconPhoto*`.
The available picture candidate is `FileTypeIcon` with `kind="image"` (also
selected by an image filename via `path`). We use `kind="image"`, size 14,
the official InputBar `uV2eYG_add` class and a monochrome color override to match
the neighbouring plus button. These packaged styles are also upgrade checks.

`window.__JARVIS_B0_MOBILE__.back()` synchronously handles one visible layer: popups,
modals/Settings, the open drawer, active main-panel details/list, then the right sidebar.
It never opens the drawer. With no remaining layer on chat/new-session home it returns
false for Android to continue its own Back behavior. Opening Settings closes the drawer.

The optional `window.__JARVIS_B0_LIFE__?.back()` hook delegates to an externally installed
life client when applicable. This repository does not include that client or its server;
the hook is inert when absent. Its behavior fixture tests only the optional callback.

Version `0.1.13-main-session` also retains `main-session.mjs` as an optional Jarvis
integration; this repository does not provide its server. A top-level `Jarvis` sidebar
entry appears on desktop and mobile only after `GET /api/jarvis-main/session` returns
HTTP 200 with `{ok: true, value: {sessionId: null}}` or a string `sessionId`. An absent,
unavailable or invalid API response leaves the entry hidden.

Since `0.1.14-jarvis-entry` the entry uses the official `IconSparkleRegular` at the
size the sidebar passes, so it lines up with the built-in panel entries. Because the
entry is the main session's permanent home, its row is hidden from the session tree by
the stable `data-row-key="session:<id>"` attribute (from `GET /session`, or from
`ensure` when the session is created later). The official tree only hides archived
sessions, and archiving would make the Host rebuild the main session. Search results
and the Host's data are unchanged. When the main session is the only ungrouped session,
the empty `Ungrouped` header still shows, because a collapsed group renders no members.

Opening the entry POSTs `{}` to `/api/jarvis-main/ensure`, requiring HTTP 200 with
`{ok: true, value: {sessionId: "..."}}` and a nonblank, trimmed ID. It waits up to
10 seconds for that ID in the official session catalog before calling `openSession`;
the waiting panel is blank. Failure shows “暂时无法打开主会话” and a “重试” button,
with no automatic retry. Requests use same-origin credentials and bypass caches.
Unmount aborts pending work and prevents late navigation. Neither optional integration
is required to use the standalone DSH shell and plugins.

The session-notify settings contribution uses official settings registration and Switch
controls. It appears only after a valid authenticated settings GET; absent plugin/404 hides
it. Viewing updates use official Session and panel state, visibility changes and a 45-second
refresh. Writes are serialized, bounded and aborted on disposal. Successful settings saves
notify the Android bridge without sending credentials or arbitrary commands. Notification taps
can use `openSession(id)` to validate the official catalog and navigate to an existing Session.
See the [notification contract](../../contracts/session-notify.md).

## Build, install and disable

`build-client.mjs` embeds `mobile.css`, `session-notify.mjs` and `main-session.mjs` into `client.template.js`
to produce the checked-in `client.js`:

```sh
cd plugins/mobile-ui
npm run build
npm pack
```

Review the generated diff. Install the local archive in your DSH Host and apply its
`bundle.patch.json`; see the [root guide](../../README.md). The plugin can be disabled
independently. Keep private Host data out of archives. Generic deployment and upgrade
procedures: [DEPLOYMENT](DEPLOYMENT.md), [UPGRADE](UPGRADE.md).

## Tests

From the repository root, run `node --test plugins/mobile-ui/*.test.mjs`. The checked-in
DOM fixture exercises actual generated-client behavior; it is not a browser renderer.
Real official Switch tests require the pinned SDK and `esbuild`, and skip with a reason
when missing. CSS checks do not establish WebView rendering quality.

Optional Playwright scripts require `B0_PLAYWRIGHT_MODULE` (or locally installed
`playwright`), a browser, and optionally `B0_CHROMIUM_EXECUTABLE`:

- `smoke-settings-hierarchy.mjs`: fictional settings DOM at 360/390/412 CSS px; no Host.
- `smoke-navigation.mjs`: isolated official Host with fictional login, no model prompt;
  SDK at repository root or `B0_DSH_APP`. Requires local loopback listeners.
- `smoke-settings-real-dsh.mjs`: caller-provided loopback Host via `B0_ISOLATED_BASE` and
  private Playwright `B0_ISOLATED_STORAGE_STATE`; uses an already authenticated test profile.
- `audit-public.mjs`: operator-selected HTTPS Host using `B0_BASE` and a private
  `B0_CREDENTIAL_FILE` or `B0_COOKIE_FILE`; optional `B0_EXPECT_MOBILE_VERSION`.
  It performs authenticated read checks and does not send a model prompt.

Browser, Host, HTTPS and Android device checks are separate verification layers. Run
optional scripts only against an isolated or explicitly authorized Host.

Version `0.1.16-composer-menu` separates the narrow-screen plus menu from the
keyboard: pointer/click capture suppresses alpha.2 InputBar focus handlers, and
uses the existing input trigger controller with the current draft revision and
caret span. A second click, outside tap or Back dismisses the menu. No focus,
blur, draft write or file-picker action is triggered by toggling. This relies on
alpha.2's `uV2eYG_add[aria-haspopup="listbox"]` and InputHub `shell` /
`inputTriggers` methods; recheck both on an SDK upgrade.
