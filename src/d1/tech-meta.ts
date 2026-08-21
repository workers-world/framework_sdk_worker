import { shanghaiTechTime } from '../time.js';

/** 仓库标准 tech_* 审计字段 */
export interface TechMetaRow {
    tech_version: number;
    tech_business_id: string;
    tech_create_time: string;
    tech_update_time: string;
    tech_trace_id: string;
}

export { shanghaiTechTime };

export function newTraceId(): string {
    return crypto.randomUUID();
}

export function buildTechInsert(traceId: string, businessId: string): TechMetaRow {
    const now = shanghaiTechTime();
    return {
        tech_version: 1,
        tech_business_id: businessId,
        tech_create_time: now,
        tech_update_time: now,
        tech_trace_id: traceId,
    };
}

export function buildTechUpdate(existing: TechMetaRow, traceId: string): TechMetaRow {
    return {
        tech_version: existing.tech_version + 1,
        tech_business_id: existing.tech_business_id,
        tech_create_time: existing.tech_create_time,
        tech_update_time: shanghaiTechTime(),
        tech_trace_id: traceId,
    };
}
