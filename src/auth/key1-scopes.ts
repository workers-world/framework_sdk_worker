/** KEY1 MVP 固定 scope 枚举（AND 授权） */
export const KEY1_SCOPE_PLANNING_READ = 'planning.read';
export const KEY1_SCOPE_PLANNING_WRITE = 'planning.write';

export const KEY1_SCOPES = [KEY1_SCOPE_PLANNING_READ, KEY1_SCOPE_PLANNING_WRITE] as const;

export type Key1Scope = (typeof KEY1_SCOPES)[number];

export function isKey1Scope(value: string): value is Key1Scope {
    return (KEY1_SCOPES as readonly string[]).includes(value);
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
    return required.every((s) => granted.includes(s));
}
