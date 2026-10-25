import {validateSettings} from './settings.mjs';

const prefix = '/api/session-notify/';
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,
  headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
const bad = () => json({ok: false, error: {code: 'CONTRACT_MISMATCH'}}, 400);
export function mountRoutes(ctx, runtime, settings) {
  for (const [route, methods] of [['stream', ['GET']], ['viewing', ['POST']], ['settings', ['GET', 'PUT']]]) {
    ctx.connection.fetch.register({path: prefix + route, methods, requestBody: 'buffered', async fetch(request) {
      const admission = ctx.connection.admit(request);
      if ('rejection' in admission) return new Response(null, {status: admission.rejection,
        headers: {'cache-control': 'no-store'}});
      const params = new URL(request.url).searchParams;
      if (!methods.includes(request.method) || [...params.keys()].some(key =>
        route !== 'stream' || !['after', 'epoch'].includes(key) || params.getAll(key).length !== 1)) return bad();
      if (route === 'stream') {
        const raw = params.get('after'), after = raw === null ? undefined : Number(raw);
        const epoch = params.get('epoch') ?? undefined;
        if (epoch !== undefined && after === undefined) return bad();
        if (raw !== null && (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(after))) return bad();
        return runtime.stream({after, epoch, signal: request.signal});
      }
      if (request.method === 'GET') return json({ok: true, value: settings.read()});
      let input;
      try {
        input = await request.json();
        request.signal.throwIfAborted();
        if (route === 'settings') validateSettings(input);
        else if (!input || Array.isArray(input) || Object.keys(input).length !== 2 ||
          !(input.sessionId === null || typeof input.sessionId === 'string' && input.sessionId.length > 0) ||
          typeof input.visible !== 'boolean') return bad();
      } catch { return bad(); }
      if (route === 'viewing') {
        runtime.viewing(input);
        return new Response(null, {status: 204, headers: {'cache-control': 'no-store'}});
      }
      try { return json({ok: true, value: await settings.update(input)}); }
      catch { return json({ok: false, error: {code: 'SETTINGS_UNAVAILABLE'}}, 503); }
    }});
  }
  ctx.effect(() => () => runtime.closeStreams());
}
