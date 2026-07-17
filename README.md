# 华中政策雷达

湖北优先的政策、项目申报和科创赛事监控 MVP。公众号负责优先发现，政府官网负责权威核验；统一数据层完成字段规范化、严格去重、来源归并和规则评分，网站提供电脑与手机端查看、筛选和原文跳转。

## 当前已经具备

- 8 条经过官方页面核验的湖北真实事项，覆盖政策申报、人才项目、创新券和科创赛事。
- 湖北省科技厅、武汉市科技创新局、东湖高新区、省经信厅和省人社厅等官方列表采集器。
- 每两小时运行一次的 GitHub Actions 定时模板。
- 单篇公开微信公众号文章导入接口；未知公众号自动隔离，不直接进入正式政策流。
- D1 持久化结构：`items`、`item_sources`、`sources`、`source_runs`。
- 统一严格去重：来源外部 ID、规范 URL、文号、地区 + 标题 + 发布单位 + 日期。
- 响应式政策库、详情页、来源状态页和只读 JSON API。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

常用验证命令：

```bash
npm run lint
npm test
npm run collect:hubei -- --source hubei-kjt-notices --limit 3 --dry-run --no-delay
```

## 数据流

```text
政府官网列表 ─┐
              ├─> 标准 Candidate ─> 规则评分 ─> 严格去重 ─> D1 ─> 网站/API
公众号单篇  ──┘                          │
                                        └─ 官网匹配后升级为“官网已核验”
```

官网采集器位于 `scripts/collect-hubei.mjs`。无 `POLICY_RADAR_URL` 和 `POLICY_INGEST_KEY` 时只输出试采结果；配置后会写入部署网站的 `/api/ingest`。

## 公众号导入

单篇公开文章可通过部署后的安全写接口导入：

```bash
export POLICY_RADAR_URL="https://你的站点地址"
export POLICY_INGEST_KEY="你的私有写入密钥"
npm run import:wechat -- "https://mp.weixin.qq.com/s/..."
```

边界说明：

- 只接受 `mp.weixin.qq.com/s/...` 公共文章链接。
- 服务端调用固定公共解析地址，仅白名单提取标题、摘要、正文纯文本、公众号名、发布日期和公开文章 ID。
- 不保存原始返回包、Cookie、Token、sessionid、评论或用户信息。
- 未知账号进入隔离区；白名单账号也先标记为“公众号首发，待官网核验”。
- 公众号账号级历史文章和定时扫描，需要用户本人在 `down.mptext.top` 扫码登录；项目不索取、不存储微信登录凭证。

## 定时运行

`.github/workflows/collect-hubei.yml` 默认每两小时执行一次。推送到 GitHub 后，在仓库 Secrets 中配置：

- `POLICY_RADAR_URL`
- `POLICY_INGEST_KEY`

定时任务只会将候选数据发送到自己的站点。日志仅输出标题和写入结果，不输出密钥或完整正文。

## API

- `GET /api/items`：支持 `type`、`verification`、`region`、`q`、`limit`。
- `GET /api/sources`：来源状态。
- `POST /api/ingest`：采集器批量写入，最多 100 条，Bearer Token 必需。
- `POST /api/import/wechat`：单篇公众号文章导入，Bearer Token 必需。

所有写接口在未配置 `POLICY_INGEST_KEY` 时都失败关闭。

## 下一阶段

1. 用户扫码启用公众号账号级白名单扫描。
2. 根据真实业务样本固定“必须看 / 可忽略”规则与权重。
3. 扩展河南、湖南，再覆盖安徽、江西。
4. 将采集、筛选、核验、发布和运维检查封装成可迁移 Skill。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/WECHAT_SETUP.md](docs/WECHAT_SETUP.md)。
