/**
 * 官方回执契约（WW-915）：主 bot 只触发、收回执。
 * 本轮接线 kind=release|box_test；routine|live_check 仅预留类型。
 */
import {
    type CreateWorkerIoInput,
    createWorkerIoEnvelope,
    type WorkerIoEnvelope,
    type WorkerIoError,
} from './envelope.js';

export type OfficialReceiptKind = 'release' | 'box_test' | 'routine' | 'live_check';

export type OfficialReceiptStatus = 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'waiting';

export type OfficialReceiptFailureClass =
    | 'test_fail'
    | 'infra_error'
    | 'incomplete'
    | 'timeout'
    | 'hold'
    | 'red_ci'
    | 'builds_failed'
    | 'allocation_not_full'
    | 'evidence_sha_mismatch'
    | 'cancelled'
    | 'verify_failed';

export type OfficialReceiptGates = {
    hold?: boolean;
    redCi?: boolean;
    firstRelease?: boolean;
    humanStop?: boolean;
};

export type OfficialReceiptEvidence = {
    /** 官方来源，如 github_api / cloudflare_builds / dly2 */
    source: string;
    /** 证据绑定的 commit SHA（须与 targetSha 一致才可信） */
    sha?: string | null;
    observedAt: string;
    prNumber?: number | null;
    prUrl?: string | null;
    buildUuid?: string | null;
    versionId?: string | null;
    versionNumber?: string | null;
    deploymentId?: string | null;
    allocationPercent?: number | null;
    deployCommand?: string | null;
    jobId?: string | null;
    logUrl?: string | null;
    trigger?: 'auto' | 'manual' | null;
    failureSummary?: string | null;
    detailUrl?: string | null;
};

export type OfficialReceiptData = {
    kind: OfficialReceiptKind;
    repoId: string;
    targetSha: string;
    /** 幂等键；重复触发应返回同一 runId */
    runId: string;
    status: OfficialReceiptStatus;
    evidence?: OfficialReceiptEvidence;
    gates?: OfficialReceiptGates;
    failureClass?: OfficialReceiptFailureClass | null;
    /** 领域附加（release 的 pipeline 摘要、box_test 的 steps 等） */
    extras?: Record<string, unknown>;
};

export const STREAM_OFFICIAL_RECEIPT = 'workers-world.official_receipt' as const;

export const TYPE_RECEIPT_PROGRESS = 'workers-world.receipt.progress' as const;
export const TYPE_RECEIPT_TERMINAL = 'workers-world.receipt.terminal' as const;

export const RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH = 'EVIDENCE_SHA_MISMATCH' as const;

/** 归一化 SHA 再比较（允许短 SHA 前缀匹配仅当双方长度不等且一方是另一方前缀）。 */
export function normalizeCommitSha(sha: string | null | undefined): string {
    return (sha ?? '').trim().toLowerCase();
}

/**
 * 证据 SHA 必须对应本次 targetSha。
 * 双方皆非空且规范化后相等（或一方为另一方前缀且较短方 ≥7）才通过。
 */
export function evidenceShaMatches(
    targetSha: string | null | undefined,
    evidenceSha: string | null | undefined,
): boolean {
    const target = normalizeCommitSha(targetSha);
    const evidence = normalizeCommitSha(evidenceSha);
    if (!target || !evidence) {
        return false;
    }
    if (target === evidence) {
        return true;
    }
    const shorter = target.length <= evidence.length ? target : evidence;
    const longer = target.length > evidence.length ? target : evidence;
    return shorter.length >= 7 && longer.startsWith(shorter);
}

export type BindEvidenceResult =
    | { ok: true; evidence: OfficialReceiptEvidence }
    | {
          ok: false;
          code: typeof RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH;
          message: string;
          evidence: OfficialReceiptEvidence;
      };

/** 绑定并校验 evidence.sha；失败时仍返回带 evidence 的结构供调用方写 failed 回执。 */
export function bindReceiptEvidence(
    targetSha: string,
    evidence: OfficialReceiptEvidence,
): BindEvidenceResult {
    if (evidenceShaMatches(targetSha, evidence.sha)) {
        return { ok: true, evidence };
    }
    return {
        ok: false,
        code: RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH,
        message: `evidence sha ${evidence.sha ?? '(missing)'} does not match target ${targetSha}`,
        evidence,
    };
}

export function isOfficialReceiptTerminalStatus(status: OfficialReceiptStatus): boolean {
    return status !== 'waiting';
}

export function anyGateBlocksSuccess(gates: OfficialReceiptGates | null | undefined): boolean {
    if (!gates) {
        return false;
    }
    return Boolean(gates.hold || gates.redCi || gates.firstRelease || gates.humanStop);
}

export type CreateOfficialReceiptInput = {
    id: string;
    source: string;
    data: OfficialReceiptData;
    wwsummary?: string;
    wwerror?: WorkerIoError;
    time?: string;
    traceparent?: string;
    tracestate?: string;
};

/**
 * 构造官方回执信封。status≠waiting 时自动 wwterminal。
 * 若 gates 阻塞成功且 status 为 succeeded，降级为 failed + hold。
 */
export function createOfficialReceiptEnvelope(
    input: CreateOfficialReceiptInput,
): WorkerIoEnvelope<OfficialReceiptData> {
    let data = { ...input.data };
    let wwerror = input.wwerror;

    if (data.status === 'succeeded' && anyGateBlocksSuccess(data.gates)) {
        data = {
            ...data,
            status: 'failed',
            failureClass: data.failureClass ?? 'hold',
        };
        wwerror = wwerror ?? {
            code: 'GATE_BLOCKED',
            message: 'hold / redCi / firstRelease / humanStop blocks success',
            details: data.gates,
        };
    }

    if (
        data.status === 'succeeded' &&
        data.evidence &&
        !evidenceShaMatches(data.targetSha, data.evidence.sha)
    ) {
        data = {
            ...data,
            status: 'failed',
            failureClass: 'evidence_sha_mismatch',
        };
        wwerror = wwerror ?? {
            code: RECEIPT_ERROR_EVIDENCE_SHA_MISMATCH,
            message: `evidence sha does not match target ${data.targetSha}`,
        };
    }

    const terminal = isOfficialReceiptTerminalStatus(data.status);
    const createInput: CreateWorkerIoInput<OfficialReceiptData> = {
        id: input.id,
        source: input.source,
        type: terminal ? TYPE_RECEIPT_TERMINAL : TYPE_RECEIPT_PROGRESS,
        time: input.time,
        data,
        wwstream: STREAM_OFFICIAL_RECEIPT,
        wwcategory: terminal ? 'lifecycle' : 'wait',
        wwsummary: input.wwsummary,
        wwerror,
        traceparent: input.traceparent,
        tracestate: input.tracestate,
    };
    if (terminal) {
        createInput.wwterminal = true;
    }
    return createWorkerIoEnvelope(createInput);
}

/** 幂等键：repo + targetSha + runId（调用方可自选 runId 生成策略）。 */
export function officialReceiptIdempotencyKey(
    repoId: string,
    targetSha: string,
    runId: string,
): string {
    return `${repoId.trim()}:${normalizeCommitSha(targetSha)}:${runId.trim()}`;
}
