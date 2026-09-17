import { describe, expect, it } from 'vitest';
import { sendNotify, sendNotifyAsync } from '../../src/notify/client.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

const digestItem = {
    itemFormat: 'llm' as const,
    ruleId: 'hn',
    subjectPrefix: '[HN]',
    to: 'u@x.com',
    title: 't',
    summary: 's',
    url: 'https://x',
    source: 'hn',
};

describe('sendNotify extra branches', () => {
    it('errors without binding or token', async () => {
        await expect(sendNotify(undefined, 't', { subject: 's', body: 'b' })).resolves.toEqual({
            ok: false,
            error: 'NOTIFY service binding not configured',
        });
        await expect(
            sendNotify(makeFakeFetcher(), undefined, { subject: 's', body: 'b' }),
        ).resolves.toEqual({
            ok: false,
            error: 'NOTIFY_AUTH_TOKEN not configured',
        });
    });

    it('maps HTTP error JSON and missing ok:true', async () => {
        const http = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ error: 'quota' }), {
                    status: 429,
                    statusText: 'Too Many',
                }),
        );
        await expect(sendNotify(http, 'tok', { subject: 's', html: '<p>x</p>' })).resolves.toEqual({
            ok: false,
            error: 'quota',
            status: 429,
        });

        const missingOk = makeFakeFetcher(() => new Response(JSON.stringify({}), { status: 200 }));
        await expect(sendNotify(missingOk, 'tok', { subject: 's', body: 'b' })).resolves.toEqual({
            ok: false,
            error: 'notify 响应缺少 ok:true',
            status: 200,
        });

        const withReason = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: false, reason: 'dup' }), { status: 200 }),
        );
        await expect(
            sendNotify(withReason, 'tok', { subject: 's', body: 'b' }),
        ).resolves.toMatchObject({
            ok: false,
            reason: 'dup',
        });

        const emptyOk = makeFakeFetcher(() => new Response('  ', { status: 200 }));
        await expect(
            sendNotify(emptyOk, 'tok', { subject: 's', body: 'b' }),
        ).resolves.toMatchObject({
            ok: false,
            error: 'notify empty response',
            status: 200,
        });
    });
});

describe('sendNotifyAsync extra branches', () => {
    it('errors without binding or token and maps success', async () => {
        await expect(sendNotifyAsync(undefined, 't', digestItem)).resolves.toEqual({
            ok: false,
            error: 'NOTIFY service binding not configured',
        });
        await expect(sendNotifyAsync(makeFakeFetcher(), undefined, digestItem)).resolves.toEqual({
            ok: false,
            error: 'NOTIFY_AUTH_TOKEN not configured',
        });

        let seenSource = '';
        const ok = makeFakeFetcher((_url, init) => {
            seenSource = new Headers(init?.headers).get('X-Notify-Source') ?? '';
            return new Response(JSON.stringify({ ok: true, queued: true }), { status: 200 });
        });
        await expect(sendNotifyAsync(ok, 'tok', digestItem)).resolves.toEqual({
            ok: true,
            queued: true,
        });
        expect(seenSource).toBe('hn');

        const http = makeFakeFetcher(
            () => new Response(JSON.stringify({ error: 'no' }), { status: 400, statusText: 'Bad' }),
        );
        await expect(
            sendNotifyAsync(http, 'tok', { ...digestItem, source: undefined }),
        ).resolves.toEqual({
            ok: false,
            error: 'no',
            status: 400,
        });

        const missing = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: false, reason: 'skip' }), { status: 200 }),
        );
        await expect(sendNotifyAsync(missing, 'tok', digestItem)).resolves.toMatchObject({
            ok: false,
            reason: 'skip',
        });
    });
});
