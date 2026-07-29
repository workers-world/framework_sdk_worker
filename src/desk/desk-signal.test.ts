import { describe, expect, it } from 'vitest';
import { buildDeskSignalId, deskSignalImportance, isDeskSignal } from './desk-signal.js';

describe('desk-signal', () => {
  it('builds event signal_id', () => {
    expect(buildDeskSignalId({
      type: 'invest_event',
      eventId: 'e1',
      underlying: 'AAPL',
      importance: 9,
      title: 't',
      link: 'l',
      feedName: 'f',
      category: 'event',
      tags: [],
      aiSummary: null,
      createdAt: 1,
    })).toBe('event:e1');
  });

  it('builds advice signal_id with underlying', () => {
    const base = {
      type: 'advice_lead' as const,
      adviceId: 42,
      action: 'watch' as const,
      rationale: 'r',
      confidence: 0.8,
      sourceId: 's1',
    };
    expect(buildDeskSignalId({ ...base, underlying: 'MSFT' })).toBe('advice:42:MSFT');
    expect(buildDeskSignalId({ ...base, underlying: 'GOOG' })).toBe('advice:42:GOOG');
  });

  it('validates DeskSignal shape', () => {
    expect(isDeskSignal({ type: 'invest_event', eventId: 'e', underlying: 'X', importance: 1 })).toBe(true);
    expect(isDeskSignal({ type: 'invest_event', eventId: 'e', underlying: 'X', importance: 1, traceId: 't1' })).toBe(true);
    expect(isDeskSignal({ type: 'invest_event', eventId: 'e', underlying: 'X', importance: 1, traceId: '' })).toBe(false);
    expect(isDeskSignal({ type: 'advice_lead', adviceId: 1, underlying: 'X', confidence: 0.5 })).toBe(false);
    expect(isDeskSignal({
      type: 'advice_lead',
      adviceId: 1,
      underlying: 'X',
      confidence: 0.5,
      action: 'watch',
      rationale: 'r',
      sourceId: 's',
    })).toBe(true);
  });

  it('returns importance or confidence', () => {
    expect(deskSignalImportance({
      type: 'invest_event',
      eventId: 'e',
      underlying: 'X',
      importance: 9,
      title: '',
      link: '',
      feedName: '',
      category: '',
      tags: [],
      aiSummary: null,
      createdAt: 0,
    })).toBe(9);
    expect(deskSignalImportance({
      type: 'advice_lead',
      adviceId: 1,
      underlying: 'X',
      action: 'watch',
      rationale: '',
      confidence: 0.7,
      sourceId: 's',
    })).toBe(0.7);
  });
});
