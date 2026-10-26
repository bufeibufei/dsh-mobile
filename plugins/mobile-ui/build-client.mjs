import {readFile, writeFile} from 'node:fs/promises';
const base = new URL('.', import.meta.url);
const [template, css, notify, mainSession] = await Promise.all([
  readFile(new URL('client.template.js', base), 'utf8'),
  readFile(new URL('mobile.css', base), 'utf8'),
  readFile(new URL('session-notify.mjs', base), 'utf8'),
  readFile(new URL('main-session.mjs', base), 'utf8')
]);
if (!template.includes('__JARVIS_MOBILE_CSS__')) throw Error('Missing CSS placeholder');
if (!template.includes('__JARVIS_SESSION_NOTIFY__')) throw Error('Missing notification placeholder');
if (!template.includes('__JARVIS_MAIN_SESSION__')) throw Error('Missing main session placeholder');
await writeFile(new URL('client.js', base), template
  .replace('__JARVIS_MOBILE_CSS__', () => JSON.stringify(css))
  .replace('__JARVIS_SESSION_NOTIFY__', () => notify.replace(/^export /gm, ''))
  .replace('__JARVIS_MAIN_SESSION__', () => mainSession.replace(/^export /gm, '')));
