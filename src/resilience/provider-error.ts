/**
 * 内部短路径 `../resilience/provider-error.js`：契约 + github-retry（含内置 catalog 侧载）。
 * 域内 classifier 只依赖 contract；勿在此 re-export 具名 classifier。
 * 完整 API 见 `./provider-error/index.js`；package export 由 tsup 打 index。
 */

export * from './provider-error/contract.js';
export {
    githubRetryDelayMs,
    isGithubRequestRetryable,
    isWholesaleRateLimitError,
} from './provider-error/github-retry.js';
