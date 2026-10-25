import {mkdir, readFile, open, rename, rm} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const defaults = Object.freeze({enabled: true, notifyReplies: true, lockScreenContent: true});
export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !Object.hasOwn(defaults, key) || typeof value[key] !== 'boolean'))
    throw new TypeError('Invalid notification settings');
  return value;
}
export async function createSettingsStore(directory, {fs = {mkdir, readFile, open, rename, rm}} = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new TypeError('Absolute notification directory required');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const path = join(directory, 'settings.json');
  let value = {...defaults}, tail = Promise.resolve();
  try { value = {...defaults, ...validateSettings(JSON.parse(await fs.readFile(path, 'utf8')))}; }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read notification settings'); }
  return {
    read: () => ({...value}),
    update(patch) {
      const checked = {...validateSettings(patch)};
      const operation = tail.then(async () => {
        const next = {...value, ...checked}, temporary = join(directory, `.settings-${randomUUID()}.tmp`);
        let file;
        try {
          file = await fs.open(temporary, 'wx', 0o600);
          await file.writeFile(JSON.stringify(next) + '\n');
          await file.sync(); await file.close(); file = null;
          await fs.rename(temporary, path);
          value = next;
          return {...value};
        } finally {
          await file?.close();
          await fs.rm(temporary, {force: true});
        }
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
