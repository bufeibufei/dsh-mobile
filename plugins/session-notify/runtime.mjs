import {randomUUID} from 'node:crypto';

const processSequence = {epoch: randomUUID(), id: 0};
const DAY = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

/** Keep readable labels/code, discard Markdown syntax, URLs and non-text blocks. */
export function previewText(value) {
  if (typeof value !== 'string') return '';
  const plain = value
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ').trim();
  return Array.from(plain).slice(0, 60).join('');
}

export function createNotifyRuntime({now = Date.now, sequence = processSequence,
  title = () => null, timers = {setInterval, clearInterval}} = {}) {
  let turns = new WeakMap(), seen = new WeakMap(), cache = [], viewing = null, closed = false;
  const clients = new Set();
  const prune = () => { cache = cache.filter(row => Date.parse(row.at) > now() - DAY).slice(-200); };
  const retention = timers.setInterval(prune, 25000);
  retention?.unref?.();
  function publish(session, kind, preview, automated) {
    if (closed) return;
    if (sequence.id >= Number.MAX_SAFE_INTEGER) throw new Error('Notification sequence exhausted');
    let sessionTitle = null;
    try { sessionTitle = title(session); } catch { /* Optional metadata unavailable. */ }
    const row = Object.freeze({id: ++sequence.id, at: new Date(now()).toISOString(), sessionId: session.id,
      sessionTitle: typeof sessionTitle === 'string' ? sessionTitle : null, kind,
      preview: previewText(preview), automated: Boolean(automated),
      viewing: Boolean(viewing?.visible && viewing.sessionId === session.id && now() - viewing.at < 60000)});
    cache.push(row); prune();
    for (const client of clients) client.send(`id: ${row.id}\nevent: notify\ndata: ${JSON.stringify(row)}\n\n`);
  }
  function observe(session, event) {
    if (closed) return;
    // Ignore duplicate callbacks without reading historical session messages.
    if (Number.isSafeInteger(event.seq)) {
      const sequences = seen.get(session) ?? new Set();
      if (sequences.has(event.seq)) return;
      sequences.add(event.seq);
      if (sequences.size > 256) sequences.delete(sequences.values().next().value);
      seen.set(session, sequences);
    }
    const data = event.data ?? {};
    let turn = turns.get(session);
    if (event.type === 'turn/start') {
      turns.set(session, {number: data.turn, preview: '', automated: false});
      return;
    }
    if (event.type === 'user/message') {
      // UserMessage has no turn number; the surrounding turn/start owns it.
      if (turn && data.source?.kind === 'schedule') turn.automated = true;
      return;
    }
    if (event.type === 'assistant/message') {
      if (turn?.number === data.turn) turn.preview = previewText(
        (data.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(' '));
      return;
    }
    if (event.type === 'turn/end') {
      if (turn?.number !== data.turn) turn = null;
      if (data.reason?.kind === 'completed') publish(session, 'reply', turn?.preview ?? '', turn?.automated);
      if (data.reason?.kind === 'error') publish(session, 'failed', '', turn?.automated);
      turns.delete(session);
    } else if (event.type === 'approval/asked') {
      publish(session, 'approval', data.reason ?? '', turn?.automated);
    } else if (event.type === 'tool/call' && data.name === 'ask_user_question') {
      let args;
      try { args = JSON.parse(data.arguments); } catch { return; }
      if (!Array.isArray(args?.questions) || !args.questions.length || args.questions.some(question =>
        typeof question?.id !== 'string' || typeof question.question !== 'string')) return;
      publish(session, 'question', args.questions.map(question => question.question).join(' '),
        turn?.number === data.turn && turn.automated);
    }
  }
  function stream({after, epoch, signal} = {}) {
    if (closed) throw new Error('Notification runtime closed');
    let cleanup = (close = true) => {};
    const body = new ReadableStream({
      start(controller) {
        let ended = false, heartbeat;
        const client = {send(text) {
          if (ended) return;
          // A stalled subscriber must not turn the bounded cache into an unbounded queue.
          if (controller.desiredSize <= 0) { cleanup(); return; }
          try { controller.enqueue(encoder.encode(text)); }
          catch { cleanup(); }
        }};
        const onAbort = () => cleanup();
        cleanup = (close = true) => {
          if (ended) return;
          ended = true; clients.delete(client); timers.clearInterval(heartbeat);
          signal?.removeEventListener('abort', onAbort);
          if (close) {
            try { controller.close(); }
            catch { /* The stream may already be closed or errored. */ }
          }
        };
        client.close = cleanup;
        if (signal?.aborted) { cleanup(); return; }
        clients.add(client);
        signal?.addEventListener('abort', onAbort, {once: true});
        client.send(`event: reset\ndata: ${JSON.stringify({epoch: sequence.epoch, last: sequence.id})}\n\n`);
        prune();
        if (after !== undefined) for (const row of cache) if (
          epoch !== undefined && epoch !== sequence.epoch || row.id > after)
          client.send(`id: ${row.id}\nevent: notify\ndata: ${JSON.stringify(row)}\n\n`);
        if (ended) return;
        heartbeat = timers.setInterval(() => client.send(': ping\n\n'), 25000);
        heartbeat?.unref?.();
      },
      cancel() { cleanup(false); },
    }, {highWaterMark: 256});
    return new Response(body, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-store',
      'x-accel-buffering': 'no'}});
  }
  return {observe, stream,
    forget(session) { turns.delete(session); seen.delete(session); },
    viewing(value) { viewing = {...value, at: now()}; },
    closeStreams() { for (const client of clients) client.close(); },
    close() {
      if (closed) return;
      closed = true; timers.clearInterval(retention);
      for (const client of clients) client.close();
      cache = []; viewing = null; turns = new WeakMap(); seen = new WeakMap();
    },
  };
}
