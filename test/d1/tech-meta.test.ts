import {describe, expect, it} from 'vitest';
import {buildTechInsert, buildTechUpdate, shanghaiTechTime} from '../../src/d1/tech-meta.js';

describe('tech-meta', () => {
    it('buildTechInsert sets version 1 and matching timestamps', () => {
        const row = buildTechInsert('trace-1', 'user@example.com');
        expect(row.tech_version).toBe(1);
        expect(row.tech_business_id).toBe('user@example.com');
        expect(row.tech_trace_id).toBe('trace-1');
        expect(row.tech_create_time).toBe(row.tech_update_time);
        expect(row.tech_create_time).toMatch(/^\d{14}$/);
    });

    it('buildTechUpdate increments version and refreshes update time', () => {
        const existing = buildTechInsert('trace-1', 'user@example.com');
        const updated = buildTechUpdate(existing, 'trace-2');
        expect(updated.tech_version).toBe(2);
        expect(updated.tech_business_id).toBe(existing.tech_business_id);
        expect(updated.tech_create_time).toBe(existing.tech_create_time);
        expect(updated.tech_trace_id).toBe('trace-2');
        expect(updated.tech_update_time.length).toBe(14);
    });

    it('shanghaiTechTime returns 14-digit timestamp', () => {
        expect(shanghaiTechTime(new Date('2026-07-18T15:04:05Z'))).toBe('20260718230405');
    });
});
