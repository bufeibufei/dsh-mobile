import {createHash} from 'node:crypto';

const providerId = /^[a-z][a-z0-9-]{0,31}$/;
const localKey = /^[A-Za-z0-9._:-]{1,128}$/;
const actionId = /^[a-z][a-z0-9-]{0,15}$/;
export class ScheduleError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const invalid = () => { throw new ScheduleError('CONTRACT_MISMATCH', 400); };
const requireValue = value => { if (!value) invalid(); };
export function fields(value, names) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}
const string = value => typeof value === 'string';
const open = value => value === null || string(value) && [...value].length <= 256;
export function instant(value) {
  requireValue(string(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value));
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms) && validDate(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60);
  return ms;
}
export function validDate(date) {
  return string(date) && /^\d{4}-\d\d-\d\d$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function splitKey(key) {
  requireValue(string(key));
  const parts = key.split('/');
  requireValue(parts.length === 2 && providerId.test(parts[0]) && localKey.test(parts[1]));
  return parts;
}
export function validateAction(action) { requireValue(string(action) && actionId.test(action)); }
// A provider may report the date its summary is for; the shell drops a mismatch.
function content(value, date) {
  fields(value, Object.hasOwn(value ?? {}, 'date') ? ['date', 'shouldNotify', 'title', 'text', 'open'] :
    ['shouldNotify', 'title', 'text', 'open']);
  requireValue(typeof value.shouldNotify === 'boolean' && string(value.title) && string(value.text) && open(value.open));
  const reported = value.date ?? date;
  requireValue(validDate(reported));
  return {...value, date: reported};
}
function list(value, id, from, to) {
  fields(value, ['items', 'daily']);
  requireValue(Array.isArray(value.items) && Array.isArray(value.daily));
  const seen = new Set();
  const key = value => {
    requireValue(string(value) && localKey.test(value) && !seen.has(value));
    seen.add(value); return `${id}/${value}`;
  };
  const items = value.items.map(item => {
    fields(item, ['key', 'at', 'title', 'text', 'open', 'actions', 'snooze']);
    const at = instant(item.at);
    requireValue(string(item.title) && string(item.text) && open(item.open) && typeof item.snooze === 'boolean' &&
      Array.isArray(item.actions) && item.actions.length <= 2);
    const actions = new Set();
    for (const a of item.actions) {
      fields(a, ['id', 'label']); validateAction(a.id);
      requireValue(!actions.has(a.id) && string(a.label) && [...a.label].length > 0 && [...a.label].length <= 8);
      actions.add(a.id);
    }
    return {...item, key: key(item.key), at: new Date(at).toISOString()};
  }).filter(item => Date.parse(item.at) >= from && Date.parse(item.at) <= to);
  const daily = value.daily.map(item => {
    fields(item, ['key', 'time', 'timezone']);
    requireValue(string(item.time) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time) && string(item.timezone));
    new Intl.DateTimeFormat('en', {timeZone: item.timezone});
    return {...item, key: key(item.key)};
  });
  return {items, daily};
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function createRegistry({timeout = 3000} = {}) {
  const providers = new Map();
  let closed = false;
  function register(provider) {
    if (closed || !provider || typeof provider.id !== 'string' || !providerId.test(provider.id) ||
      !['list', 'action', 'content'].every(method => typeof provider[method] === 'function') ||
      provider.dispose !== undefined && typeof provider.dispose !== 'function') throw new TypeError('Invalid schedule provider');
    if (providers.has(provider.id)) throw new Error('Duplicate schedule provider id');
    const entry = {provider, controller: new AbortController()};
    providers.set(provider.id, entry);
    return () => {
      if (providers.get(provider.id) !== entry) return;
      providers.delete(provider.id); entry.controller.abort(); provider.dispose?.();
    };
  }
  async function call(entry, method, args, signal) {
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, entry.controller.signal, ...(signal ? [signal] : [])]);
    let timer, abort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => { combined.throwIfAborted(); return entry.provider[method]({...args, signal: combined}); }),
        new Promise((_, reject) => {
          abort = () => reject(new ScheduleError('UNAVAILABLE', 503));
          combined.addEventListener('abort', abort, {once: true});
          if (combined.aborted) abort();
          timer = setTimeout(() => controller.abort(), timeout);
        }),
      ]);
    } catch (error) {
      if (method !== 'list' && ['NOT_FOUND', 'NOT_ACTIVE'].includes(error.code))
        throw new ScheduleError(error.code, error.code === 'NOT_FOUND' ? 404 : 409);
      throw new ScheduleError('UNAVAILABLE', 503);
    } finally { clearTimeout(timer); combined.removeEventListener('abort', abort); }
  }
  function find(key) {
    const [id, local] = splitKey(key), entry = providers.get(id);
    if (!entry) throw new ScheduleError('NOT_FOUND', 404);
    return {entry, local};
  }
  return {
    register,
    async list({from, to, signal}) {
      try {
        const results = await Promise.all([...providers.entries()].map(async ([id, entry]) =>
          list(await call(entry, 'list', {from, to}, signal), id, Date.parse(from), Date.parse(to))));
        const items = results.flatMap(r => r.items).sort((a, b) => compare(a.at, b.at) || compare(a.key, b.key));
        const daily = results.flatMap(r => r.daily).sort((a, b) => compare(a.key, b.key));
        const version = createHash('sha256').update(canonical({items, daily})).digest('hex');
        return {version, items, daily};
      } catch { throw new ScheduleError('UNAVAILABLE', 503); }
    },
    async action({key, action, signal}) {
      validateAction(action);
      const {entry, local} = find(key);
      const result = await call(entry, 'action', {key: local, action}, signal);
      if (result?.status !== 'done') throw new ScheduleError('UNAVAILABLE', 503);
      return {key, action, status: 'done'};
    },
    async content({key, date, signal}) {
      requireValue(validDate(date));
      const {entry, local} = find(key);
      const result = await call(entry, 'content', {key: local, date}, signal);
      try { return {key, ...content(result, date)}; }
      catch { throw new ScheduleError('UNAVAILABLE', 503); }
    },
    close() {
      closed = true;
      const entries = [...providers.values()]; providers.clear();
      for (const entry of entries) { entry.controller.abort(); try { entry.provider.dispose?.(); } catch { /* Finish disposal of every provider. */ } }
    },
  };
}
