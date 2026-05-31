# pi-web-access

[pi](https://github.com/earendil-works/pi-coding-agent) 的网页访问扩展——将实时网页搜索、页面抓取、站点地图、文档查询和 headless 浏览器自动化整合为一个 `pi install` 即可使用的包。

## 功能

### `web_access` 工具

单一工具，6 种操作：

| 操作 | 说明 | 提供商 |
|------|------|--------|
| `grok_search` | 广泛网页搜索 + AI 综合 | xAI Grok / OpenAI 兼容中继 |
| `exa_search` | 低噪声权威搜索 | Exa |
| `zhipu_search` | 中文 / 国内 / 实时搜索 | 智谱 |
| `fetch` | 将网页提取为 Markdown | Tavily / Firecrawl |
| `docs` | SDK / API 文档查询 | Context7 |
| `map` | 探索站点 URL 结构 | Tavily |

### `browser-tools` 技能

通过 Chrome DevTools Protocol 实现 headless 浏览器自动化——用于 JS 渲染页面（任何平台）、需登录的内容和实时数据提取。CDP 端口随机生成并仅绑定 `127.0.0.1`；默认 profile 模式会复制 cookie，登录态敏感，处理不可信页面时请优先使用 `--no-profile`。

| 脚本 | 用途 |
|------|------|
| `browser-start.js` | 启动 headless Chrome（带用户 cookie） |
| `browser-nav.js` | 导航到 URL |
| `browser-eval.js` | 在页面中执行 JavaScript |
| `browser-content.js` | 通过 Mozilla Readability 提取可读 Markdown |
| `browser-screenshot.js` | 截取页面截图 |
| `browser-cookies.js` | 列出当前标签页的 cookie |
| `browser-pick.js` | 交互式元素选择器（需 `--visible`） |
| `browser-stop.js` | 停止 Chrome，释放约 430MB 内存 |

### `/web-config` 命令

交互式 TUI 管理 API 密钥和设置——无需手动编辑 JSON。

- **范围**：全局（`~/.pi/agent/web-access.json`）或项目（`.pi/web-access.json`）
- **API 密钥**：9 个提供商，脱敏显示
- **高级**：URL、模型、超时、重试、地图限制

优先级：环境变量 > 项目配置 > 全局配置 > 默认值。

安全策略：项目配置不能覆盖 provider endpoint URL（如 `exaBaseUrl`、`tavilyApiUrl` 等），这些高风险 endpoint 只允许来自全局配置/环境变量并经过 HTTPS 与官方 host allowlist 校验，以避免不可信仓库窃取全局 API key。`fetch` / `map` / find-similar 默认阻止 localhost、私网、link-local、metadata 和 `.local` URL。

## 安装

```bash
pi install git:github.com/daoguademeng/pi-web-access
```

一步安装。`postinstall` 脚本自动在 `skills/browser-tools/` 中执行 `npm ci --ignore-scripts` 设置 Puppeteer 依赖（使用 lockfile，禁用依赖生命周期脚本）。然后在 pi 中 `/reload`，配置密钥：

```bash
/web-config
```

browser-tools 需要系统原生安装 Google Chrome 或 Chromium（非 Flatpak/Snap）。

## 配置

所有 API 密钥存储在 `0600` 权限的 JSON 文件中，已通过 gitignore 排除：

- **全局**：`~/.pi/agent/web-access.json`
- **项目**：`.pi/web-access.json`

也可使用环境变量：

| 提供商 | 环境变量 |
|--------|----------|
| xAI Grok | `XAI_API_KEY`, `XAI_API_URL`, `XAI_MODEL` |
| OpenAI 兼容 | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_API_URL`, `OPENAI_COMPATIBLE_MODEL` |
| Exa | `EXA_API_KEY` |
| 智谱 | `ZHIPU_API_KEY`, `ZHIPU_API_URL`, `ZHIPU_SEARCH_ENGINE` |
| Tavily | `TAVILY_API_KEY` |
| Firecrawl | `FIRECRAWL_API_KEY` |
| Context7 | `CONTEXT7_API_KEY` |

## 快速测试

```bash
# web_access — 全部 6 种操作
/web-config                              # 先配置 API 密钥

# browser-tools
cd skills/browser-tools
./browser-start.js --no-profile # 更安全：不复制 cookie/profile
./browser-nav.js https://example.com
./browser-content.js https://example.com
./browser-stop.js
```

## 仓库结构

```
pi-web-access/
├── index.ts                  # 扩展入口 + /web-config 命令
├── tool.ts                   # web_access 工具定义（6 种操作）
├── config.ts                 # 分层配置存储（全局 + 项目）
├── types.ts                  # TypeScript 类型定义
├── providers/                # 提供商实现
│   ├── grok.ts               #   xAI / OpenAI 兼容
│   ├── exa.ts                #   Exa 搜索
│   ├── zhipu.ts              #   智谱搜索
│   ├── fetch.ts              #   Tavily / Firecrawl 抓取
│   ├── tavily.ts             #   Tavily 站点地图
│   ├── context7.ts           #   Context7 文档查询
│   ├── security.ts           #   URL/endpoint 安全校验与 SSRF 防护
│   └── shared.ts             #   共享 HTTP 工具
├── skills/
│   ├── browser-tools/        # Chrome CDP 自动化脚本
│   │   ├── SKILL.md          #   Agent 技能说明
│   │   ├── browser-*.js      #   自动化脚本
│   │   └── package.json      #   Puppeteer 依赖
│   └── web-access-manual/    # web_access 完整使用手册
│       └── SKILL.md
├── web-access.example.json   # 示例配置模板（无真实密钥）
├── .gitignore                # 排除 web-access.json + node_modules
└── package.json              # pi 包清单 + postinstall
```

## 致谢

- **[konbakuyomu/smartsearch](https://github.com/konbakuyomu/smartsearch)** — `web_access` 工具改编自 smart-search (对标版本0.1.12) 的多提供商网页研究架构，包括 Grok、Exa、智谱、Context7、Tavily 和 Firecrawl 集成。smart-search 是一款优秀的 CLI 优先研究工具——推荐查看其命令行版本。

- **[badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/browser-tools)** — `browser-tools` 技能源自 pi 的创建者 Mario Zechner（badlogic）。Chrome DevTools Protocol 脚本、SKILL.md 和 headless 浏览器自动化方案均来自官方 pi-skills 仓库。

- **[LinuxDo社区](https://linux.do)**

## 许可证

MIT
