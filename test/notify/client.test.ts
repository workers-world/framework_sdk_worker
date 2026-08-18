import { describe, expect, it } from 'vitest';
import { sendNotify, sendNotifyAsync } from '../../src/notify/client.js';

function mockFetcher(response: Response): Fetcher {
    return {
        fetch: async () => response,
    } as unknown as Fetcher;
}

describe('sendNotifyAsync', () => {
    it('returns error instead of throwing on empty response body', async () => {
        const notify = mockFetcher(new Response('', { status: 502, statusText: 'Bad Gateway' }));
        const result = await sendNotifyAsync(notify, 'token', {
            itemFormat: 'raw',
            ruleId: 'v2ex',
            subjectPrefix: '[V2EX]',
            to: 'user@example.com',
            originalSubject: 'test',
            originalFrom: 'from@example.com',
            originalText: 'body',
            originalHtml: '',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Bad Gateway');
        expect(result.status).toBe(502);
    });

    it('returns error on invalid JSON body', async () => {
        const notify = mockFetcher(new Response('not-json', { status: 200 }));
        const result = await sendNotifyAsync(notify, 'token', {
            itemFormat: 'raw',
            ruleId: 'v2ex',
            subjectPrefix: '[V2EX]',
            to: 'user@example.com',
            originalSubject: 'test',
            originalFrom: 'from@example.com',
            originalText: 'body',
            originalHtml: '',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('notify invalid JSON');
    });
});

describe('sendNotify', () => {
    it('returns error instead of throwing on empty response body', async () => {
        const notify = mockFetcher(new Response('', { status: 500 }));
        const result = await sendNotify(notify, 'token', { subject: 'hi', body: 'test' });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(500);
    });
});
