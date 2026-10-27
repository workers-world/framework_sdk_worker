/**
 * CF Workflow step 信封 → 阶段视图（纯函数；供 Admin WorkflowPhaseTree / 单测）。
 * sch1 / deploy-tracker / decision-desk 三份拷贝收敛于此。
 */

import { workflowIoStepEventKind } from './instance-events.js';
import { isWorkflowStepError, isWorkflowStepSkipped, workflowStepMessage } from './step-result.js';

/** 与 Admin SSE 信封对齐的最小字段 */
export interface WorkflowStepStageEvent {
    type: string;
    wwsummary?: string;
    data?: {
        stepName?: string;
        output?: unknown;
    };
}

export interface WorkflowStepStage {
    id: string;
    label: string;
    /** success / skipped / running / failure / pending（对齐 MpgStage.status） */
    status: string;
    message: string | null;
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

    for (const e of events) {
        const name = e.data?.stepName;
        if (!name) {
            continue;
        }
        if (!status.has(name)) {
            order.push(name);
            status.set(name, 'pending');
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
        return {
            id: stepName,
            label: stepName,
            status: toMpgStatus(st),
            message: summary.get(stepName) ?? null,
        };
    });
}
