import { describe, expect, it } from 'vitest';
import { parseRepoMeta, REPO_META_FILENAME, REPO_META_TYPES } from '../../src/meta/repo-meta.js';

describe('meta/repo-meta 契约', () => {
    it('文件名与类型枚举', () => {
        expect(REPO_META_FILENAME).toBe('.ww-repo.json');
        expect(REPO_META_TYPES).toContain('worker');
        expect(REPO_META_TYPES).toContain('sdk');
        expect(REPO_META_TYPES).toContain('action');
    });

    it('合法声明（含/不含 npm，npm 去空白）', () => {
        expect(parseRepoMeta('{"type":"worker"}')).toEqual({
            ok: true,
            meta: { type: 'worker' },
        });
        expect(parseRepoMeta('{"type":"sdk","npm":"@workers-world/framework_sdk_worker"}')).toEqual(
            {
                ok: true,
                meta: { type: 'sdk', npm: '@workers-world/framework_sdk_worker' },
            },
        );
        expect(parseRepoMeta('{"type":"action","npm":" @workers-world/worker-actions "}')).toEqual({
            ok: true,
            meta: { type: 'action', npm: '@workers-world/worker-actions' },
        });
    });

    it('非法输入逐一拒绝且 reason 带文件名', () => {
        for (const bad of [
            '',
            'not-json',
            '[]',
            '{}',
            '{"type":"bogus"}',
            '{"npm":"@workers-world/x"}',
            '{"type":"sdk","npm":""}',
        ]) {
            const r = parseRepoMeta(bad);
            expect(r.ok, `应拒绝: ${bad}`).toBe(false);
            if (!r.ok) {
                expect(r.reason).toContain(REPO_META_FILENAME);
            }
        }
    });
});
