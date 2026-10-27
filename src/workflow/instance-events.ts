/**
 * Cloudflare WorkflowInstanceEvent → WorkerIoEnvelope 映射。
 * CF type 与信封 type 后缀对齐；UI 字段进 ww* / data。
 */
import {
    createWorkerIoEnvelope,
    STREAM_WORKFLOW_INSTANCE,
    type WorkerIoCategory,
    type WorkerIoEnvelope,
} from '../io.js';

/** CF Workflow instance event（subscribe 产出）的最小形状 */
export type CfWorkflowInstanceEvent = {
    instanceId: string;
    eventId: number;
    timestamp: number;
    type: string;
    stepName?: string;
    attempt?: number;
    durationMs?: number;
    retryDelayMs?: number;
    eventType?: string;
    output?: unknown;
    error?: { name: string; message: string };
    params?: unknown;
};

export interface WorkflowInstanceEventData {
    instanceId: string;
    /** sch1/decision-desk 为数字任务 id；deploy-tracker 等可直放字符串业务 id */
    taskId: string | number;
    stepName?: string;
    attempt?: number;
    durationMs?: number;
    retryDelayMs?: number;
    waitEventType?: string;
    /** step_completed；敏感步可能为 "[REDACTED]" */
    output?: unknown;
}

export type WorkflowInstanceIoEnvelope = WorkerIoEnvelope<WorkflowInstanceEventData>;

const TERMINAL_CF_TYPES = new Set([
    'workflow_completed',
    'workflow_errored',
    'workflow_terminated',
]);

function categoryForCfType(type: string): WorkerIoCategory {
    if (TERMINAL_CF_TYPES.has(type)) {
        return 'lifecycle';
    }
    if (type.startsWith('workflow_')) {
        return 'workflow';
    }
    if (type.startsWith('step_')) {
        return 'step';
    }
    if (type.startsWith('attempt_')) {
        return 'attempt';
    }
    if (type.startsWith('sleep_')) {
        return 'sleep';
    }
    if (type.startsWith('wait_')) {
        return 'wait';
    }
    if (type.startsWith('rollback')) {
        return 'rollback';
    }
    return 'system';
}

function summaryForCf(cf: CfWorkflowInstanceEvent): string {
    const step = cf.stepName ? `：${cf.stepName}` : '';
    switch (cf.type) {
        case 'workflow_queued':
            return '已进入执行队列';
        case 'workflow_started':
            return 'Workflow 已开始';
        case 'workflow_running':
            return 'Workflow 运行中';
        case 'workflow_paused':
            return 'Workflow 已暂停';
        case 'workflow_waiting':
            return 'Workflow 等待中';
        case 'workflow_waiting_for_pause':
            return 'Workflow 等待暂停';
        case 'workflow_completed':
            return 'Workflow 已完成';
        case 'workflow_errored':
            return `Workflow 出错：${cf.error?.message ?? 'unknown'}`;
        case 'workflow_terminated':
            return 'Workflow 已终止';
        case 'step_started':
            return `步骤开始${step}`;
        case 'step_completed':
            return `步骤完成${step}`;
        case 'step_errored':
            return `步骤失败${step}`;
        case 'attempt_started':
            return `第 ${cf.attempt ?? '?'} 次尝试${step}`;
        case 'attempt_completed':
            return `尝试成功${step}`;
        case 'attempt_errored':
            return `尝试失败${step}`;
        case 'sleep_started':
            return `睡眠开始${step}`;
        case 'sleep_completed':
            return `睡眠结束${step}`;
        case 'wait_started':
            return `等待事件${step}`;
        case 'wait_completed':
            return `等待完成${step}`;
        case 'wait_timed_out':
            return `等待超时${step}`;
        default:
            if (cf.type.startsWith('rollback')) {
                return `回滚${step || `：${cf.type}`}`;
            }
            return cf.type;
    }
}

export const DEFAULT_WORKFLOW_IO_NS = 'sch1.task';
export const DEFAULT_WORKFLOW_IO_SOURCE = '/workers/sch1';

/** CF type → workers-world type（点分）；ns 默认对齐 sch1，其余 Worker 传自己的命名空间 */
export function cfTypeToWorkerIoType(cfType: string, ns: string = DEFAULT_WORKFLOW_IO_NS): string {
    const dotted = cfType.replace(/_/g, '.');
    return `workers-world.${ns}.workflow.${dotted}`;
}

export function isCfWorkflowTerminalType(type: string): boolean {
    return TERMINAL_CF_TYPES.has(type);
}

