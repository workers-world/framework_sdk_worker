/**
 * CF Workflow step 信封 → 阶段视图（纯函数；供 Admin WorkflowPhaseTree / 单测）。
 * sch1 / deploy-tracker / decision-desk 三份拷贝收敛于此。
 */

import { workflowIoStepEventKind } from './instance-events.js';
import { isWorkflowStepError, isWorkflowStepSkipped, workflowStepMessage } from './step-result.js';

/** 与 Admin SSE 信封对齐的最小字段 */
export interface WorkflowStepStageEvent {
    type: string;
    time?: string;
    wwsummary?: string;
    wwerror?: { code?: string; message?: string } | null;
    data?: {
        stepName?: string;
        output?: unknown;
        attempt?: number;
        durationMs?: number;
    };
}

export interface WorkflowStepStage {
    id: string;
    label: string;
    /** success / skipped / running / failure / pending（对齐 MpgStage.status） */
    status: string;
    message: string | null;
    /** 该 step 的事件日志（多行；供 UI 折叠展开，对齐 GitHub Actions） */
    detail: string | null;
}

type StepUiStatus = 'done' | 'skipped' | 'active' | 'error' | 'pending';

function toMpgStatus(status: StepUiStatus): string {
    switch (status) {
        case 'done':
            return 'success';
        case 'skipped':
            return 'skipped';
        case 'active':
            return 'running';
        case 'error':
            return 'failure';
        default:
            return 'pending';
    }
}

function isTerminalUi(st: StepUiStatus): boolean {
    return st === 'done' || st === 'skipped' || st === 'error';
}

const DETAIL_OUTPUT_MAX = 2_000;

function formatDetailOutput(output: unknown): string | null {
    if (output === undefined) {
        return null;
    }
    if (typeof output === 'string') {
        const t = output.trim();
        return t ? t.slice(0, DETAIL_OUTPUT_MAX) : null;
    }
    try {
        const raw = JSON.stringify(output, null, 2);
        if (!raw || raw === '{}' || raw === 'null') {
            return null;
        }
        return raw.length > DETAIL_OUTPUT_MAX ? `${raw.slice(0, DETAIL_OUTPUT_MAX)}\n…` : raw;
    } catch {
        return String(output).slice(0, DETAIL_OUTPUT_MAX);
    }
}

function appendStepDetailLine(
    lines: Map<string, string[]>,
    stepName: string,
    e: WorkflowStepStageEvent,
): void {
    const bucket = lines.get(stepName) ?? [];
    if (!lines.has(stepName)) {
        lines.set(stepName, bucket);
    }
    const time = typeof e.time === 'string' && e.time.trim() ? e.time.trim() : null;
    const wfTail = e.type.match(/\.workflow\.(.+)$/);
    const typeTail = wfTail?.[1]
        ? wfTail[1]
        : e.type.includes('.')
          ? e.type.split('.').slice(-2).join('.')
          : e.type;
    const head = [time, typeTail].filter(Boolean).join(' · ');
    const summary = e.wwsummary?.trim();
    bucket.push(summary ? `${head}: ${summary}` : head);
    if (e.data?.attempt != null) {
        bucket.push(`  attempt=${e.data.attempt}`);
    }
    if (e.data?.durationMs != null) {
        bucket.push(`  durationMs=${e.data.durationMs}`);
    }
    if (e.wwerror?.message) {
        const code = e.wwerror.code?.trim();
        bucket.push(`  error=${code ? `${code}: ` : ''}${e.wwerror.message}`);
    }
    const out = formatDetailOutput(e.data?.output);
    if (out) {
        for (const line of out.split('\n')) {
            bucket.push(`  ${line}`);
        }
    }
}

export function stepStages(
    events: readonly WorkflowStepStageEvent[],
    currentStepName: string | null,
): WorkflowStepStage[] {
    const order: string[] = [];
    const status = new Map<string, StepUiStatus>();
    const summary = new Map<string, string>();
    const detailLines = new Map<string, string[]>();

    for (const e of events) {
        const name = e.data?.stepName;
        if (!name) {
            continue;
        }
        if (!status.has(name)) {
            order.push(name);
            status.set(name, 'pending');
        }
        appendStepDetailLine(detailLines, name, e);
        if (e.wwsummary) {
            summary.set(name, e.wwsummary);
        }
        const kind = workflowIoStepEventKind(e.type);
        if (kind.errored) {
            status.set(name, 'error');
        } else if (kind.completed) {
            const out = e.data?.output;
            if (isWorkflowStepError(out)) {
                status.set(name, 'error');
                const bizMsg = workflowStepMessage(out);
                if (bizMsg) {
                    summary.set(name, bizMsg);
                }
            } else if (isWorkflowStepSkipped(out)) {
                status.set(name, 'skipped');
                const bizMsg = workflowStepMessage(out);
                if (bizMsg) {
                    summary.set(name, bizMsg);
                }
            } else {
                status.set(name, 'done');
            }
        } else if (kind.started) {
            const cur = status.get(name);
            if (cur && !isTerminalUi(cur)) {
                status.set(name, 'active');
            }
        }
    }

    // 下游 step 已完成时，前置仍停在 active/pending 的 wait（缺 wait.completed 回放）视为 done
    let sawDownstreamDone = false;
    for (let i = order.length - 1; i >= 0; i--) {
        const name = order[i];
        if (name === undefined) {
            continue;
        }
        const st = status.get(name) ?? 'pending';
        if (isTerminalUi(st)) {
            sawDownstreamDone = true;
            continue;
        }
        if (sawDownstreamDone && (st === 'active' || st === 'pending')) {
            status.set(name, 'done');
        }
    }

    return order.map((stepName) => {
        let st = status.get(stepName) ?? 'pending';
        if (stepName === currentStepName && !isTerminalUi(st)) {
            st = 'active';
        }
        const lines = detailLines.get(stepName);
        return {
            id: stepName,
            label: stepName,
            status: toMpgStatus(st),
            message: summary.get(stepName) ?? null,
            detail: lines && lines.length > 0 ? lines.join('\n') : null,
        };
    });
}
