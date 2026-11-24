import type { Env } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { OpenApiDoc } from '../mcp/types.js';

export interface CreateWorkerAppOptions {
    cors?: boolean;
}

/**
 * register* 系列的最小结构类型：兼容任意 env 泛型的 Hono 实例，避免 any。
 * 必须用方法语法（bivariance）——属性式函数类型在 Hono 的 use 重载下不可满足，
 * 会破坏消费方 typecheck（0.4.0 曾因此破坏 llm-gateway）。
 */
export interface RegisterableApp {
    use(path: string, handler: unknown): unknown;
    get(
        path: string,
        handler: (c: {
            json: (body: unknown, status?: number) => Response;
        }) => Response | Promise<Response>,
    ): unknown;
    onError(
        handler: (
            err: unknown,
            c: { json: (body: unknown, status?: number) => Response },
        ) => Response | Promise<Response>,
    ): unknown;
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

/** 业务 OpenAPI 文档内容私有，路由骨架统一由 SDK 提供。 */
export function registerOpenApiRoute(app: RegisterableApp, doc: OpenApiDoc): void {
    app.get('/openapi.json', (c) => c.json(doc));
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
