import { describe, expect, it, vi } from 'vitest';
import {
    aggregateQualityClusters,
    buildClusterKey,
    emitQualityIncident,
    evaluateQualityIncident,
    formatClusterAlertMarkdown,
    formatQualityCaptureDigestCsv,
    formatQualityCaptureDigestMarkdown,
    formatQualityTicketMarkdown,
    normalizeQualityIncident,
    reconstructQualityChain,
    shouldCaptureQualityIncident,
    validateQualityDiagnosis,
} from '../../src/evaluation/quality-incident.js';

/** USGS 案例：browser 成功但 nav_shell_body title-only（修复前应 hard 告警） */
const usgsIncident = normalizeQualityIncident({
    service: 'email-rule-worker',
    kind: 'summary.title_only',
    because: 'nav_shell_body',
    dedupKey: 'hn:<2CB56CEF-D17B-401A-9F56-185580D48BE7.29@mx.sendamatic.net>',
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000tkt2/executive',
    ruleId: 'hacker-news',
    fields: {
        bodyLen: 5917,
        urlKind: 'other',
        fetchFailed: false,
        path: 'title_only',
        summary: 'title_only',
        fallback: true,
        chain: 'bare:discarded→browser:ok',
    },
});

describe('evaluateQualityIncident', () => {
    it('flags USGS nav_shell after successful fetch as hard', () => {
        const result = evaluateQualityIncident(usgsIncident);
        expect(result.pass).toBe(false);
        expect(result.severity).toBe('hard');
        expect(result.ruleId).toBe('quality.nav-shell-after-fetch-ok');
    });

    it('silences expected video_link title_only', () => {
        const result = evaluateQualityIncident(
            normalizeQualityIncident({
                service: 'email-rule-worker',
                kind: 'summary.title_only',
                because: 'video_link',
                fields: { fetchFailed: true },
            }),
        );
        expect(result.pass).toBe(true);
        expect(result.severity).toBe('silent');
    });

    it('flags fetch ok but title_only chain contradiction', () => {
        const result = evaluateQualityIncident(
            normalizeQualityIncident({
                service: 'email-rule-worker',
                kind: 'summary.title_only',
                because: 'thin_snippet',
                url: 'https://example.com',
                fields: {
                    chain: 'bare:discarded→browser:ok',
                    summary: 'title_only',
                    path: 'title_only',
                    fetchFailed: true,
                },
            }),
        );
        expect(result.pass).toBe(false);
        expect(result.ruleId).toBe('quality.fetch-ok-but-title-only');
    });
});

describe('shouldCaptureQualityIncident', () => {
    it('skips summary.llm usable_body happy path', () => {
        expect(
            shouldCaptureQualityIncident({
                service: 'email-rule-worker',
                kind: 'summary.llm',
                because: 'usable_body',
                url: 'https://finance.yahoo.com/news/foo',
                fields: { fetchFailed: false, path: 'llm', bodyLen: 6001 },
            }),
        ).toBe(false);
    });

    it('captures title_only thin_snippet', () => {
        expect(
            shouldCaptureQualityIncident({
                service: 'email-rule-worker',
                kind: 'summary.title_only',
                because: 'thin_snippet',
                url: 'https://example.com/long-article',
                fields: { fetchFailed: true, path: 'title_only', urlKind: 'other' },
            }),
        ).toBe(true);
    });

    it('skips silentBecause video_link', () => {
        expect(
            shouldCaptureQualityIncident({
                service: 'email-rule-worker',
                kind: 'summary.title_only',
                because: 'video_link',
                fields: { fetchFailed: true },
            }),
        ).toBe(false);
    });

    it('captures invest-chain LLM failures as hard', () => {
        expect(
            shouldCaptureQualityIncident({
                service: 'invest-rss-worker',
                kind: 'llm.enrich',
                because: 'llm_failed',
                fields: { error: '校验失败' },
            }),
        ).toBe(true);
        expect(
            evaluateQualityIncident(
                normalizeQualityIncident({
                    service: 'advisor-worker',
                    kind: 'llm.advisor',
                    because: 'validation_failed',
                    fields: {},
                }),
            ).severity,
        ).toBe('hard');
    });

    it('captures invest fetch quality_rejected', () => {
        expect(
            shouldCaptureQualityIncident({
                service: 'invest-rss-worker',
                kind: 'fetch.invest',
                because: 'quality_rejected',
                fields: { fetchFailed: true },
            }),
        ).toBe(true);
    });

    it('emitQualityIncident skips pass=true and missing queue', async () => {
        const send = vi.fn();
        await emitQualityIncident(undefined, {
            service: 'invest-rss-worker',
            kind: 'llm.enrich',
            because: 'llm_failed',
            fields: {},
        });
        await emitQualityIncident(
            { send },
            {
                service: 'email-rule-worker',
                kind: 'summary.llm',
                because: 'usable_body',
                fields: { fetchFailed: false, path: 'llm' },
            },
        );
        expect(send).not.toHaveBeenCalled();
        await emitQualityIncident(
            { send },
            {
                service: 'invest-rss-worker',
                kind: 'llm.enrich',
                because: 'llm_failed',
                fields: {},
            },
        );
        expect(send).toHaveBeenCalledOnce();
    });
});

