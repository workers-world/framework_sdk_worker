# framework_sdk_worker

Cloudflare Workers 公共 SDK：鉴权、notify、LLM 客户端、D1 tech-meta、发号器、运维 error 等跨 Worker 共享模块。

## 安装

```bash
npm install @workers-world/framework_sdk_worker
```

本地开发（与 Worker 同目录布局）：

```bash
npm install file:../framework_sdk_worker
cd ../framework_sdk_worker && npm run build
```

## 构建与测试

```bash
npm install
npm run build
npm test
```

## 许可证

MIT — 见 [LICENSE](LICENSE)。

生产密钥与账号 binding 不在本仓库内；部署配置见各 Worker 的 `wrangler.example.toml`。
