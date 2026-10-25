// Read-only public B0 check. Never prints credentials, Cookies, Session IDs, or titles.
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';

const base = process.env.B0_BASE;
const credentialFile = process.env.B0_CREDENTIAL_FILE;
const cookieFile = process.env.B0_COOKIE_FILE;
if (!base || !(credentialFile || cookieFile) || !/^https:\/\/[^/]+$/.test(base)) {
  throw Error('Set B0_BASE to an HTTPS origin and one private credential or Cookie file');
}
const unauthorized = await fetch(`${base}/`, {redirect: 'manual', signal: AbortSignal.timeout(10000)});
let loginStatus = null;
let setCookie = '';
let cookie;
if (cookieFile) {
  cookie = readFileSync(cookieFile, 'utf8').trim();
} else {
  const credentials = Object.fromEntries(readFileSync(credentialFile, 'utf8').trim().split(/\r?\n/).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
  if (!credentials.username || !credentials.password) throw Error('Private credential file is incomplete');
  const login = await fetch(`${base}/jarvis-auth`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: {'content-type': 'application/x-www-form-urlencoded', origin: base},
    body: new URLSearchParams(credentials)
  });
  loginStatus = login.status;
  setCookie = login.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0];
  if (loginStatus !== 303 || !cookie) throw Error(`Login failed: HTTP ${loginStatus}`);
}
if (!cookie) throw Error('Private Cookie file is empty');
const page = await fetch(`${base}/`, {headers: {cookie}, signal: AbortSignal.timeout(10000)});
const pageHtml = await page.text();

async function rpc(method, args) {
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({type: 'client-request', rpcId: randomUUID(), method, payload: {args}})
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 200 || data?.result?.ok !== true) {
    throw Error(`${method} failed: HTTP ${response.status}, native ok=${data?.result?.ok}`);
  }
  return data.result.value;
}

const [bundles, plugins, sessionPage] = await Promise.all([
  rpc('pluginManager/listBundles', {}),
  rpc('pluginManager/listPlugins', {}),
  rpc('session/list', {_request: {}})
]);
const sessions = sessionPage.items;
if (!Array.isArray(bundles) || !Array.isArray(plugins) || !Array.isArray(sessions)) {
  throw Error('Unexpected native response shape');
}
const mobile = plugins.find(item => item.moduleName === '@jarvis/b0-mobile-ui');
// DSH serves Client modules in grouped graph URLs declared by the authenticated page.
const graph = [...pageHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(match => match[1].replaceAll('&amp;', '&'))
  .find(path => path.startsWith('plugins/??') && path.includes('@jarvis/b0-mobile-ui/client.js'));
const client = mobile && graph && await fetch(new URL(graph, `${base}/`), {
  headers: {cookie}, signal: AbortSignal.timeout(10000)
});
const clientBody = client ? await client.text() : '';
const mobileClientVersion = clientBody.match(/jarvisB0Mobile\s*=\s*['"](0\.1\.\d+(?:-[a-z0-9-]+)?)['"]/)?.[1] ?? null;
const expectedMobileVersion = process.env.B0_EXPECT_MOBILE_VERSION ?? '0.1.12-back-drawer';
if (expectedMobileVersion && !/^0\.1\.\d+(?:-[a-z0-9-]+)?$/.test(expectedMobileVersion)) {
  throw Error('B0_EXPECT_MOBILE_VERSION must be a mobile plugin version');
}
console.log(JSON.stringify({
  unauthenticatedStatus: unauthorized.status,
  loginStatus,
  cookieFlags: cookieFile ? null : {
    secure: /;\s*Secure/i.test(setCookie),
    httpOnly: /;\s*HttpOnly/i.test(setCookie),
    sameSiteStrict: /;\s*SameSite=Strict/i.test(setCookie)
  },
  authenticatedPageStatus: page.status,
  bundleVersions: [...new Set(bundles.map(item => item.version))],
  jarvisBundles: bundles.filter(item => item.name?.startsWith('@jarvis/')).map(item => ({
    name: item.name, version: item.version, enabled: item.enabled, installed: item.installed
  })),
  jarvisPlugins: plugins.filter(item => item.moduleName?.startsWith('@jarvis/')).map(item => ({
    name: item.moduleName, enabled: item.enabled, fiberPhase: item.fiberPhase
  })),
  sessions: {count: sessions.length, running: sessions.filter(item => item.running).length,
    blank: sessions.filter(item => item.blank).length},
  mobileClientStatus: client?.status ?? null,
  mobileClientBytes: client ? Buffer.byteLength(clientBody) : null,
  mobileClientSha256: client ? createHash('sha256').update(clientBody).digest('hex') : null,
  mobileClientVersionMarker: mobileClientVersion !== null,
  mobileClientVersion,
  expectedMobileVersion,
  mobileClientVersionMatchesExpected: expectedMobileVersion ? mobileClientVersion === expectedMobileVersion : null
}));
if (expectedMobileVersion && mobileClientVersion !== expectedMobileVersion) process.exitCode = 1;
