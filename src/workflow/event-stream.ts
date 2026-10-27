/**
 * Admin SSE：workflow.get(instanceId).subscribe() → WorkerIoEnvelope 帧。
 * sch1 / deploy-tracker / decision-desk 三份拷贝收敛于此；taskId/source/ns 参数化。
 */
import { encodeWorkerIoSseFrame, isWorkerIoTerminal, workerIoToHttpResponse } from '../io.js';
import {
    type CfWorkflowInstanceEvent,
    createWorkflowStreamControl,
    DEFAULT_WORKFLOW_IO_SOURCE,
    mapWorkflowInstanceEvent,
} from './instance-events.js';

/** 最小订阅面：规避 workers-types 版本间 Symbol.dispose 签名差异（dispose 用 Reflect 取，见 cleanup） */
export interface WorkflowEventSubscription {
    next(): Promise<IteratorResult<unknown>>;
}

export interface WorkflowEventSource {
    get(id: string): Promise<{
        subscribe(): Promise<WorkflowEventSubscription>;
    }>;
}

export interface CreateWorkflowSseStreamOptions {
    taskId: string | number;
    instanceId: string;
    /** 默认 DEFAULT_WORKFLOW_IO_SOURCE（/workers/sch1） */
    source?: string;
    /** 默认 DEFAULT_WORKFLOW_IO_NS（sch1.task） */
    ns?: string;
    signal: AbortSignal;
}

/**
 * 订阅 CF Workflow 实例事件并编码为 SSE ReadableStream。
 * 客户端 abort / signal 时 dispose subscription。
 */
export function createWorkflowSseStream(
    workflow: WorkflowEventSource,
    opts: CreateWorkflowSseStreamOptions,
): ReadableStream<Uint8Array> {
    const { taskId, instanceId, signal } = opts;
    const source = opts.source ?? DEFAULT_WORKFLOW_IO_SOURCE;
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const enqueue = (text: string) => {
                controller.enqueue(encoder.encode(text));
            };

            enqueue(
                encodeWorkerIoSseFrame(
                    createWorkflowStreamControl('ready', {
                        taskId,
                        instanceId,
                        source,
                    }),
                ),
            );

            let subscription: WorkflowEventSubscription | null = null;

            const cleanup = () => {
                if (subscription) {
                    try {
                        // workerd Disposable；workers-types 下 Symbol.dispose 类型不稳，用 Reflect
                        const key = (Symbol as unknown as { dispose: symbol }).dispose;
                        const dispose = Reflect.get(subscription, key);
                        if (typeof dispose === 'function') {
                            (dispose as () => void).call(subscription);
                        }
                    } catch {
                        /* ignore */
                    }
                }
                subscription = null;
            };

            const onAbort = () => {
                cleanup();
                try {
                    controller.close();
                } catch {
                    /* already closed */
                }
            };
            signal.addEventListener('abort', onAbort, { once: true });

            try {
                const instance = await workflow.get(instanceId);
                const sub = await instance.subscribe();
                subscription = sub;

                while (!signal.aborted) {
                    const result = await sub.next();
                    if (result.done) {
                        enqueue(
                            encodeWorkerIoSseFrame(
                                createWorkflowStreamControl('end', {
                                    taskId,
                                    instanceId,
                                    source,
                                }),
                            ),
                        );
                        break;
                    }
                    const cf = result.value as CfWorkflowInstanceEvent | undefined;
                    if (!cf) {
                        continue;
                    }
                    const envelope = mapWorkflowInstanceEvent(cf, {
                        taskId,
                        source,
                        ns: opts.ns,
                    });
                    enqueue(encodeWorkerIoSseFrame(envelope));
                    if (isWorkerIoTerminal(envelope)) {
                        enqueue(
                            encodeWorkerIoSseFrame(
                                createWorkflowStreamControl('end', {
                                    taskId,
                                    instanceId,
                                    source,
                                }),
                            ),
                        );
                        break;
                    }
                }
            } catch (e: unknown) {
                const err = e instanceof Error ? e : new Error(String(e));
                try {
                    enqueue(
                        encodeWorkerIoSseFrame(
                            createWorkflowStreamControl('error', {
                                taskId,
                                instanceId,
                                source,
                                error: { name: err.name || 'Error', message: err.message },
                            }),
                        ),
                    );
                } catch {
                    /* controller closed */
                }
            } finally {
                signal.removeEventListener('abort', onAbort);
                cleanup();
                try {
                    controller.close();
                } catch {
                    /* ignore */
                }
            }
        },
        cancel() {
            /* abort handled via signal from route */
        },
    });
}

export function workflowEventSseResponse(stream: ReadableStream<Uint8Array>): Response {
    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}

export function noWorkflowInstanceResponse(
    taskId: string | number,
    opts: { source?: string; instanceId?: string } = {},
): Response {
    return workerIoToHttpResponse(
        createWorkflowStreamControl('error', {
            taskId,
            instanceId: opts.instanceId ?? '',
            source: opts.source ?? DEFAULT_WORKFLOW_IO_SOURCE,
            error: { name: 'NO_WORKFLOW_INSTANCE', message: 'no workflow instance' },
        }),
        404,
    );
}
