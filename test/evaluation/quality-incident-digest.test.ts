import { describe, expect, it } from 'vitest';
import {
    appendQualityAnalysisDigestSection,
    formatQualityAnalysisDigestMarkdown,
    formatQualityCaptureDigestMarkdown,
    formatQualityCaptureDigestPartMarkdown,
} from '../../src/evaluation/quality-incident.js';

describe('quality capture digest extras', () => {
    it('annotates parts and truncation', () => {
        const md = formatQualityCaptureDigestMarkdown(
            [
                {
                    dedupKey: 'd',
                    service: 's',
                    ts: 't',
                    because: 'b',
                    logsCaptured: false,
                    logFileCount: 0,
                    eventCount: 0,
                },
            ],
            { digestYmd: '2026-09-15', baselineTs: 't0', baselineLogId: 1 },
            { partIndex: 1, partTotal: 3, truncated: true },
        );
        expect(md).toContain('分片：第 1/3 封');
        expect(md).toContain('体积上限');
    });

    it('formats continuation parts', () => {
        const first = formatQualityCaptureDigestPartMarkdown('2026-09-15', 2, 3);
        expect(first).toContain('质量日志日报（续）');
        expect(first).not.toContain('截断');
        const truncated = formatQualityCaptureDigestPartMarkdown('2026-09-15', 3, 3, true);
        expect(truncated).toContain('截断');
    });
});

describe('quality analysis digest', () => {
    it('returns empty for no items', () => {
        expect(formatQualityAnalysisDigestMarkdown([])).toBe('');
        expect(appendQualityAnalysisDigestSection('body', '  ')).toBe('body');
    });

    it('renders diagnosis items with optional fields', () => {
        const md = formatQualityAnalysisDigestMarkdown(
            [
                {
                    dedupKey: 'd1',
                    service: 'email-rule-worker',
                    ts: 't',
                    diagnosis: {
                        rootCause: 'timeout',
                        suspectedLayer: 'llm',
                        isBug: true,
                        expectedLog: 'e',
                        recommendation: 'retry',
                        suspectedFiles: ['src/a.ts'],
                    },
                    fixUrl: 'https://github.com/o/r/pull/1',
                },
                {
                    dedupKey: 'd2',
                    service: 's',
                    ts: 't',
                    diagnosis: {
                        rootCause: 'ok',
                        suspectedLayer: 'unknown',
                        isBug: false,
                        expectedLog: 'e',
                        recommendation: 'n/a',
                    },
                },
            ],
            { partIndex: 2, partTotal: 3 },
        );
        expect(md).toContain('自动诊断');
        expect(md).toContain('part 2/3');
        expect(md).toContain('嫌疑文件：src/a.ts');
        expect(md).toContain('确认修复');
        expect(md).toContain('是否 bug：否');
        expect(md).not.toMatch(/d2[\s\S]*确认修复/);

        const merged = appendQualityAnalysisDigestSection('# capture\n', md);
        expect(merged).toContain('# capture');
        expect(merged).toContain('自动诊断');
    });
});
