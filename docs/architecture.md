# 项目结构与架构基线

本文描述仓库当前真实结构。项目仍处于 M0，文中“计划”部分不代表功能已实现。

- 当前状态：WinUI 3 空窗口、独立 Web 工程和 MSIX 构建基础。
- 当前没有已连接的 WebView、Markdown 文件读写或预览链路。
- 阶段计划见[开发方案](开发方案.md)；版本与构建操作见[工程开发指南](工程开发指南.md)。
- 稳定技术取舍见[技术决策](decision.md)，阶段记录见[项目历程](progress.md)。

## 仓库根目录

| 路径 | 职责 |
|---|---|
| `Marker.sln` | WinUI 应用与 MSTest 工程的解决方案入口。 |
| `global.json` | 固定 .NET SDK `10.0.401`，禁止自动 roll-forward。 |
| `src/` | 应用源代码，包含桌面端与独立 Web 工程。 |
| `tests/` | 自动化测试工程；目前没有业务测试方法。 |
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

- `App.xaml`：注册 WinUI 控件资源，目前没有产品主题系统。
- `App.xaml.cs`：启动时创建并激活唯一 `MainWindow`。
- `MainWindow.xaml`：显示居中的 `Marker M0` 文本。
- `MainWindow.xaml.cs`：设置窗口标题 `Marker`；没有文档会话或命令逻辑。
- `Package.appxmanifest`：MSIX 身份为 Marker、发布者 `CN=Marker.Dev`、x64，最低 build 26100。
- `app.manifest`：桌面进程清单；声明 Per-Monitor V2 DPI 感知及 `asInvoker` 权限。
- `Assets/`：MSIX 使用的四种 PNG 磁贴/商店图标。
- `Marker.App.csproj`：WinUI 3、Windows App SDK、自包含打包及 Web dist 内容映射。
- `packages.lock.json`：桌面端 NuGet 锁文件；锁文件版本才是实际依赖基线。

### `src/Marker.Web/`

- `package.json`：Web 工程脚本、运行时范围与 CodeMirror 6 依赖。
- `package-lock.json`：npm 锁文件，构建使用 `npm ci`。
- `index.html`：Vite 页面入口。
- `src/main.ts`：检查 `#app` 并显示工程初始化提示。
- `tsconfig.json`：TypeScript 编译器设置。
- `dist/`：Vite 产物目录，由构建生成，不提交。
- CodeMirror 包已安装并锁定，但当前入口尚未创建编辑器实例。
- Web 工程独立构建；WinUI 窗口当前没有加载它。

### `tests/Marker.Tests/`

- `Marker.Tests.csproj` 与 `packages.lock.json`：MSTest 项目及锁定依赖。
- `README.md`：说明当前测试运行器为零业务测试。
- 暂无业务方法和测试方法，因此不额外抽取 `CoreLib` 或测试专用抽象。

## 构建与打包管线

`scripts/build.ps1` 是当前统一构建入口，命令细节以[工程开发指南](工程开发指南.md)为准。

1. 选择仓库局部 `.tools/dotnet/dotnet.exe`，否则使用 PATH 中的 dotnet。
2. 把 dotnet、NuGet、npm 状态及包缓存定向到 `.tools/`。
3. 在 `src/Marker.Web/` 执行 `npm ci`、`npm run check` 和 `npm run build`。
4. 对 `Marker.sln` 执行锁定模式 NuGet restore，平台为 x64。
5. 构建 Release 解决方案并运行测试工程；当前测试数为零。
6. 使用 `-Package` 时生成未签名 x64 MSIX 到 `artifacts/msix/`。
7. `Marker.App.csproj` 将 `Marker.Web/dist/**/*` 以 `Web/` 前缀复制进应用输出/包。
8. 当前没有运行时代码从包内 `Web/` 路径加载页面，也没有 C# 与网页通信。

`.github/workflows/build.yml` 在 Windows runner 安装固定 .NET、Node 和 npm 版本，调用打包构建并上传未签名产物。工作流文件存在不等于远端 CI 已成功运行。

## 当前边界

- C# 只负责 WinUI 启动窗口；尚无应用服务、文档模型或持久化层。
- TypeScript 只负责独立 Web 入口提示；CodeMirror 依赖目前未接线。
- Markdig 尚未加入项目依赖；预览渲染尚不存在。
- 配置 JSON、SQLite、主题/动效系统、文件激活与恢复均未实现。
- 构建时嵌入 Web dist 是资源打包机制，不代表 WebView 集成完成。
- 运行、测试与打包证据及其限制见[项目历程](progress.md)。

## M1 目标架构（计划）

M1 先验证编辑、预览、中文输入与 WebView 安全边界，实施清单见[开发方案 M1](开发方案.md)。

- 桌面侧计划使用两个 WebView2：编辑器页面与预览页面职责分离。
- 两个 WebView2 计划共享受控的 WebView2 环境，以统一运行时配置和资源策略。
- CodeMirror 文档状态作为编辑文本权威；C# 文档会话负责路径、保存和跨宿主协调。
- M1 先走全量文本快照，经 C# 校验版本后交给 Markdig 解析并更新常驻预览页。
- Markdig 是计划中的 .NET 解析器；当前仍未引用、未实现，勿将计划图误读成现状。
- 后续按信任边界限制消息、导航、HTML、URL 与本地资源访问；细节由 M1/M2 验收门槛约束。
- M1 当前没有为“以后可能复用”引入 CoreLib、插件层或通用消息框架的依据。

## 文档维护

- 目录与职责随实际代码变化更新本文件。
- 新的稳定技术取舍记入[技术决策](decision.md)；不要在本文件复制整段决策理由。
- 每次阶段工作结束后，将结果、验证、限制和提交记入[项目历程](progress.md)。
- 产品行为和验收标准以[开发方案](开发方案.md)为准；工程命令以[工程开发指南](工程开发指南.md)为准。
