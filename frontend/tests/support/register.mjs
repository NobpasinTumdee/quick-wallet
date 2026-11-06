import { registerHooks } from 'node:module';

/* Lets Node's own TypeScript support load app modules that import each
   other without an extension (`./noteFormat`), the way Vite resolves them. */
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* not a .ts module: fall through */
      }
    }
    return next(specifier, context);
  },
});
