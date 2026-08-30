import type { Env } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface CreateWorkerAppOptions {
    cors?: boolean;
}

/** register* 系列的最小结构类型：兼容任意 env 泛型的 Hono 实例，避免 any */
export interface RegisterableApp {
    use: (path: string, handler: unknown) => unknown;
    get: (
        path: string,
        handler: (c: {
            json: (body: unknown, status?: number) => Response;
        }) => Response | Promise<Response>,
    ) => unknown;
    onError: (
        handler: (
            err: unknown,
            c: { json: (body: unknown, status?: number) => Response },
        ) => Response | Promise<Response>,
    ) => unknown;
}

export function createWorkerApp(options?: CreateWorkerAppOptions): Hono<Env> {
    const app = new Hono<Env>();

    if (options?.cors) {
        app.use('*', cors());
    }

    return app;
}

export function registerHealthRoute(app: RegisterableApp): void {
    app.get('/health', (c) => c.json({ ok: true }));
}

export function registerNotFoundRoute(app: RegisterableApp): void {
    app.get('*', (c) => c.json({ error: 'Not Found' }, 404));
}

export function registerGlobalErrorHandler(
    app: RegisterableApp,
    message = '内部错误',
    code = 'INTERNAL_ERROR',
): void {
    app.onError((err, c) => {
        console.error(err);
        return c.json({ error: message, code }, 500);
    });
}
