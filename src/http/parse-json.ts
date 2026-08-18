export interface JsonRequestContext {
    req: {
        json<T>(): Promise<T>;
        text(): Promise<string>;
        header(name: string): string | undefined;
    };

    json(body: unknown, status?: number): Response;
}

export type ParseJsonResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export {jsonError, jsonResponse} from './errors.js';

export async function parseJsonBody<T = unknown>(
    c: JsonRequestContext,
    options?: { debug?: boolean },
): Promise<ParseJsonResult<T>> {
    try {
        const data = await c.req.json<T>();
        return {ok: true, data};
    } catch (e: unknown) {
        if (options?.debug) {
            const raw = await c.req.text().catch(() => '(无法读取body)');
            const contentType = c.req.header('Content-Type') || '(无Content-Type)';
            const msg = e instanceof Error ? e.message : String(e);
            return {
                ok: false,
                response: c.json(
                    {
                        error: '请求体不是合法 JSON',
                        detail: msg,
                        contentType,
                        rawBody: raw.substring(0, 500),
                    },
                    400,
                ),
            };
        }

        return {
            ok: false,
            response: c.json({error: '请求体不是合法 JSON'}, 400),
        };
    }
}
