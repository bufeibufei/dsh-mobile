import {createRequire} from 'node:module';
import {createRegistry} from './runtime.mjs';
import {mountRoutes} from './routes.mjs';
export const name = 'dsh-mobile-scheduled-notify';

// Resolve the Host's Cordis copy, including installations with nested dependencies.
async function cordis() {
  const local = createRequire(import.meta.url);
  const sdk = createRequire(local.resolve('@deepseek-ai/dsh/package.json'));
  const connection = createRequire(sdk.resolve('@deepseek-ai/dsh-client-connection'));
  return import(connection.resolve('@deepseek-ai/cordis'));
}
export function serviceClass(Service) {
  return class MobileSchedule extends Service {
    constructor(ctx) {
      super(ctx, 'mobileSchedule', true);
      this.registry = createRegistry();
      ctx.effect(() => () => this.registry.close());
      ctx.inject(['connection'], exact => mountRoutes(exact, this));
    }
    register(provider) { return this.registry.register(provider); }
    list(input) { return this.registry.list(input); }
    action(input) { return this.registry.action(input); }
    content(input) { return this.registry.content(input); }
  };
}
export async function apply(ctx) {
  const {Service} = await cordis();
  const MobileSchedule = serviceClass(Service);
  ctx.plugin(MobileSchedule);
}
