/**
 * analysis-engine 信号队列 envelope：invest-rss / advisor → Q_ANALYSIS → analysis-engine-worker。
 * 与 desk-signal 共享语义子集但独立类型：invest_event 不要求 underlying（分析流更宽）。
 */

export type AnalysisSignalInvestEvent = {
    type: 'invest_event';
    eventId: string;
    underlying?: string;
    importance: number;
    title: string;
    tags: string[];
    aiSummary: string | null;
    category?: string;
    createdAt: number;
    /** 旁路投递操作关联 ID */
    traceId?: string;
};

export type AnalysisSignalAdviceLead = {
    type: 'advice_lead';
    adviceId: number;
    underlying: string;
    action: 'watch' | 'research' | 'risk_note';
    rationale: string;
    confidence: number;
    sourceId: string;
    name?: string;
    traceId?: string;
};

export type AnalysisSignal = AnalysisSignalInvestEvent | AnalysisSignalAdviceLead;

/** evidence_log 幂等键：invest 一事件一条；advice 按 underlying 区分多 recommendation */
export function buildAnalysisSignalId(signal: AnalysisSignal): string {
    if (signal.type === 'invest_event') {
        return `event:${signal.eventId}`;
    }
    return `advice:${signal.adviceId}:${signal.underlying}`;
}

export function analysisSignalImportance(signal: AnalysisSignal): number {
    if (signal.type === 'invest_event') {
        return signal.importance;
    }
    return signal.confidence;
}

function isOptionalTraceId(value: unknown): boolean {
    return value === undefined || (typeof value === 'string' && value.length > 0);
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

export function isAnalysisSignal(value: unknown): value is AnalysisSignal {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const t = (value as { type?: unknown }).type;
    if (t === 'invest_event') {
        const s = value as AnalysisSignalInvestEvent;
        return (
            typeof s.eventId === 'string' &&
            isOptionalString(s.underlying) &&
            typeof s.importance === 'number' &&
            typeof s.title === 'string' &&
            Array.isArray(s.tags) &&
            (s.aiSummary === null || typeof s.aiSummary === 'string') &&
            isOptionalString(s.category) &&
            typeof s.createdAt === 'number' &&
            isOptionalTraceId(s.traceId)
        );
    }
    if (t === 'advice_lead') {
        const s = value as AnalysisSignalAdviceLead;
        return (
            typeof s.adviceId === 'number' &&
            typeof s.underlying === 'string' &&
            (s.action === 'watch' || s.action === 'research' || s.action === 'risk_note') &&
            typeof s.rationale === 'string' &&
            typeof s.confidence === 'number' &&
            typeof s.sourceId === 'string' &&
            isOptionalString(s.name) &&
            isOptionalTraceId(s.traceId)
        );
    }
    return false;
}
