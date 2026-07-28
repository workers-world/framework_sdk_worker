/**
 * decision-desk 信号队列 envelope：invest-rss / advisor → Q_DESK_SIGNAL → decision-desk buffer。
 */

export type DeskSignalInvestEvent = {
  type: 'invest_event';
  eventId: string;
  underlying: string;
  importance: number;
  title: string;
  link: string;
  feedName: string;
  category: string;
  tags: string[];
  aiSummary: string | null;
  createdAt: number;
  marketRegion?: string | null;
};

export type DeskSignalAdviceLead = {
  type: 'advice_lead';
  adviceId: number;
  underlying: string;
  action: 'watch' | 'research' | 'risk_note';
  rationale: string;
  confidence: number;
  sourceId: string;
  name?: string;
};

export type DeskSignal = DeskSignalInvestEvent | DeskSignalAdviceLead;

/** signal_buffer 幂等键：invest 一事件一条；advice 按 underlying 区分多 recommendation */
export function buildDeskSignalId(signal: DeskSignal): string {
  if (signal.type === 'invest_event') {
    return `event:${signal.eventId}`;
  }
  return `advice:${signal.adviceId}:${signal.underlying}`;
}

export function deskSignalImportance(signal: DeskSignal): number {
  if (signal.type === 'invest_event') return signal.importance;
  return signal.confidence;
}

export function isDeskSignal(value: unknown): value is DeskSignal {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  if (t === 'invest_event') {
    const s = value as DeskSignalInvestEvent;
    return typeof s.eventId === 'string'
      && typeof s.underlying === 'string'
      && typeof s.importance === 'number';
  }
  if (t === 'advice_lead') {
    const s = value as DeskSignalAdviceLead;
    return typeof s.adviceId === 'number'
      && typeof s.underlying === 'string'
      && typeof s.confidence === 'number'
      && typeof s.action === 'string'
      && typeof s.rationale === 'string'
      && typeof s.sourceId === 'string';
  }
  return false;
}
