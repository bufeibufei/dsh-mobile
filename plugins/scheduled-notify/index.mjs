import {createRegistry} from './runtime.mjs';
import {mountRoutes} from './routes.mjs';
export const name = 'dsh-mobile-scheduled-notify';

// A plain service provided through the Host's own Cordis context: the plugin never
// resolves the SDK itself, so it works wherever the Host loads it from.
export function createService(ctx) {
  const registry = createRegistry();
  ctx.effect(() => () => registry.close());
  return Object.freeze({
    register: provider => registry.register(provider),
    list: input => registry.list(input),
    action: input => registry.action(input),
    content: input => registry.content(input),
  });
}
export function apply(ctx) {
  const service = createService(ctx);
  ctx.provide('mobileSchedule', service);
  ctx.inject(['connection'], exact => mountRoutes(exact, service));
}
