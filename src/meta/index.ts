/**
 * 注册 GET /v1/meta（Bearer 鉴权，与 /health 分离）
 */
import { createBearerAuthMiddleware } from '../auth/middleware.js';
import { buildWorkerMeta } from './build-meta.js';
import { type MetaEnvLike, type RegisterMetaRouteOptions, SDK_VERSION } from './types.js';

export { buildWorkerMeta, readVersionMetadata } from './build-meta.js';
export {
    SDK_PACKAGE,
    SDK_VERSION,
    type MetaEnvLike,
    type RegisterMetaRouteOptions,
    type WorkerMetaBuildInfo,
    type WorkerMetaResponse,
    type WorkerVersionMetadataView,
} from './types.js';

/**
 * 在 Hono app 上注册 `GET /v1/meta`。
 * 鉴权默认 `RULES_ADMIN_TOKEN`；响应为运行时 SDK/构建信息，不含 env 值。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMetaRoute(app: any, options: RegisterMetaRouteOptions): void {
    const authEnvKey = options.authEnvKey ?? 'RULES_ADMIN_TOKEN';
    const sdkVersion = options.sdkVersion ?? SDK_VERSION;
    const auth = createBearerAuthMiddleware(authEnvKey);

    app.use('/v1/meta', auth);
    app.get(
        '/v1/meta',
        (c: {
            env: object;
            json: (body: unknown, status?: number) => Response;
        }) => {
            const body = buildWorkerMeta(options.workerName, c.env as MetaEnvLike, sdkVersion);
            return c.json(body);
        },
    );
}
