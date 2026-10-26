import {ScheduleError, fields, instant, splitKey, validDate, validateAction} from './runtime.mjs';
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,
  headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
const bad = () => { throw new ScheduleError('CONTRACT_MISMATCH', 400); };
export function mountRoutes(ctx, service, {now = Date.now} = {}) {
  for (const [suffix, method, allowed] of [['', 'GET', ['from', 'to']], ['/action', 'POST', []], ['/content', 'GET', ['key', 'date']]]) {
    ctx.connection.fetch.register({path: '/api/mobile-schedule' + suffix, methods: [method], requestBody: 'buffered', async fetch(request) {
      try {
        const admission = ctx.connection.admit(request);
        if ('rejection' in admission) throw new ScheduleError(admission.rejection === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', admission.rejection);
        const url = new URL(request.url), params = url.searchParams;
        if (request.method !== method || [...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1)) bad();
        let value;
        if (suffix === '/action') {
          if (request.headers.get('origin') !== url.origin) throw new ScheduleError('FORBIDDEN', 403);
          let body;
          try {
            const raw = await request.text();
            body = JSON.parse(raw);
            // The action schema has exactly two string-valued members (nine JSON tokens).
            // Count whole quoted tokens so escaped duplicate property names cannot be collapsed by JSON.parse.
            if ((raw.match(/"(?:\\.|[^"\\])*"|[^\s]/gs) ?? []).length !== 9) bad();
          } catch { bad(); }
          fields(body, ['key', 'action']); splitKey(body.key); validateAction(body.action);
          value = await service.action({...body, signal: request.signal});
        } else if (suffix === '/content') {
          const key = params.get('key'), date = params.get('date');
          splitKey(key); if (!validDate(date)) bad();
          value = await service.content({key, date, signal: request.signal});
        } else {
          const from = params.has('from') ? instant(params.get('from')) : now();
          const to = params.has('to') ? instant(params.get('to')) : from + 7 * 86400000;
          if (to < from || to - from > 14 * 86400000) bad();
          value = await service.list({from: new Date(from).toISOString(), to: new Date(to).toISOString(), signal: request.signal});
        }
        return json({ok: true, value});
      } catch (error) {
        return json({ok: false, error: {code: error instanceof ScheduleError ? error.code : 'UNAVAILABLE'}},
          error instanceof ScheduleError ? error.status : 503);
      }
    }});
  }
}
