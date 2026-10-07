# 项目结构与架构基线

本文描述仓库当前真实结构。M1 技术原型已经接入编辑、解析和预览；用户反馈中文输入法大部分验收通过，但微信输入法/双屏/200% 缩放的候选框异常仍待修复，因此 M1 未达到退出条件。

- 当前状态：WinUI 3 双 WebView2 技术原型、独立 Web 工程、全量快照桥接和 Markdig 预览链路。
- 当前没有真实文件读写、保存、文件树、多标签或设置持久化。
- 阶段计划见[开发方案](开发方案.md)；版本与构建操作见[工程开发指南](工程开发指南.md)。
- 稳定技术取舍见[技术决策](decision.md)，阶段记录见[项目历程](progress.md)。

## 仓库根目录

| 路径 | 职责 |
|---|---|
| `Marker.sln` | WinUI 应用与 MSTest 工程的解决方案入口。 |
| `global.json` | 固定 .NET SDK `10.0.401`，禁止自动 roll-forward。 |
| `src/` | 应用源代码，包含桌面端与独立 Web 工程。 |
| `tests/` | 自动化测试工程，覆盖消息会话校验与 Markdown 渲染。 |
| `scripts/` | 本地 SDK 准备、构建、开发签名及 MSIX 烟雾测试脚本。 |
| `.github/workflows/` | Windows CI 构建工作流定义；远端是否执行需看 Actions 记录。 |
| `docs/` | 产品方案、工程指南、架构、决策和历程文档。 |
| `AGENTS.md` | 仓库开发与文档持续维护要求。 |
| `LICENSE` | 项目 MIT 许可证。 |
| `THIRD_PARTY_NOTICES.md` | 当前直接依赖声明及许可证维护要求。 |
| `.tools/` | 仓库局部 SDK 和依赖缓存，不提交。 |
| `artifacts/` | 本地产物、截图和验证结果，不提交。 |
| `graphify-out/` | 本地图谱产物，不作为运行时或文档关系事实。 |

## 当前模块

### `src/Marker.App/`

- `App.xaml`、`App.xaml.cs`：注册 WinUI 资源，启动并激活唯一 `MainWindow`。
- `MainWindow.xaml`：编辑与预览两个 WebView2、连接状态和全量重同步按钮。
- `MainWindow.xaml.cs`：创建共享的 `CoreWebView2Environment`，分别加载编辑器与预览页面；限制导航和资源路径；分发消息、异步解析 Markdown、丢弃过期结果并在窗口关闭时清理 WebView2。输入内容目前来自内置受控样例。
- `BridgeSession.cs`：校验页面来源、消息类型与字段白名单、会话标识、版本、JSON 深度和消息/文本大小；允许相同版本且相同文本的完整重同步。
- `MarkdownRenderer.cs`：使用 Markdig 管线，启用表格、任务列表、自动链接和强调扩展，并禁用原始 HTML。
- `Package.appxmanifest`：MSIX 身份为 Marker、发布者 `CN=Marker.Dev`、x64，最低 build 26100。
- `app.manifest`：桌面进程清单；声明 Per-Monitor V2 DPI 感知及 `asInvoker` 权限。
- `Assets/`：MSIX 使用的四种 PNG 磁贴/商店图标。
- `Marker.App.csproj`：WinUI 3、Windows App SDK、Markdig、自包含打包及 Web dist 内容映射。
- `packages.lock.json`：桌面端 NuGet 锁文件；锁文件版本才是实际依赖基线。

### `src/Marker.Web/`

- `package.json`、`package-lock.json`：Web 工程脚本、CodeMirror 6、DOMPurify 及锁定版本。
- `index.html`、`preview.html`：编辑器与预览独立页面入口，分别声明内容安全策略 CSP。
- `src/main.ts`：创建 CodeMirror 6 Markdown 编辑器，维护编辑历史与会话版本，发送全量文本快照并响应重同步请求；Ctrl+Enter 在当前行后插入新段落，独立记录撤销历史。
- `src/preview.ts`：检查会话、版本和 HTML 大小，以 DOMPurify 标签/属性白名单净化后更新预览，并回报已渲染版本。
- `src/style.css`、`src/preview.css`：编辑器和预览的基础布局及明暗配色。
- `vite.config.ts`：构建编辑器和预览两个本地页面入口。
- `tsconfig.json`：TypeScript 编译器设置。
- `dist/`：Vite 构建目录，由构建生成，不提交；Web 依赖随产物本地打包，不从 CDN 加载。

