/** Intake 统一事件信封（schemaVersion=1） */

export type IntakeSeverity = 'info' | 'warn' | 'error';

export interface IntakeLink {
    label: string;
    href: string;
}

export interface IntakeEventSource {
    /** 写入方 Worker 名：invest-rss-worker | orchestrator-worker | … */
    producer: string;
    /** 路由：映射 intake-routing.json → target repo */
    worker?: string;
    repo?: string;
}

export interface IntakeEvent {
    schemaVersion: 1;
    /** 稳定类型 id，见 sch1/rules/intake-kinds.json */
    kind: string;
    /** 全局幂等键；同事件重投不重复行 */
    dedupKey: string;
    source: IntakeEventSource;
    /** 列表标题（≤120 字） */
    title: string;
    /** 列表/详情摘要（纯文本，已脱敏） */
    summary: string;
    severity: IntakeSeverity;
    /** 上海墙钟或 ISO8601 */
    occurredAt: string;
    /** kind 专用 JSON；sch1 只存不解析业务逻辑（除 routing） */
    payload: Record<string, unknown>;
    links?: IntakeLink[];
}

export interface SubmitIntakeResult {
    ok: boolean;
    duplicate?: boolean;
    id?: number;
    error?: string;
    status?: number;
}
