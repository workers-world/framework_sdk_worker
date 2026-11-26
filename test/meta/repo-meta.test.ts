import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRepoMeta, REPO_META_FILENAME, REPO_META_TYPES } from '../../src/meta/repo-meta.js';

/** 权威 fixtures：ww/scripts/repo-meta.mjs 轻实现跑同一组（副本同步义务见文件头注） */
const FIXTURES = JSON.parse(
    readFileSync(
        join(fileURLToPath(new URL('.', import.meta.url)), 'repo-meta.fixtures.json'),
        'utf8',
    ),
);

describe('meta/repo-meta 契约', () => {
    it('文件名与类型枚举', () => {
        expect(REPO_META_FILENAME).toBe('.ww-repo.json');
        expect(REPO_META_TYPES).toContain('worker');
        expect(REPO_META_TYPES).toContain('sdk');
        expect(REPO_META_TYPES).toContain('action');
    });

    it('valid fixtures 全过（含 npm 去空白、deps、pipes）', () => {
        for (const f of FIXTURES.valid) {
            const r = parseRepoMeta(f.raw);
            expect(r.ok, `${f.name} 应合法`).toBe(true);
            if (r.ok) {
                expect(r.meta, f.name).toEqual(f.parsed);
            }
        }
    });

    it('invalid fixtures 全拒且 reason 带文件名与定位线索', () => {
        for (const f of FIXTURES.invalid) {
            const r = parseRepoMeta(f.raw);
            expect(r.ok, `${f.name} 应拒绝`).toBe(false);
            if (!r.ok) {
                expect(r.reason, f.name).toContain(REPO_META_FILENAME);
                expect(r.reason, f.name).toContain(f.reasonContains);
            }
        }
    });
});
