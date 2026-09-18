import { describe, expect, it, vi } from 'vitest';
import { createOpsLogger } from '../../src/ops-error/logger.js';
import { reportOpsError, reportOpsErrorAsync } from '../../src/ops-error/report.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('createOpsLogger', () => {
    it('writes JSON lines at each level', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const logger = createOpsLogger('notify-worker');
        logger.debug('d');
        logger.info('i', { token: 'secret-value-here' });
        logger.warn('w');
        logger.error('e', { message: 'boom' });
        expect(JSON.parse(String(log.mock.calls[0]?.[0])).level).toBe('debug');
        expect(JSON.parse(String(log.mock.calls[1]?.[0])).event).toBe('i');
        expect(String(log.mock.calls[1]?.[0])).not.toContain('secret-value-here');
        expect(JSON.parse(String(warn.mock.calls[0]?.[0])).level).toBe('warn');
        expect(JSON.parse(String(error.mock.calls[0]?.[0])).level).toBe('error');
        log.mockRestore();
        warn.mockRestore();
        error.mockRestore();
    });

    it('sends ops mail on error when env present', async () => {
        const waitUntil = vi.fn();
        const notify = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true, id: 'm1' }), { status: 200 }),
        );
        const logger = createOpsLogger('w', {
            env: {
                SVC_NOTIFY: notify,
                NOTIFY_AUTH_TOKEN: 'tok',
                OPS_ALERT_TO: 'ops@x.com',
            },
            ctx: { waitUntil },
        });
        logger.error('disk full', { error: 'EIO', extra: 1 });
        expect(waitUntil).toHaveBeenCalled();
        await waitUntil.mock.calls[0]?.[0];
    });

    it('submits intake when fields.intake is true', async () => {
        const waitUntil = vi.fn();
        const notify = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        const logger = createOpsLogger('w', {
            env: {
                SVC_NOTIFY: notify,
                NOTIFY_AUTH_TOKEN: 'tok',
                OPS_ALERT_TO: 'ops@x.com',
            },
            ctx: { waitUntil },
        });
        logger.error('fail', { intake: true, message: `${'x'.repeat(900)}` });
        expect(waitUntil.mock.calls.length).toBeGreaterThanOrEqual(1);
        await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    });
});

describe('reportOpsError', () => {
    it('skips in dev when OPS_ALERT_TO missing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = await reportOpsError(
            { ENVIRONMENT: 'development' },
            {
                worker: 'w',
                reason: 'r',
                error: 'e',
            },
        );
        expect(result).toEqual({ ok: true, skipped: true, reason: 'ops_alert_to_missing' });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('fails in prod when OPS_ALERT_TO missing', async () => {
        const result = await reportOpsError(
            { ENVIRONMENT: 'production' },
            {
                worker: 'w',
                reason: 'r',
                error: 'e',
            },
        );
        expect(result).toEqual({ ok: false, error: 'OPS_ALERT_TO not configured' });
    });

    it('sends notify with truncated context and override to', async () => {
        let body = '';
        const notify = makeFakeFetcher((_url, init) => {
            body = String(init?.body);
            return new Response(JSON.stringify({ ok: true, id: '1' }), { status: 200 });
        });
        const result = await reportOpsError(
            { SVC_NOTIFY: notify, NOTIFY_AUTH_TOKEN: 'tok', OPS_ALERT_TO: 'a@x.com' },
            {
                worker: 'notify-worker',
                reason: 'boom',
                error: 'e'.repeat(900),
                to: ' override@x.com ',
                context: {
                    empty: null,
                    obj: { a: 1 },
                    long: 'z'.repeat(600),
                },
                dedupKey: 'dk',
            },
        );
        expect(result.ok).toBe(true);
        const payload = JSON.parse(body) as {
            to: string;
            subject: string;
            body: string;
            html: string;
        };
        expect(payload.to).toBe('override@x.com');
        expect(payload.subject).toContain('[ops:notify-worker]');
        expect(payload.body).toContain('截断');
        expect(payload.body).toContain('obj:');
        expect(payload.html).toContain('<');
    });

    it('catches notify throw', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const notify = makeFakeFetcher(() => {
            throw new Error('down');
        });
        const result = await reportOpsError(
            { SVC_NOTIFY: notify, NOTIFY_AUTH_TOKEN: 'tok', OPS_ALERT_TO: 'a@x.com' },
            { worker: 'w', reason: 'r', error: 'e' },
        );
        expect(result).toEqual({ ok: false, error: 'down' });
        expect(err).toHaveBeenCalled();
        const notify2 = makeFakeFetcher(() => {
            throw 'raw';
        });
        await expect(
            reportOpsError(
                { SVC_NOTIFY: notify2, NOTIFY_AUTH_TOKEN: 'tok', OPS_ALERT_TO: 'a@x.com' },
                { worker: 'w', reason: 'r', error: 'e' },
            ),
        ).resolves.toEqual({ ok: false, error: 'raw' });
        err.mockRestore();
    });
});

describe('reportOpsErrorAsync', () => {
    it('uses waitUntil when ctx present', async () => {
        const waitUntil = vi.fn();
        reportOpsErrorAsync(
            { ENVIRONMENT: 'development' },
            { worker: 'w', reason: 'r', error: 'e' },
            {
                waitUntil,
            },
        );
        expect(waitUntil).toHaveBeenCalledTimes(1);
        await waitUntil.mock.calls[0]?.[0];
    });

    it('fire-and-forgets without ctx', () => {
        reportOpsErrorAsync(
            { ENVIRONMENT: 'development' },
            { worker: 'w', reason: 'r', error: 'e' },
        );
    });

    it('intake:true posts to sch1 when SVC_SCH1 configured', async () => {
        const waitUntil = vi.fn();
        let intakeBody = '';
        const sch1 = makeFakeFetcher((_url, init) => {
            intakeBody = String(init?.body);
            return new Response(JSON.stringify({ ok: true, id: 42 }), { status: 200 });
        });
        const notify = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        reportOpsErrorAsync(
            {
                SVC_NOTIFY: notify,
                NOTIFY_AUTH_TOKEN: 'tok',
                OPS_ALERT_TO: 'a@x.com',
                SVC_SCH1: sch1,
                SCH_INTAKE_TOKEN: 'intake-tok',
            },
            {
                worker: 'decision-desk-worker',
                reason: 'desk_signal_give_up',
                error: 'UNIQUE constraint failed',
                intake: true,
                context: { attempts: 5 },
            },
            { waitUntil },
        );
        expect(waitUntil.mock.calls.length).toBeGreaterThanOrEqual(1);
        await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
        const event = JSON.parse(intakeBody) as {
            kind: string;
            source: { worker: string };
            payload: { reason: string };
        };
        expect(event.kind).toBe('ops.error');
        expect(event.source.worker).toBe('decision-desk-worker');
        expect(event.payload.reason).toBe('desk_signal_give_up');
    });
});