桌面端分别将 `editor.marker.example` 与 `preview.marker.example` 映射到包内 `Web/` 目录，使用两个 HTTPS 来源隔离页面。两个 WebView2 共享同一个环境。宿主只允许对应页面和 `/assets/` 路径，关闭开发者工具、默认菜单和宿主对象，拦截其他导航、子框架及新窗口。

### `tests/Marker.Tests/`

- `Marker.Tests.csproj` 与 `packages.lock.json`：MSTest 项目及锁定依赖。
- `BridgeSessionTests.cs`：覆盖可信来源、会话、字段、版本与尺寸校验。
- `MarkdownRendererTests.cs`：覆盖常见 Markdown、选定扩展、自动链接、原始 HTML 禁用和受控长文完整性。
- 测试工程直接链接桌面端两个纯逻辑源文件；目前无需额外抽取 `CoreLib`。

## 数据流与边界

1. 桌面端启动时确认包内 `Web/index.html` 与 `Web/preview.html` 存在，创建一个 WebView2 环境并传给两个控件。
2. 编辑器和预览分别向桌面端发送 `ready`，随后桌面端为本窗口创建随机会话标识并向编辑器发送内置样例。
3. CodeMirror 文档是编辑过程中的唯一文本权威。编辑后按全量快照发送 UTF-16 文本和递增版本；桌面端检查来源、字段、会话、版本和大小。重同步按钮请求编辑器重发当前快照。
4. 桌面端在后台使用 Markdig 解析，只有窗口存活、预览已就绪且版本仍为最新时才发送 HTML。预览稍晚就绪时会重新解析并补发最新快照。
5. 预览检查会话、版本与 HTML 长度，通过 DOMPurify 白名单净化，再用 `innerHTML` 更新页面并回报已渲染版本。
6. 关闭窗口时停止并关闭两个 WebView2。

当前限制：文本最多 1,048,576 个 UTF-16 单元，桥接 JSON 最多 2 MiB（UTF-8，实际同步文本需同时满足两个上限），预览 HTML 最多 4,194,304 个 UTF-16 单元。净化规则不允许链接、图片、SVG、表单和内联样式；CSP 禁止图片、网络连接、对象、表单和 frame。Markdig 自动链接的 HTML 会在预览净化时去掉链接元素。当前没有真实文件路径或文件 API，不用本原型处理用户文件。

## 构建与打包管线

`scripts/build.ps1` 是统一构建入口，命令细节以[工程开发指南](工程开发指南.md)为准。

1. 选择仓库局部 `.tools/dotnet/dotnet.exe`，否则使用 PATH 中的 dotnet。
2. 把 dotnet、NuGet、npm 状态及包缓存定向到 `.tools/`。
3. 在 `src/Marker.Web/` 执行 `npm ci`、`npm run check` 和 `npm run build`。
4. 对 `Marker.sln` 执行锁定模式 NuGet restore，平台为 x64。
5. 构建 Release 解决方案并运行测试工程；具体测试结果以本次实际运行记录为准。
6. 使用 `-Package` 时生成未签名 x64 MSIX 到 `artifacts/msix/`。
7. `Marker.App.csproj` 将 `Marker.Web/dist/**/*` 以 `Web/` 前缀复制进应用输出/包。

`.github/workflows/build.yml` 在 Windows runner 安装固定 .NET、Node 和 npm 版本，调用打包构建并上传未签名产物。工作流文件存在不等于远端 CI 已成功运行。

## 未完成验收与后续边界

- 中文输入法组合、候选框定位、撤销/重做和编辑/预览焦点切换尚待真实 Windows 桌面人工验收；浏览器合成输入事件不能替代该验收。
- MSTest 覆盖消息会话和 Markdown 渲染；独立真实 WebView 测试覆盖本轮导航、CSP、本地文件、新窗口及消息负向样例。样例通过不替代真实 IME 或完整发布回归。
- 原型仅使用内置样例，没有打开、保存、文件树、多标签、配置 JSON、SQLite、主题/动效系统、文件激活与恢复。
- M1 验收未完成前，不将本原型扩展为处理真实用户文件的工作流；阶段退出条件见[开发方案 M1](开发方案.md)。
- 运行、测试与打包证据及其限制见[项目历程](progress.md)。

## 文档维护

- 目录与职责随实际代码变化更新本文件。
- 新的稳定技术取舍记入[技术决策](decision.md)，不要在此复制整段理由。
- 每次阶段工作结束后，将结果、验证、限制和提交记入[项目历程](progress.md)。
- 产品行为和验收标准以[开发方案](开发方案.md)为准；工程命令以[工程开发指南](工程开发指南.md)为准。
