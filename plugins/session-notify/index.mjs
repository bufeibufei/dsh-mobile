import {createNotifyRuntime} from './runtime.mjs';
import {createSettingsStore} from './settings.mjs';
import {mountRoutes} from './routes.mjs';

export const name = 'jarvis-session-notify';
export const inject = ['sessions'];
export async function apply(ctx, config = {}) {
  if (Object.keys(config).some(key => key !== 'directory')) throw new TypeError('Unknown notification config');
  const settings = await createSettingsStore(config.directory);
  let titles = null;
  const runtime = createNotifyRuntime({title: session => titles?.get(session)?.title ?? null});
  ctx.effect(() => () => runtime.close());
  ctx.on('session/event', runtime.observe);
  ctx.on('session/disposed', runtime.forget);
  ctx.inject(['sessionTitle'], exact => {
    titles = exact.sessionTitle;
    exact.effect(() => () => { titles = null; });
  });
  ctx.inject(['connection'], exact => mountRoutes(exact, runtime, settings));
}
