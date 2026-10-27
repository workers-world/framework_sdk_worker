import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    submitIntakeEvent,
    submitIntakeEventAsync,
    validateIntakeEvent,
} from '../../src/intake/submit.js';
import type { IntakeEvent } from '../../src/intake/types.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

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

describe('validateIntakeEvent', () => {
    it('rejects each required field', () => {
        expect(validateIntakeEvent({ ...baseEvent, schemaVersion: 2 })).toBe(
            'schemaVersion must be 1',
        );
        expect(validateIntakeEvent({ ...baseEvent, kind: '  ' })).toBe('kind required');
        expect(validateIntakeEvent({ ...baseEvent, dedupKey: '' })).toBe('dedupKey required');
        expect(validateIntakeEvent({ ...baseEvent, source: { producer: '' } })).toBe(
            'source.producer required',
        );
        expect(validateIntakeEvent({ ...baseEvent, title: ' ' })).toBe('title required');
        expect(validateIntakeEvent({ ...baseEvent, summary: '' })).toBe('summary required');
        expect(validateIntakeEvent({ ...baseEvent, occurredAt: '' })).toBe('occurredAt required');
        expect(validateIntakeEvent({ ...baseEvent, payload: null as unknown as object })).toBe(
            'payload required',
        );
        expect(validateIntakeEvent(baseEvent)).toBeNull();
    });
});

describe('submitIntakeEvent', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns validation error without fetch', async () => {
        const result = await submitIntakeEvent({}, { ...baseEvent, kind: '' });
        expect(result).toEqual({ ok: false, error: 'kind required' });
    });

    it('requires token or binding', async () => {
        await expect(submitIntakeEvent({}, baseEvent)).resolves.toEqual({
            ok: false,
            error: 'SCH_INTAKE_TOKEN or SVC_SCH1 not configured',
        });
    });

    it('normalizes /sch1 suffix and uses service binding', async () => {
        const sch1 = makeFakeFetcher((url) => {
            expect(url).toBe('https://example.com/sch1/intake');
            return new Response(JSON.stringify({ ok: true, id: 3, duplicate: false }), {
                status: 200,
            });
        });
        const result = await submitIntakeEvent(
            { SVC_SCH1: sch1, SCH_INTAKE_URL: 'https://example.com/sch1', SCH_INTAKE_TOKEN: 'tok' },
            baseEvent,
        );
        expect(result).toMatchObject({ ok: true, id: 3, duplicate: false, status: 200 });
    });

    it('keeps full /sch1/intake URL', async () => {
        const fetchSpy = vi.fn(
            async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchSpy);
        await submitIntakeEvent(
            { SCH_INTAKE_URL: 'https://example.com/sch1/intake', SCH_INTAKE_TOKEN: 'tok' },
            baseEvent,
        );
        expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://example.com/sch1/intake');
    });

    it('maps invalid JSON, HTTP error, empty body, and throw', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not-json', { status: 200 })),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('invalid JSON') });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toEqual({ ok: false, status: 500, error: 'nope' });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 502, statusText: 'Bad Gateway' })),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toMatchObject({ ok: false, status: 502 });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network');
            }),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toEqual({ ok: false, error: 'network' });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw 'offline';
            }),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toEqual({ ok: false, error: 'offline' });
    });

    it('treats 200 without ok as ok:true unless ok is false', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 200 })),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toMatchObject({ ok: true, status: 200 });

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ ok: false, error: 'dup' }), { status: 200 }),
            ),
        );
        await expect(
            submitIntakeEvent({ SCH_INTAKE_TOKEN: 'tok', SCH_INTAKE_URL: 'https://x' }, baseEvent),
        ).resolves.toMatchObject({ ok: false, error: 'dup' });
    });
});

describe('submitIntakeEventAsync', () => {
    it('waitUntil and warns on failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const waitUntil = vi.fn();
        submitIntakeEventAsync({}, { ...baseEvent, kind: '' }, { waitUntil });
        expect(waitUntil).toHaveBeenCalled();
        await waitUntil.mock.calls[0]?.[0];
        expect(warn).toHaveBeenCalled();
        submitIntakeEventAsync({}, { ...baseEvent, kind: '' });
        warn.mockRestore();
    });
});
