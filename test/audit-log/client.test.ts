import { describe, expect, it } from 'vitest';
import {
    queryMaintenanceLogs,
    queryMaintenanceLogsSince,
} from '../../src/audit-log/client.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('queryMaintenanceLogs', () => {
    it('missing binding returns error', async () => {
        const result = await queryMaintenanceLogs(undefined, 'token', { action: 'quality_capture' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('SVC_AUDIT_LOG');
    });

    it('maps snake_case rows and builds query string', async () => {
        let seenUrl = '';
        const logger = makeFakeFetcher((url) => {
            seenUrl = url;
            return new Response(
                JSON.stringify({
                    ok: true,
                    rows: [
                        {
                            id: 11,
                            ts: '2026-08-21T10:00:00+08:00',
                            actor: 'orchestrator-worker',
                            worker: 'orchestrator-worker',
                            service: 'email-rule-worker',
                            action: 'quality_capture',
                            target: 'dedup-1',
                            tech: 'workflow',
                            trace_id: 'dedup-1',
                            op_id: null,
                            detail: '{}',
                        },
                    ],
                    nextAfterId: 11,
                }),
                { status: 200 },
            );
        });

        const result = await queryMaintenanceLogs(logger, 'token', {
            action: 'quality_capture',
            sinceTs: '2026-08-20T00:00:00+08:00',
            sinceId: 3,
            order: 'asc',
            limit: 50,
        });
        expect(result.ok).toBe(true);
        expect(result.rows?.[0]?.traceId).toBe('dedup-1');
        expect(result.rows?.[0]?.id).toBe(11);
        expect(result.nextAfterId).toBe(11);
        expect(seenUrl).toContain('action=quality_capture');
        expect(seenUrl).toContain('sinceTs=');
        expect(seenUrl).toContain('sinceId=3');
        expect(seenUrl).toContain('order=asc');
    });
});

describe('queryMaintenanceLogsSince', () => {
    it('paginates until nextAfterId absent', async () => {
        const urls: string[] = [];
        const logger = makeFakeFetcher((url) => {
            urls.push(url);
            const u = new URL(url);
            const afterId = u.searchParams.get('afterId');
            if (!afterId) {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        rows: [
                            {
                                id: 1,
                                ts: '2026-08-21T10:00:00+08:00',
                                actor: 'a',
                                worker: 'w',
                                service: 's',
                                action: 'quality_capture',
                                target: 't1',
                                tech: 'workflow',
                                trace_id: 't1',
                            },
                            {
                                id: 2,
                                ts: '2026-08-21T11:00:00+08:00',
                                actor: 'a',
                                worker: 'w',
                                service: 's',
                                action: 'quality_capture',
                                target: 't2',
                                tech: 'workflow',
                                trace_id: 't2',
                            },
                        ],
                        nextAfterId: 2,
                    }),
                    { status: 200 },
                );
            }
            return new Response(
                JSON.stringify({
                    ok: true,
                    rows: [
                        {
                            id: 3,
                            ts: '2026-08-21T12:00:00+08:00',
                            actor: 'a',
                            worker: 'w',
                            service: 's',
                            action: 'quality_capture',
                            target: 't3',
                            tech: 'workflow',
                            trace_id: 't3',
                        },
                    ],
                }),
                { status: 200 },
            );
        });

        const result = await queryMaintenanceLogsSince(
            logger,
            'token',
            {
                action: 'quality_capture',
                sinceTs: '2026-08-20T00:00:00+08:00',
                sinceId: 0,
                order: 'asc',
            },
            2,
        );
        expect(result.ok).toBe(true);
        expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(urls).toHaveLength(2);
        expect(urls[1]).toContain('afterId=2');
    });

    it('stops on query error and keeps partial rows', async () => {
        let calls = 0;
        const logger = makeFakeFetcher(() => {
            calls += 1;
            if (calls === 1) {
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
                                action: 'quality_capture',
                                target: 't',
                                tech: 'workflow',
                                trace_id: 't',
                            },
                        ],
                        nextAfterId: 1,
                    }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ error: 'db down' }), { status: 500 });
        });

        const result = await queryMaintenanceLogsSince(
            logger,
            'token',
            { action: 'quality_capture', sinceTs: '2026-08-20T00:00:00+08:00', order: 'asc' },
            1,
        );
        expect(result.ok).toBe(false);
        expect(result.rows).toHaveLength(1);
        expect(result.error).toContain('db down');
    });
});
