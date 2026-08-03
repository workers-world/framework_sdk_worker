import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface CreateWorkerAppOptions {
    cors?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWorkerApp(options?: CreateWorkerAppOptions): any {
    const app = new Hono();

    if (options?.cors) {
        app.use('*', cors());
    }

    return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerHealthRoute(app: any): void {
    app.get('/health', (c: { json: (body: unknown) => Response }) => c.json({ ok: true }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerNotFoundRoute(app: any): void {
    app.get('*', (c: { json: (body: unknown, status?: number) => Response }) =>
        c.json({ error: 'Not Found' }, 404),
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerGlobalErrorHandler(
    app: any,
    message = '内部错误',
    code = 'INTERNAL_ERROR',
): void {
    app.onError((err: unknown, c: { json: (body: unknown, status?: number) => Response }) => {
        console.error(err);
        return c.json({ error: message, code }, 500);
    });
}
