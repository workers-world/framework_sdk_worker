import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'async/sleep': 'src/async/sleep.ts',
    'notify/client': 'src/notify/client.ts',
    'auth/bearer': 'src/auth/bearer.ts',
    'auth/middleware': 'src/auth/middleware.ts',
    'http/parse-json': 'src/http/parse-json.ts',
    'http/errors': 'src/http/errors.ts',
    'hono/create-app': 'src/hono/create-app.ts',
    'r2/put': 'src/r2/put.ts',
    'r2/gold-price': 'src/r2/gold-price.ts',
    'kv/dedup': 'src/kv/dedup.ts',
    'time/shanghai': 'src/time/shanghai.ts',
    'ai/gateway': 'src/ai/gateway.ts',
    'logger/index': 'src/logger/index.ts',
    'types/env': 'src/types/env.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['hono'],
});