export function mapWorkflowInstanceEvent(
    cf: CfWorkflowInstanceEvent,
    ctx: { taskId: string | number; source?: string; ns?: string },
): WorkflowInstanceIoEnvelope {
    const category = categoryForCfType(cf.type);
    const terminal = isCfWorkflowTerminalType(cf.type);
    const data: WorkflowInstanceEventData = {
        instanceId: cf.instanceId,
        taskId: ctx.taskId,
    };
    if (cf.stepName !== undefined) {
        data.stepName = cf.stepName;
    }
    if (cf.attempt !== undefined) {
        data.attempt = cf.attempt;
    }
    if (cf.durationMs !== undefined) {
        data.durationMs = cf.durationMs;
    }
    if (cf.retryDelayMs !== undefined) {
        data.retryDelayMs = cf.retryDelayMs;
    }
    if (cf.eventType !== undefined) {
        data.waitEventType = cf.eventType;
    }
    if (cf.output !== undefined) {
        data.output = cf.output;
    }

    return createWorkerIoEnvelope({
        id: `${cf.instanceId}:${cf.eventId}`,
        source: ctx.source ?? DEFAULT_WORKFLOW_IO_SOURCE,
        type: cfTypeToWorkerIoType(cf.type, ctx.ns),
        time: new Date(cf.timestamp).toISOString(),
        data,
        wwstream: STREAM_WORKFLOW_INSTANCE,
        wwcategory: category,
        wwsummary: summaryForCf(cf).slice(0, 200),
        wwterminal: terminal ? true : undefined,
        wwerror: cf.error
            ? { code: cf.error.name || 'Error', message: cf.error.message }
            : undefined,
    });
}

/** 流控制帧（非 CF） */
export function createWorkflowStreamControl(
    kind: 'ready' | 'error' | 'end',
    ctx: {
        taskId: string | number;
        instanceId: string;
        source?: string;
        error?: { name: string; message: string };
    },
): WorkflowInstanceIoEnvelope {
    const type =
        kind === 'ready'
            ? 'workers-world.io.stream.ready'
            : kind === 'error'
              ? 'workers-world.io.stream.error'
              : 'workers-world.io.stream.end';
    return createWorkerIoEnvelope({
        id: `0:${kind}:${ctx.instanceId}`,
        source: ctx.source ?? DEFAULT_WORKFLOW_IO_SOURCE,
        type,
        data: { instanceId: ctx.instanceId, taskId: ctx.taskId },
        wwstream: STREAM_WORKFLOW_INSTANCE,
        wwcategory: 'lifecycle',
        wwsummary:
            kind === 'ready'
                ? '订阅已建立'
                : kind === 'error'
                  ? `无法订阅：${ctx.error?.message ?? 'unknown'}`
                  : '流已结束',
        wwterminal: kind === 'end' ? true : undefined,
        wwerror: ctx.error
            ? { code: ctx.error.name || 'Error', message: ctx.error.message }
            : undefined,
    });
}

/**
 * 映射后点分类型谓词：Admin hook / stepStages / run-log 共用，替代散落的 includes() 嗅探。
 * step 组不含 attempt.*（Admin hook 的 isDone/isStart 语义）；attempt.* 单独一组。
 */
export function isWorkflowIoStepStarted(type: string): boolean {
    return (
        type.endsWith('.step.started') ||
        type.endsWith('.wait.started') ||
        type.endsWith('.sleep.started')
    );
}

export function isWorkflowIoStepCompleted(type: string): boolean {
    return (
        type.endsWith('.step.completed') ||
        type.endsWith('.wait.completed') ||
        type.endsWith('.sleep.completed')
    );
}

export function isWorkflowIoStepErrored(type: string): boolean {
    return type.endsWith('.step.errored');
}

export function isWorkflowIoAttemptStarted(type: string): boolean {
    return type.endsWith('.attempt.started');
}

export function isWorkflowIoAttemptCompleted(type: string): boolean {
    return type.endsWith('.attempt.completed');
}

export function isWorkflowIoAttemptErrored(type: string): boolean {
    return type.endsWith('.attempt.errored');
}

/** 兼容 legacy 下划线拼写（部分旧帧未点分化），双写防御 */
export function isWorkflowIoWaitTimedOut(type: string): boolean {
    return type.endsWith('.wait.timed.out') || type.includes('wait_timed_out');
}

/** stepStages 的 eventKind：含 attempt.*（比 Admin hook 的 isDone/isStart 多 attempt 组） */
export function workflowIoStepEventKind(type: string): {
    started: boolean;
    completed: boolean;
    errored: boolean;
} {
    const t = type;
    const errored =
        t.includes('step.errored') ||
        t.includes('attempt.errored') ||
        t.includes('wait.timed.out') ||
        t.includes('wait_timed_out');
    const completed =
        t.includes('step.completed') ||
        t.includes('wait.completed') ||
        t.includes('sleep.completed') ||
        t.includes('attempt.completed');
    const started =
        t.includes('step.started') ||
        t.includes('wait.started') ||
        t.includes('sleep.started') ||
        t.includes('attempt.started');
    return { started, completed, errored };
}

/** 流控制帧 id（0:<kind>:<instanceId>）；数据帧 id 为 <instanceId>:<eventId> */
export function isWorkflowStreamControlId(id: string): boolean {
    return id.startsWith('0:');
}
