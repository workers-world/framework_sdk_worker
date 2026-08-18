import { describe, expect, it } from 'vitest';
import {
    analysisSignalImportance,
    buildAnalysisSignalId,
    isAnalysisSignal,
} from '../../src/analysis/analysis-signal.js';

const baseEvent = {
    type: 'invest_event' as const,
    eventId: 'e1',
    importance: 8,
    title: 't',
    tags: [],
    aiSummary: null,
    createdAt: 1,
};

const baseAdvice = {
    type: 'advice_lead' as const,
    adviceId: 42,
    underlying: 'AAPL',
    action: 'watch' as const,
    rationale: 'r',
    confidence: 0.8,
    sourceId: 's1',
};

describe('analysis-signal', () => {
    it('builds event signal_id without underlying', () => {
        expect(buildAnalysisSignalId(baseEvent)).toBe('event:e1');
    });

    it('builds advice signal_id with underlying', () => {
        expect(buildAnalysisSignalId(baseAdvice)).toBe('advice:42:AAPL');
    });

    it('returns importance for event / confidence for advice', () => {
        expect(analysisSignalImportance(baseEvent)).toBe(8);
        expect(analysisSignalImportance(baseAdvice)).toBe(0.8);
    });

    it('accepts invest_event with optional fields absent', () => {
        expect(isAnalysisSignal(baseEvent)).toBe(true);
        expect(isAnalysisSignal({ ...baseEvent, underlying: 'GLD', category: 'macro' })).toBe(true);
    });

    it('accepts advice_lead', () => {
        expect(isAnalysisSignal(baseAdvice)).toBe(true);
        expect(isAnalysisSignal({ ...baseAdvice, name: 'x', traceId: 't1' })).toBe(true);
    });

    it('rejects missing required fields', () => {
        expect(isAnalysisSignal({ ...baseEvent, eventId: undefined })).toBe(false);
        expect(isAnalysisSignal({ ...baseEvent, importance: '8' })).toBe(false);
        expect(isAnalysisSignal({ ...baseEvent, tags: 'gold' })).toBe(false);
        expect(isAnalysisSignal({ ...baseEvent, aiSummary: 3 })).toBe(false);
        expect(isAnalysisSignal({ ...baseAdvice, adviceId: '42' })).toBe(false);
        expect(isAnalysisSignal({ ...baseAdvice, underlying: undefined })).toBe(false);
    });

    it('rejects non-enum action', () => {
        expect(isAnalysisSignal({ ...baseAdvice, action: 'buy' })).toBe(false);
        expect(isAnalysisSignal({ ...baseAdvice, action: 'other' })).toBe(false);
    });

    it('rejects unknown type and non-objects', () => {
        expect(isAnalysisSignal(null)).toBe(false);
        expect(isAnalysisSignal('x')).toBe(false);
        expect(isAnalysisSignal({ type: 'other' })).toBe(false);
    });

    it('rejects empty traceId string', () => {
        expect(isAnalysisSignal({ ...baseEvent, traceId: '' })).toBe(false);
    });
});
