import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitIntakeEvent } from '../../src/intake/submit.js';
import type { IntakeEvent } from '../../src/intake/types.js';

const baseEvent: IntakeEvent = {
    schemaVersion: 1,
    kind: 'ops.error',
    dedupKey: 'ops.error:test:reason:abc:2026-09-08',
    source: { producer: 'test-worker' },
    title: 'title',
    summary: 'summary',
    occurredAt: '2026-09-08T00:00:00.000Z',
    payload: { worker: 'test-worker' },
};

describe('submitIntakeEvent URL normalization', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('strips trailing slashes without regex backtracking', async () => {
        const fetchSpy = vi.fn(
            async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        await submitIntakeEvent(
            {
                SCH_INTAKE_URL: `https://example.com${'/'.repeat(5000)}`,
                SCH_INTAKE_TOKEN: 'token',
            },
            baseEvent,
        );

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url] = fetchSpy.mock.calls[0] as [string];
        expect(url).toBe('https://example.com/sch1/intake');
    });

    it('appends /sch1/intake when base is origin only', async () => {
        const fetchSpy = vi.fn(
            async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        await submitIntakeEvent(
            { SCH_INTAKE_URL: 'https://example.com///', SCH_INTAKE_TOKEN: 'token' },
            baseEvent,
        );

        const [url] = fetchSpy.mock.calls[0] as [string];
        expect(url).toBe('https://example.com/sch1/intake');
    });
});
