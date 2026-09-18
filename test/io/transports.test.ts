import { describe, expect, it } from 'vitest';
import { createWorkerIoEnvelope, STREAM_WORKFLOW_INSTANCE } from '../../src/io/envelope.js';
import { encodeWorkerIoEnvelope, tryDecodeWorkerIoEnvelope } from '../../src/io/serde.js';
import { workerIoBindingFetch, workerIoBindingGet } from '../../src/io/transports/binding.js';
import {
    CLOUDEVENTS_CONTENT_TYPE,
    JSON_CONTENT_TYPE,
    workerIoFromHttpRequest,
    workerIoFromHttpResponse,
    workerIoToHttpResponse,
} from '../../src/io/transports/http.js';
import {
    decodeWorkerIoQueueBody,
    encodeWorkerIoQueueBody,
    workerIoQueueSendBody,
} from '../../src/io/transports/queue.js';
import {
    decodeWorkerIoSseFrame,
    encodeWorkerIoSseFrame,
    readWorkerIoOverSse,
} from '../../src/io/transports/sse.js';

function sample() {
    return createWorkerIoEnvelope({
        id: 'a:1',
        source: '/workers/sch1',
        type: 'workers-world.sch1.task.workflow.step.completed',
        data: { n: 1 },
        wwstream: STREAM_WORKFLOW_INSTANCE,
    });
}

describe('HTTP transport', () => {
    it('roundtrips request/response and default content type', async () => {
        const e = sample();
        const res = workerIoToHttpResponse(e);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe(CLOUDEVENTS_CONTENT_TYPE);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const back = await workerIoFromHttpResponse(res);
        expect(back.id).toBe('a:1');

        const custom = workerIoToHttpResponse(e, 202, { contentType: JSON_CONTENT_TYPE });
        expect(custom.status).toBe(202);
        expect(custom.headers.get('Content-Type')).toBe(JSON_CONTENT_TYPE);

        const req = new Request('https://x', { method: 'POST', body: encodeWorkerIoEnvelope(e) });
        await expect(workerIoFromHttpRequest(req)).resolves.toMatchObject({ id: 'a:1' });
    });
});

describe('Queue transport extras', () => {
    it('encode helpers match and reject invalid body', () => {
        const e = sample();
        expect(encodeWorkerIoQueueBody(e)).toBe(encodeWorkerIoEnvelope(e));
        expect(workerIoQueueSendBody(e)).toBe(encodeWorkerIoEnvelope(e));
        expect(() => decodeWorkerIoQueueBody(null)).toThrow('queue body must be string or object');
        expect(() => decodeWorkerIoQueueBody(1)).toThrow('queue body must be string or object');
    });
});

describe('SSE transport extras', () => {
    it('ignores non-stream events', () => {
        expect(decodeWorkerIoSseFrame({ event: 'ping', data: '{}', id: '1' })).toBeNull();
        const e = sample();
        expect(
            decodeWorkerIoSseFrame({ event: 'message', data: encodeWorkerIoEnvelope(e) })?.id,
        ).toBe('a:1');
        expect(tryDecodeWorkerIoEnvelope('not-json')).toBeNull();
    });

    it('readWorkerIoOverSse yields decoded frames and skips others', async () => {
        const e = sample();
        const extra = 'event: ping\ndata: {}\n\n';
        const text = extra + encodeWorkerIoSseFrame(e);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(text));
                controller.close();
            },
        });
        const items = [];
        for await (const env of readWorkerIoOverSse(stream)) {
            items.push(env);
        }
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe('a:1');
    });
});

describe('binding transport', () => {
    it('POSTs envelope and decodes response', async () => {
        const e = sample();
        const svc = {
            fetch: async (_url: string, init?: RequestInit) => {
                expect(init?.method).toBe('POST');
                const headers = new Headers(init?.headers);
                expect(headers.get('Content-Type')).toBe(CLOUDEVENTS_CONTENT_TYPE);
                expect(init?.body).toBe(encodeWorkerIoEnvelope(e));
                return new Response(encodeWorkerIoEnvelope(e), { status: 200 });
            },
        };
        const back = await workerIoBindingFetch(svc, 'https://svc/v1', e);
        expect(back.id).toBe('a:1');
    });

    it('omits body for GET and keeps caller Content-Type', async () => {
        const e = sample();
        const svc = {
            fetch: async (_url: string, init?: RequestInit) => {
                expect(init?.body).toBeUndefined();
                expect(new Headers(init?.headers).get('Content-Type')).toBe('text/plain');
                return new Response(encodeWorkerIoEnvelope(e));
            },
        };
        await workerIoBindingFetch(svc, 'https://svc/v1', e, {
            method: 'GET',
            headers: { 'Content-Type': 'text/plain' },
        });
    });

    it('omits body for HEAD and defaults content type', async () => {
        const e = sample();
        const svc = {
            fetch: async (_url: string, init?: RequestInit) => {
                expect(init?.method).toBe('HEAD');
                expect(init?.body).toBeUndefined();
                expect(new Headers(init?.headers).get('Content-Type')).toBe(
                    CLOUDEVENTS_CONTENT_TYPE,
                );
                return new Response(encodeWorkerIoEnvelope(e));
            },
        };
        await workerIoBindingFetch(svc, 'https://svc/v1', e, { method: 'HEAD' });
    });

    it('throws on empty binding response', async () => {
        const svc = { fetch: async () => new Response('   ', { status: 200 }) };
        await expect(workerIoBindingFetch(svc, 'https://x', sample())).rejects.toThrow(
            /binding response empty/,
        );
    });

    it('workerIoBindingGet decodes GET body', async () => {
        const e = sample();
        const svc = {
            fetch: async (_url: string, init?: RequestInit) => {
                expect(init?.method).toBe('GET');
                return new Response(encodeWorkerIoEnvelope(e));
            },
        };
        await expect(workerIoBindingGet(svc, 'https://x')).resolves.toMatchObject({ id: 'a:1' });
    });
});
