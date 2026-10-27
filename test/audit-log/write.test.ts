import { describe, expect, it, vi } from 'vitest';
import {
    queryMaintenanceLogs,
    queryMaintenanceLogsSince,
    writeMaintenanceLog,
    writeMaintenanceLogAsync,
} from '../../src/audit-log/client.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

const entry = {
    ts: '2026-09-15T00:00:00+08:00',
    actor: 'system',
    worker: 'w',
    service: 's',
    action: 'a',
    target: 't',
    tech: 'x',
    traceId: 'tr',
};

describe('writeMaintenanceLog', () => {
    it('errors without binding or token', async () => {
        await expect(writeMaintenanceLog(undefined, 't', entry)).resolves.toEqual({
            ok: false,
            error: 'SVC_AUDIT_LOG service binding not configured',
        });
        await expect(writeMaintenanceLog(makeFakeFetcher(), undefined, entry)).resolves.toEqual({
            ok: false,
            error: 'AUDIT_LOG_AUTH_TOKEN not configured',
        });
    });

    it('returns parsed success and HTTP / JSON / throw failures', async () => {
        const ok = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true, id: 9 }), { status: 200 }),
        );
        await expect(writeMaintenanceLog(ok, 'tok', entry)).resolves.toEqual({ ok: true, id: 9 });

        const http = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ error: 'denied' }), {
                    status: 403,
                    statusText: 'Forbidden',
                }),
        );
        await expect(writeMaintenanceLog(http, 'tok', entry)).resolves.toEqual({
            ok: false,
            error: 'denied',
        });

        const notJson = makeFakeFetcher(() => new Response('nope', { status: 200 }));
        await expect(writeMaintenanceLog(notJson, 'tok', entry)).resolves.toEqual({
            ok: false,
            error: 'audit-log 响应非 JSON（HTTP 200）',
        });

        const boom = makeFakeFetcher(() => {
            throw new Error('timeout');
        });
        await expect(writeMaintenanceLog(boom, 'tok', entry)).resolves.toEqual({
            ok: false,
            error: 'timeout',
        });
        const raw = makeFakeFetcher(() => {
            throw 'x';
        });
        await expect(writeMaintenanceLog(raw, 'tok', entry)).resolves.toEqual({
            ok: false,
            error: 'x',
        });
    });
});

describe('writeMaintenanceLogAsync', () => {
    it('waitUntil on success path and warns on failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const waitUntil = vi.fn();
        writeMaintenanceLogAsync(undefined, 't', entry, { waitUntil });
        expect(waitUntil).toHaveBeenCalled();
        await waitUntil.mock.calls[0]?.[0];
        expect(warn).toHaveBeenCalled();
        writeMaintenanceLogAsync(undefined, 't', entry);
        warn.mockRestore();
    });
});

describe('queryMaintenanceLogs extra branches', () => {
    it('errors without token and maps remaining query params', async () => {
        await expect(queryMaintenanceLogs(makeFakeFetcher(), undefined, {})).resolves.toEqual({
            ok: false,
            error: 'AUDIT_LOG_AUTH_TOKEN not configured',
        });
        let seen = '';
        const logger = makeFakeFetcher((url) => {
            seen = url;
            return new Response(
                JSON.stringify({
                    ok: true,
                    rows: [
                        {
                            id: 1,
                            ts: 't',
                            actor: 'a',
                            worker: 'w',
                            service: 's',
                            action: 'x',
                            target: 't',
                            tech: 'tech',
                            before: 1,
                            after: 2,
                            traceId: 'camel',
                            opId: 'op',
                            detail: 'd',
                        },
                    ],
                }),
                { status: 200 },
            );
        });
        const result = await queryMaintenanceLogs(logger, 'tok', {
            worker: 'w',
            service: 's',
            traceId: 'tr',
            afterId: 8,
        });
        expect(result.ok).toBe(true);
        expect(result.rows?.[0]?.traceId).toBe('camel');
        expect(result.rows?.[0]?.opId).toBe('op');
        expect(result.rows?.[0]?.before).toBe('1');
        expect(seen).toContain('worker=w');
        expect(seen).toContain('afterId=8');
        expect(seen).toContain('traceId=tr');
    });

    it('maps HTTP error, non-JSON, throw, empty rows', async () => {
        const http = makeFakeFetcher(
            () => new Response(JSON.stringify({ error: 'no' }), { status: 500, statusText: 'err' }),
        );
        await expect(queryMaintenanceLogs(http, 'tok', {})).resolves.toEqual({
            ok: false,
            error: 'no',
        });
        const notJson = makeFakeFetcher(() => new Response('x', { status: 200 }));
        await expect(queryMaintenanceLogs(notJson, 'tok', {})).resolves.toEqual({
            ok: false,
            error: 'audit-log 响应非 JSON（HTTP 200）',
        });
        const boom = makeFakeFetcher(() => {
            throw new Error('down');
        });
        await expect(queryMaintenanceLogs(boom, 'tok', {})).resolves.toEqual({
            ok: false,
            error: 'down',
        });
        const empty = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        const emptyResult = await queryMaintenanceLogs(empty, 'tok', {});
        expect(emptyResult.ok).toBe(true);
        expect(emptyResult.rows).toEqual([]);
    });
});

describe('queryMaintenanceLogsSince extra', () => {
    it('stops when batch empty and when cursor stalls', async () => {
        const empty = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 }),
        );
        await expect(queryMaintenanceLogsSince(empty, 'tok', { action: 'a' })).resolves.toEqual({
            ok: true,
            rows: [],
        });

        const stall = makeFakeFetcher(
            () =>
                new Response(
                    JSON.stringify({
                        ok: true,
                        rows: [
                            {
                                id: 1,
                                ts: 't',
                                actor: 'a',
                                worker: 'w',
                                service: 's',
                                action: 'a',
                                target: 't',
                                tech: 't',
                                trace_id: 'x',
                            },
                        ],
                        nextAfterId: 1,
                    }),
                    { status: 200 },
                ),
        );
        const stalled = await queryMaintenanceLogsSince(stall, 'tok', { action: 'a' }, 1);
        expect(stalled.ok).toBe(false);
        expect(stalled.error).toContain('分页游标未前进');
        expect(stalled.rows.length).toBeGreaterThanOrEqual(1);
    });
});