describe('aggregateQualityClusters', () => {
    it('groups incidents by clusterKey', () => {
        const clusters = aggregateQualityClusters([usgsIncident, usgsIncident]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.count).toBe(2);
        expect(clusters[0]?.severity).toBe('hard');
    });
});

describe('buildClusterKey', () => {
    it('includes host suffix', () => {
        expect(buildClusterKey(usgsIncident)).toContain('usgs.gov');
    });
});

describe('normalizeQualityIncident', () => {
    it('passes through invocationId fields', () => {
        const incident = normalizeQualityIncident({
            service: 'email-rule-worker',
            kind: 'summary.llm',
            because: 'usable_body',
            dedupKey: 'hn:test',
            invocationId: 'consumer-inv',
            emailInvocationId: 'email-inv',
            url: 'https://example.com/article',
            fields: { bodyLen: 100 },
        });
        expect(incident.invocationId).toBe('consumer-inv');
        expect(incident.emailInvocationId).toBe('email-inv');
    });
});

describe('reconstructQualityChain', () => {
    it('orders events by ts', () => {
        const chain = reconstructQualityChain([
            normalizeQualityIncident({
                service: 'email-rule-worker',
                kind: 'fetch.browser',
                because: 'ok',
                ts: '2026-08-15T02:34:29.000Z',
                fields: { bodyLen: 5917 },
            }),
            usgsIncident,
        ]);
        expect(chain).toHaveLength(2);
        expect(chain[0]?.label).toBe('fetch.browser');
    });
});

describe('formatClusterAlertMarkdown', () => {
    it('includes sample url', () => {
        const md = formatClusterAlertMarkdown(aggregateQualityClusters([usgsIncident]));
        expect(md).toContain('usgs.gov');
        expect(md).toContain('nav_shell_body');
    });
});

describe('validateQualityDiagnosis', () => {
    it('requires all fields', () => {
        expect(
            validateQualityDiagnosis({
                rootCause: '',
                suspectedLayer: 'summarize',
                isBug: true,
                expectedLog: 'x',
                recommendation: 'y',
            }).ok,
        ).toBe(false);
        expect(
            validateQualityDiagnosis({
                rootCause: 'r',
                suspectedLayer: '',
                isBug: true,
                expectedLog: 'x',
                recommendation: 'y',
            }).reason,
        ).toBe('缺少 suspectedLayer');
        expect(
            validateQualityDiagnosis({
                rootCause: 'r',
                suspectedLayer: 's',
                isBug: true,
                expectedLog: '  ',
                recommendation: 'y',
            }).reason,
        ).toBe('缺少 expectedLog');
        expect(
            validateQualityDiagnosis({
                rootCause: 'r',
                suspectedLayer: 's',
                isBug: true,
                expectedLog: 'x',
                recommendation: '',
            }).reason,
        ).toBe('缺少 recommendation');
        expect(
            validateQualityDiagnosis(
                {
                    rootCause: 'r',
                    suspectedLayer: 's',
                    isBug: true,
                    expectedLog: 'x',
                    recommendation: 'y',
                },
                { requireSuspectedFiles: true },
            ).reason,
        ).toBe('缺少 suspectedFiles');
        expect(
            validateQualityDiagnosis(
                {
                    rootCause: 'r',
                    suspectedLayer: 's',
                    isBug: true,
                    expectedLog: 'x',
                    recommendation: 'y',
                    suspectedFiles: ['src/a.ts'],
                },
                { requireSuspectedFiles: true },
            ),
        ).toEqual({ ok: true });
    });
});

