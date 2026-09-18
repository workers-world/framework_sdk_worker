import { describe, expect, it } from 'vitest';
import { parseJsonBody } from '../../src/http/parse-json.js';

function makeContext(options: {
    json?: unknown;
    jsonError?: Error;
    text?: string;
    textError?: Error;
    contentType?: string;
}) {
    const jsonCalls: Array<{ body: unknown; status?: number }> = [];
    return {
        c: {
            req: {
                json: async <T>() => {
                    if (options.jsonError) {
                        throw options.jsonError;
                    }
                    return options.json as T;
                },
                text: async () => {
                    if (options.textError) {
                        throw options.textError;
                    }
                    return options.text ?? '';
                },
                header: (name: string) =>
                    name.toLowerCase() === 'content-type' ? options.contentType : undefined,
            },
            json(body: unknown, status?: number) {
                jsonCalls.push({ body, status });
                return new Response(JSON.stringify(body), { status });
            },
        },
        jsonCalls,
    };
}

describe('parseJsonBody', () => {
    it('returns parsed data on success', async () => {
        const { c } = makeContext({ json: { a: 1 } });
        const result = await parseJsonBody<{ a: number }>(c);
        expect(result).toEqual({ ok: true, data: { a: 1 } });
    });

    it('returns generic error without debug', async () => {
        const { c, jsonCalls } = makeContext({ jsonError: new Error('Unexpected token') });
        const result = await parseJsonBody(c);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(400);
        }
        expect(jsonCalls[0]).toEqual({
            body: { error: '请求体不是合法 JSON' },
            status: 400,
        });
    });

    it('includes detail, contentType and truncated raw body in debug mode', async () => {
        const { c, jsonCalls } = makeContext({
            jsonError: new Error('bad json'),
            text: 'x'.repeat(600),
            contentType: 'text/plain',
        });
        const result = await parseJsonBody(c, { debug: true });
        expect(result.ok).toBe(false);
        const body = jsonCalls[0]?.body as {
            error: string;
            detail: string;
            contentType: string;
            rawBody: string;
        };
        expect(body.error).toBe('请求体不是合法 JSON');
        expect(body.detail).toBe('bad json');
        expect(body.contentType).toBe('text/plain');
        expect(body.rawBody).toHaveLength(500);
    });

    it('falls back when debug body/header cannot be read', async () => {
        const { c, jsonCalls } = makeContext({
            jsonError: 'not-an-error' as unknown as Error,
            textError: new Error('closed'),
        });
        await parseJsonBody(c, { debug: true });
        const body = jsonCalls[0]?.body as {
            detail: string;
            contentType: string;
            rawBody: string;
        };
        expect(body.detail).toBe('not-an-error');
        expect(body.contentType).toBe('(无Content-Type)');
        expect(body.rawBody).toBe('(无法读取body)');
    });
});
