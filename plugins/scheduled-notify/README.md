# Scheduled notifications

Optional Host plugin `dsh-mobile-scheduled-notify`, package `@dsh-mobile/scheduled-notify`,
for official DSH **0.2.1-alpha.2**. Provides the Cordis `mobileSchedule` service and
three Cookie-authenticated HTTP routes. This plugin aggregates provider data; Android schedules
local notifications. It does not push through the session stream, run timers for business entries,
or store provider data. See the authoritative [contract](../../contracts/scheduled-notify.md).

## Install / disable

From this directory run `npm pack`, then install the archive in your own Host application:

```sh
npm install --save-exact @deepseek-ai/dsh@0.2.1-alpha.2
npm install /absolute/path/to/dsh-mobile-scheduled-notify-0.1.0.tgz
npx --no-install dsh web --patch /absolute/private/mobile.patch.json --no-open
```

Merge this directory's `bundle.patch.json` into that private patch; retain your other profile entries.
The same patch is advertised in `package.json` at `dsh.bundle.patch` for PluginManager.
No plugin-specific config or persistence directory is required. HTTP routes are mounted only while
the optional `connection` service exists. DSH's admission and trusted Host configuration remain
responsible for authentication; the action route additionally requires an exact same-origin Origin.

Disable the profile row (`disabled: true`), remove it from your patch, or disable the package in
PluginManager, then restart the Host. Routes and service disappear; dependent provider injections
are disposed. Android retains the last usable local schedule when a route is unavailable, just as
on other sync failures. To authoritatively cancel entries before disabling, have providers return
empty lists and allow clients to sync first. Logout or switching Host also clears local schedules.

## Provider integration

```js
ctx.inject(['mobileSchedule'], exact => exact.effect(() => exact.mobileSchedule.register({
  id: 'example',
  async list({from, to, signal}) {
    return {items: [], daily: []};
  },
  async action({key, action, signal}) {
    // Apply idempotently; throw an error with code NOT_FOUND or NOT_ACTIVE as appropriate.
    return {status: 'done'};
  },
  async content({key, date, signal}) {
    return {shouldNotify: false, title: '', text: '', open: null};
  },
})));
```

Provider IDs and local keys follow the contract. `register()` rejects invalid providers and duplicate
IDs and returns an idempotent unregister function. Providers may additionally supply `dispose()` for
owned resources; unregister or service disposal calls it once and aborts in-flight requests.
Respect `signal`; every provider call has a 3-second deadline, even if it ignores cancellation.
Any list failure, invalid output or timeout fails the entire snapshot with 503. A partial list would
incorrectly cancel another provider's alarms. No providers is a valid empty snapshot.

Every exposed key is prefixed `<id>/<key>`; action/content calls strip the prefix before invoking the
provider. Items are filtered inclusively to the requested window, sorted by timestamp and key;
daily entries are sorted by key. Timestamp output is normalized to UTC. The version is the SHA256
of canonical JSON of `{items, daily}`, recursively sorting object keys. Providers must change a key
when any item's contents change; delivery tombstones are permanent for that Host until logout/reset.

All responses have `cache-control: no-store` and the contract envelope. Query defaults are now and
seven days later, with a maximum fourteen-day span. Unknown/repeated query parameters, malformed
fields and invalid dates produce 400 `CONTRACT_MISMATCH`. Error codes explicitly defined by the
contract are `NOT_FOUND` (404), `NOT_ACTIVE` (409), and `CONTRACT_MISMATCH` (400). For statuses whose
code spelling is unspecified there, this implementation uses `UNAUTHORIZED` (401), `FORBIDDEN` (403),
and `UNAVAILABLE` (503); provider exception text is never exposed.

## Optional page integration

```js
(window.__DSH_MOBILE_OPEN__ ??= {}).example = open => {
  // Interpret the provider's opaque string and navigate when ready.
  return true;
};
// After changing provider data:
window.DshMobile?.scheduleChanged?.();
```

The Android shell invokes the page hook only on the selected Host origin after login and page readiness.
Return true only after handling the target; false/undefined is retried for about 30 seconds.
A null `open` opens the App without invoking a hook. The bridge only accepts the selected Host's
main frame, over `DshMobileSchedule`. Notification settings belong to each provider's page.

## Tests

Run `npm test` at repository root. Dependency-free tests exercise module APIs and fake Connection/DI
boundaries, including registration/disposal, canonical versions, validation, complete snapshots,
provider timeouts, aborts, admission, origin checks and routing. Real Cordis/Connection integration
tests skip with a reason if the pinned SDK is unavailable; they do not start a network listener.
Node tests do not validate a running Host deployment or Android delivery.