describe('formatQualityTicketMarkdown', () => {
    it('renders cluster chain and diagnosis including optional fields', () => {
        const clusters = aggregateQualityClusters([usgsIncident]);
        const cluster = clusters[0];
        expect(cluster).toBeDefined();
        if (!cluster) {
            return;
        }
        const chain = reconstructQualityChain([usgsIncident]);
        const withUrl = formatQualityTicketMarkdown(cluster, chain, {
            rootCause: 'nav shell',
            suspectedLayer: 'summarize',
            isBug: true,
            expectedLog: 'usable_body',
            recommendation: 'soft keep',
        });
        expect(withUrl).toContain('# 质量监管工单');
        expect(withUrl).toContain(cluster.clusterKey);
        expect(withUrl).toContain('usgs.gov');
        expect(withUrl).toContain('是否 bug：是');

        const bare = formatQualityTicketMarkdown(
            {
                ...cluster,
                sampleUrl: undefined,
                sampleDedupKey: undefined,
            },
            chain,
            {
                rootCause: 'x',
                suspectedLayer: 'y',
                isBug: false,
                expectedLog: 'z',
                recommendation: 'n',
            },
        );
        expect(bare).toContain('是否 bug：否');
        expect(bare).not.toContain('- URL：');
        expect(bare).not.toContain('- dedupKey：');
    });
});

describe('formatQualityCaptureDigestMarkdown', () => {
    it('renders empty window note without attachment hints', () => {
        const md = formatQualityCaptureDigestMarkdown([], {
            digestYmd: '2026-08-22',
            baselineTs: '2026-08-20T00:00:00+08:00',
            baselineLogId: 0,
        });
        expect(md).toContain('质量日志日报');
        expect(md).toContain('无新的 quality_capture');
        expect(md).toContain('无附件');
        expect(md).not.toContain('quality-captures-');
        expect(md).not.toContain('quality-logs-');
        expect(md).toContain('logId > 0');
    });

    it('短摘要指向 csv 附件', () => {
        const items = [
            {
                dedupKey: 'dedup-1',
                service: 'email-rule-worker',
                ts: '2026-08-21T10:00:00+08:00',
                because: 'title_only',
                logsCaptured: true,
                logFileCount: 1,
                eventCount: 3,
                url: 'https://example.com',
            },
        ];
        const window = {
            digestYmd: '2026-08-22',
            baselineTs: '2026-08-20T00:00:00+08:00',
            baselineLogId: 5,
        };
        const md = formatQualityCaptureDigestMarkdown(items, window);
        expect(md).not.toContain('## dedup-1');
        expect(md).toContain('quality-captures-2026-08-22.csv');
        expect(md).toContain('quality-logs-2026-08-22-part');

        const csv = formatQualityCaptureDigestCsv(items);
        expect(csv).toContain('dedup-1');
        expect(csv).toContain('title_only');

        const escaped = formatQualityCaptureDigestCsv([
            {
                dedupKey: 'k,"1"',
                service: 'svc',
                ts: 't',
                because: 'a,b\nline',
                logsCaptured: false,
                logFileCount: 0,
                eventCount: 0,
            },
        ]);
        expect(escaped).toContain('"k,""1"""');
        expect(escaped).toContain('"a,b\nline"');
    });
});
