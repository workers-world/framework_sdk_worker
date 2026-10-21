/**
 * Agent / ww CLI 是否要求 WorkerIoEnvelope（query `agent=1|true|yes`）。
 * Admin UI 不带该参数，继续返回裸 JSON。
 */
export function wantsAgentWorkerIo(queryAgent: string | undefined): boolean {
    const v = queryAgent?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
