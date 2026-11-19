import { describe, expect, it } from 'vitest';
import { isWorkerIoTerminal } from '../../src/io/envelope.js';
import {
    anyGateBlocksSuccess,
    bindReceiptEvidence,
    createOfficialReceiptEnvelope,
    evidenceShaMatches,
    isOfficialReceiptTerminalStatus,
    normalizeCommitSha,
    officialReceiptIdempotencyKey,
    RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH,
    STREAM_OFFICIAL_RECEIPT,
    TYPE_RECEIPT_PROGRESS,
    TYPE_RECEIPT_TERMINAL,
} from '../../src/io/receipt.js';

describe('official receipt contract', () => {
    const fullSha = 'abcdef0123456789abcdef0123456789abcdef01';
    const shortSha = 'abcdef0';

    it('normalizes and matches SHA / prefix', () => {
        expect(normalizeCommitSha(` ${fullSha.toUpperCase()} `)).toBe(fullSha);
        expect(evidenceShaMatches(fullSha, fullSha)).toBe(true);
        expect(evidenceShaMatches(fullSha, shortSha)).toBe(true);
        expect(evidenceShaMatches(shortSha, fullSha)).toBe(true);
        expect(evidenceShaMatches(fullSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false);
        expect(evidenceShaMatches(fullSha, '')).toBe(false);
        expect(evidenceShaMatches(fullSha, 'abc')).toBe(false);
    });

    it('bindReceiptEvidence fails closed on mismatch', () => {
        const ok = bindReceiptEvidence(fullSha, {
            source: 'cloudflare_builds',
            sha: fullSha,
            observedAt: '2026-11-19T00:00:00.000Z',
            buildUuid: 'b1',
        });
        expect(ok.ok).toBe(true);

        const bad = bindReceiptEvidence(fullSha, {
            source: 'cloudflare_builds',
            sha: '1111111111111111111111111111111111111111',
            observedAt: '2026-11-19T00:00:00.000Z',
        });
        expect(bad.ok).toBe(false);
        if (!bad.ok) {
            expect(bad.code).toBe(RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH);
        }
    });

    it('gates block success', () => {
        expect(anyGateBlocksSuccess({ hold: true })).toBe(true);
        expect(anyGateBlocksSuccess({ redCi: true })).toBe(true);
        expect(anyGateBlocksSuccess({})).toBe(false);
        expect(isOfficialReceiptTerminalStatus('waiting')).toBe(false);
        expect(isOfficialReceiptTerminalStatus('succeeded')).toBe(true);
        expect(isOfficialReceiptTerminalStatus('timeout')).toBe(true);
    });

    it('createOfficialReceiptEnvelope marks terminal and stream', () => {
        const waiting = createOfficialReceiptEnvelope({
            id: 'r1',
            source: '/workers/deploy-tracker/release-watch',
            wwsummary: 'waiting',
            data: {
                kind: 'release',
                repoId: 'sch1',
                targetSha: fullSha,
                runId: 'run-1',
                status: 'waiting',
            },
        });
        expect(waiting.type).toBe(TYPE_RECEIPT_PROGRESS);
        expect(waiting.wwstream).toBe(STREAM_OFFICIAL_RECEIPT);
        expect(isWorkerIoTerminal(waiting)).toBe(false);

        const done = createOfficialReceiptEnvelope({
            id: 'r2',
            source: '/workers/deploy-tracker/release-watch',
            wwsummary: 'live',
            data: {
                kind: 'release',
                repoId: 'sch1',
                targetSha: fullSha,
                runId: 'run-1',
                status: 'succeeded',
                evidence: {
                    source: 'cloudflare_builds',
                    sha: fullSha,
                    observedAt: '2026-11-19T00:00:00.000Z',
                    buildUuid: 'bu',
                    versionId: 'ver',
                    allocationPercent: 100,
                    deployCommand: 'npm run deploy:cf',
                },
            },
        });
        expect(done.type).toBe(TYPE_RECEIPT_TERMINAL);
        expect(isWorkerIoTerminal(done)).toBe(true);
        expect(done.data?.status).toBe('succeeded');
    });

    it('downgrades succeeded when gates or SHA mismatch', () => {
        const gated = createOfficialReceiptEnvelope({
            id: 'r3',
            source: '/workers/x',
            data: {
                kind: 'release',
                repoId: 'sch1',
                targetSha: fullSha,
                runId: 'run-2',
                status: 'succeeded',
                gates: { hold: true },
                evidence: {
                    source: 'cf',
                    sha: fullSha,
                    observedAt: '2026-11-19T00:00:00.000Z',
                },
            },
        });
        expect(gated.data?.status).toBe('failed');
        expect(gated.data?.failureClass).toBe('hold');
        expect(gated.wwerror?.code).toBe('GATE_BLOCKED');

        const mismatch = createOfficialReceiptEnvelope({
            id: 'r4',
            source: '/workers/x',
            data: {
                kind: 'box_test',
                repoId: 'mok1',
                targetSha: fullSha,
                runId: 'run-3',
                status: 'succeeded',
                evidence: {
                    source: 'dly2',
                    sha: '2222222222222222222222222222222222222222',
                    observedAt: '2026-11-19T00:00:00.000Z',
                    jobId: 'DLY220261119000001',
                },
            },
        });
        expect(mismatch.data?.status).toBe('failed');
        expect(mismatch.data?.failureClass).toBe('evidence_sha_mismatch');
        expect(mismatch.wwerror?.code).toBe(RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH);
    });

    it('idempotency key is stable', () => {
        expect(officialReceiptIdempotencyKey('sch1', fullSha.toUpperCase(), 'r1')).toBe(
            `sch1:${fullSha}:r1`,
        );
    });
});
