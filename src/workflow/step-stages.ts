/**
 * CF Workflow step 信封 → 阶段视图（纯函数；供 Admin WorkflowPhaseTree / 单测）。
 * sch1 / deploy-tracker / decision-desk 三份拷贝收敛于此。
 */

import { workflowIoStepEventKind } from './instance-events.js';
import { isWorkflowStepError, isWorkflowStepSkipped, workflowStepMessage } from './step-result.js';

/** 与 Admin SSE 信封对齐的最小字段 */
export interface WorkflowStepStageEvent {
    type: string;
    /** RFC3339（与 WorkerIoEnvelope.time 对齐） */
    time?: string;
    wwsummary?: string;
    data?: {
        stepName?: string;
        attempt?: number;
        output?: unknown;
    };
}

export interface WorkflowStepStage {
    id: string;
    label: string;
    /** success / skipped / running / failure / pending（对齐 MpgStage.status） */
    status: string;
    message: string | null;
    /** 步骤事件日志（WorkflowPhaseTree StepRow 展开正文）；无日志时不设 */
    detail?: string;
}

/** 映射后 type → Admin 展开区用的短标签（step.started 等） */
export function workflowStepLogTypeSuffix(type: string): string {
    const marker = '.workflow.';
    const i = type.indexOf(marker);
    if (i >= 0) {
        return type.slice(i + marker.length);
    }
    const parts = type.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : type;
}

function isWorkflowStepLogEvent(type: string): boolean {
    const kind = workflowIoStepEventKind(type);
    return kind.started || kind.completed || kind.errored;
}

/**
 * 将属于同一步骤的 SSE 信封格式化为展开区文本（与 decision-desk 本地时间线一致）。
 * 无 qualifying 事件时返回 undefined（不伪造空字符串）。
 */
export function formatWorkflowStepStageDetail(
    events: readonly WorkflowStepStageEvent[],
): string | undefined {
    const lines: string[] = [];
    for (const e of events) {
        if (!isWorkflowStepLogEvent(e.type)) {
            continue;
        }
        const suffix = workflowStepLogTypeSuffix(e.type);
        const time = e.time?.trim() ?? '';
        const summary = e.wwsummary ?? '';
        lines.push(time ? `${time} · ${suffix}: ${summary}` : `· ${suffix}: ${summary}`);

        const attempt = e.data?.attempt;
        if (attempt !== undefined && suffix.startsWith('attempt.')) {
            lines.push(`  attempt=${attempt}`);
        }

        if (suffix === 'step.completed' && e.data?.output !== undefined) {
            lines.push(JSON.stringify(e.data.output, null, 2));
        }
    }
    if (lines.length === 0) {
        return undefined;
    }
    return lines.join('\n');
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

export function stepStages(
    events: readonly WorkflowStepStageEvent[],
    currentStepName: string | null,
): WorkflowStepStage[] {
    const order: string[] = [];
    const status = new Map<string, StepUiStatus>();
    const summary = new Map<string, string>();
    const stepEvents = new Map<string, WorkflowStepStageEvent[]>();

    for (const e of events) {
        const name = e.data?.stepName;
        if (!name) {
            continue;
        }
        if (!status.has(name)) {
            order.push(name);
            status.set(name, 'pending');
        }
        const bucket = stepEvents.get(name);
        if (bucket) {
            bucket.push(e);
        } else {
            stepEvents.set(name, [e]);
        }
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
        const detail = formatWorkflowStepStageDetail(stepEvents.get(stepName) ?? []);
        return {
            id: stepName,
            label: stepName,
            status: toMpgStatus(st),
            message: summary.get(stepName) ?? null,
            ...(detail !== undefined ? { detail } : {}),
        };
    });
}
