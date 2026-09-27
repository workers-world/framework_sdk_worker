/**
 * 将内置 classifier 写入 registry。
 * 由短路径 `provider-error.ts` 与完整入口 `index.ts` 侧载，勿从 registry 反引以免环。
 */
import { BUILTIN_PROVIDER_ERROR_CLASSIFIERS } from './classifiers/builtin.js';
import { registerProviderErrorClassifier } from './registry.js';

for (const c of BUILTIN_PROVIDER_ERROR_CLASSIFIERS) {
    registerProviderErrorClassifier(c);
}
