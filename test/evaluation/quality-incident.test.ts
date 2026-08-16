import { describe, expect, it } from 'vitest';
import {
    aggregateQualityClusters,
    buildClusterKey,
    evaluateQualityIncident,
    formatClusterAlertMarkdown,
    normalizeQualityIncident,
    reconstructQualityChain,
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
        expect(validateQualityDiagnosis({
            rootCause: '',
            suspectedLayer: 'summarize',
            isBug: true,
            expectedLog: 'x',
            recommendation: 'y',
        }).ok).toBe(false);
    });
});
