import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

// Bundle the actual exported component, never a source slice. JSX is an
// inspectable value; unrelated atom initialization and CSS use test substitutes.
export async function loadOfficialSwitch() {
  const local = createRequire(import.meta.url);
  let build, entry;
  try {
    const sdkPath = local.resolve('@deepseek-ai/dsh/package.json');
    if (local(sdkPath).version !== '0.2.1-alpha.2') return null;
    const sdk = createRequire(sdkPath);
    ({build} = await import(local.resolve('esbuild')));
    entry = sdk.resolve('@deepseek-ai/dsh-client-ui-primitives');
  } catch (error) {
    if (['ENOENT', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) return null;
    throw error;
  }
  const result = await build({
    stdin: {contents: `export {Switch} from ${JSON.stringify(entry)}`, resolveDir: fileURLToPath(new URL('.', import.meta.url))},
    bundle: true, write: false, format: 'cjs', platform: 'node', loader: {'.module.css': 'empty'},
    plugins: [{name: 'external-atoms', setup(builder) {
      builder.onResolve({filter: /^[^./]/}, args =>
        ({path: args.path, external: true, sideEffects: false}));
    }}]
  });
  const module = {exports: {}};
  const unused = new Proxy(() => unused, {get: (_target, key) => key === Symbol.toPrimitive ? () => '' : unused});
  runInNewContext(result.outputFiles[0].text, {module, exports: module.exports,
    setTimeout() { return 0; }, require(name) {
      if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props})};
      if (name === 'react') return {createContext: () => ({}), forwardRef: fn => fn, memo: fn => fn};
      if (name === 'clsx') return (...names) => names.filter(Boolean).join(' ');
      // Other atoms retain imports at initialization; Switch never uses them.
      return unused;
  }});
  return module.exports.Switch;
}
