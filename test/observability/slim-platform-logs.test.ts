import { describe, expect, it } from 'vitest';
import type { WorkersPlatformLogEvent } from '../../src/observability/platform-log.js';
import { slimPlatformLogsForAnalysis } from '../../src/observability/slim-platform-logs.js';

describe('slimPlatformLogsForAnalysis', () => {
    it('保留 quality/summarize 相关行并截断', () => {
        const events: WorkersPlatformLogEvent[] = [
            { message: 'unrelated health ping' },
            {
                message: 'summary decision because=thin_snippet path=title_only',
                timestamp: '2026-08-24T00:00:00Z',
                $metadata: { service: 'email-rule-worker', level: 'info' },
            },
            { message: 'fetch browser ok chain=browser:ok' },
        ];
        const slim = slimPlatformLogsForAnalysis(events);
        expect(slim).toHaveLength(2);
        expect(slim[0].message).toContain('thin_snippet');
        expect(slim[0].service).toBe('email-rule-worker');
    });

    it('空输入返回空数组', () => {
        expect(slimPlatformLogsForAnalysis([])).toEqual([]);
    });
});
