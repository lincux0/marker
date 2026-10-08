# 项目结构与架构基线

本文描述仓库当前真实结构。生产应用由 Win32 主窗口承载 WinUI 3 XAML Islands 工具栏与两个原生子窗口式 WebView2。M3 加入增量同步、视图模式、编辑阅读工具和版本化设置；M4 补充 Fluent 2 外观、系统材质与减少动画、窗口恢复、单实例文件激活及拖放。M4 开发与本机核心验收完成，用户输入法和动效体验回归通过；完整兼容与安装待验范围见建设历程。

- 当前状态：Win32 + WinUI 3 XAML Islands 工具栏 + 双原生 windowed WebView2；单文档打开/保存/另存为、恢复草稿、外部变化检查、受控本地图片、M3 编辑阅读和 M4 外观/文件激活已实现。M4 本机核心回归已完成；多屏、辅助功能和安装验收尚未全部完成。
- 多标签、文件树和 SQLite 尚未实现。
- 阶段计划见[开发方案](开发方案.md)；版本与构建操作见[工程开发指南](工程开发指南.md)。
- 稳定技术取舍见[技术决策](decision.md)，阶段记录见[项目历程](progress.md)。

## 仓库根目录

| 路径 | 职责 |
|---|---|
| `Marker.sln` | WinUI 应用与 MSTest 工程的解决方案入口。 |
| `global.json` | 固定 .NET SDK `10.0.401`，禁止自动 roll-forward。 |
| `src/` | 应用源代码，包含桌面端与独立 Web 工程。 |
| `tests/` | 自动化测试工程，覆盖桥接、Markdown、文件恢复和受控图片逻辑。 |
| `scripts/` | 本地 SDK 准备、构建、开发签名、MSIX 烟雾测试、Islands 生产宿主、M4 文件激活/网页回归和截图脚本。 |
| `experiments/Marker.IslandsProbe/` | 独立 Win32 + WinUI 3 XAML Islands + windowed WebView2 宿主实验，不属于解决方案或 MSIX。 |
| `.github/workflows/` | Windows CI 构建工作流定义；远端是否执行需看 Actions 记录。 |
| `docs/` | 产品方案、工程指南、架构、决策和历程文档。 |
| `AGENTS.md` | 仓库开发与文档持续维护要求。 |
| `LICENSE` | 项目 MIT 许可证。 |
| `THIRD_PARTY_NOTICES.md` | 当前直接依赖声明及许可证维护要求。 |
| `.tools/` | 仓库局部 SDK 和依赖缓存，不提交。 |
| `artifacts/` | 本地产物、截图和验证结果，不提交。 |
| `graphify-out/` | 本地图谱产物，不作为运行时或文档关系事实。 |

M4 检查入口为 `scripts/test-web-m4.js`（网页）、`scripts/test-webview-m4.js`（真实宿主文件桥接）、`scripts/test-activation-m4.ps1`（激活与真实 OLE）、`scripts/capture-marker.ps1`（实机截图），运行条件见工程指南。

## 当前模块

### `src/Marker.App/`

- `App.xaml`、`App.xaml.cs`：注册 WinUI 资源，通过 WinUI 应用消息泵创建并显示唯一 `MainWindow`；用 `AppInstance` 保证单实例运行，并通过并发队列串行路由后续 `.md`/`.markdown` 文件激活，避免编辑器初始化前丢失请求。
- `MainWindow.xaml`：定义两行、132 DIP 的文档/命令工具栏和默认收起的外观排版面板；面板展开增加约 84 DIP。控件包含文档操作、视图、撤销重做、查找替换、主题、字号、行高、折行及减少动画设置，并提供空白文档写作提示。
- `MainWindow.Views.cs`：加载设置、路由视图与排版控件；切换时仅调整两个原生子窗口的大小与可见性，保留 WebView2、编辑历史和页面状态。源码模式暂停预览解析并使在途解析结果过期；返回分栏/阅读时按最新快照重绘。主题与减少动画设置同步到 Web 内容。
- `AppSettings.cs`：LocalAppData/Marker/settings.json 的 schemaVersion 1 与 applicationVersion；保存主题、排版、视图、减少动画偏好及窗口普通位置。新增字段对旧 schema 1 文件可选；非法字段提示并回退，损坏/未知版本保留且禁写，合法设置通过同目录临时文件与覆盖式移动落盘。不存文档文本或自动打开文件。
- `MainWindow.Windows.cs`、`WindowPlacement.cs`：管理系统主题/高对比/Windows 动画偏好、DWM Mica 与系统色回退、Mica backdrop 的 XAML Island 配置、根窗口实色间隙画刷、减少动画即时停止以及多显示器普通位置恢复。新窗口为 960×700 DIP，最小尺寸 720×480 DIP；位置按目标显示器 DPI 换算、夹入工作区，并在 `WINDOWPLACEMENT` 工作区坐标与持久化屏幕坐标间换算，保留系统标题栏和 Snap 布局。
- `MainWindow.Activation.cs`、`MarkdownActivation.cs`：串行打开受支持的文件激活；校验完整路径及 `.md`/`.markdown` 扩展名；XAML Island 接收 `StorageItems` 拖放，根窗口与两个 WebView2 子窗口提供 `WM_DROPFILES` 兼容路径。
- `MainWindow.xaml.cs`：`MainWindow` 创建并管理 Win32 根 HWND、编辑器/预览子 HWND 和工具栏 XAML Island；负责客户区布局、焦点、DPI/窗口消息、WebView2 安全配置、桥接路由、异步 Markdown 解析及关闭流程。启动前检测 Evergreen Runtime，缺失时显示安装提示但不运行安装器。WebView2 的正文拖放通过 `AdditionalObjects` 接收原生 File 对象，宿主只从对象读取路径，不从 JSON 收取文件路径。`TryMoveFocus` 在文档模态操作期间、窗口/子窗口禁用、controller 不可见或已关闭时统一拒绝焦点迁移。
- `MainWindow.Documents.cs`：管理当前单文档会话、脏状态、原生文件选择器、命令/快照 requestId 往返、原生消息框确认、打开/保存/另存为/关闭/恢复流程、外部文件监控和每秒节流的草稿写入。保存前向 CodeMirror 请求最新完整快照；输入法组合尚未提交时拒绝保存。恢复草稿成为未命名副本，不自动覆盖来源文件。
- `DocumentFile.cs`：按严格 UTF-8（含/不含 BOM）或带 BOM 的 UTF-16 LE/BE 读取；解码失败由界面明确询问 GB18030。磁盘编码与换行保持为元数据，编辑快照统一 LF；混合换行须用户选择策略后保存。文件读取/保存限制 8 MiB，以 SHA-256 指纹检测变更，并通过同目录临时文件、flush-to-disk、原子替换和替换前后校验保存；并发替换的外部内容保留为 `.external` 副本。拒绝路径重解析点。
- `RecoveryStore.cs`：在 LocalAppData 的 Marker/Recovery 目录按文档 ID 保存 schemaVersion 1 JSON 草稿，附可选 `applicationVersion`；读取旧 schemaVersion 1 时允许该字段缺省。通过同目录临时文件及覆盖式移动保存。未知版本、损坏或超限草稿保留原文件并返回可提示错误。
- `LocalImageResources.cs`：仅允许当前文档目录内 PNG/JPEG/GIF/WebP/BMP 图片，单张不超过 16 MiB；拒绝绝对/越界/重解析路径，并从最终打开的文件句柄核验真实路径。通过会话绑定随机不透明 URL 提供资源，不将磁盘路径交给 Web 内容。
- `BridgeSession.cs`：校验页面来源、消息类型与字段白名单、会话标识、版本、JSON 深度和消息/文本大小；支持快照 requestId、命令和 snapshotError，并允许相同版本且相同文本的完整重同步。文本最多 1 Mi UTF-16 单元，JSON 消息最多 2 MiB。
- `MarkdownRenderer.cs`：使用 Markdig 管线，启用表格、任务列表、自动链接和强调扩展，禁用原始 HTML；图片链接必须通过本地受控资源解析器转换，否则从预览移除。
- `Package.appxmanifest`：MSIX 身份为 Marker、发布者 `CN=Marker.Dev`、x64，最低 build 26100，并注册 `.md`/`.markdown` 文件关联。
- `app.manifest`：桌面进程清单；声明 Per-Monitor V2 DPI 感知及 `asInvoker` 权限。
- `Assets/`：MSIX 使用的 PNG 磁贴/商店图标与窗口图标。
- `Marker.App.csproj`：WinUI 3、Windows App SDK、Markdig、自包含打包及 Web dist 内容映射。
- `packages.lock.json`：桌面端 NuGet 锁文件；锁文件版本才是实际依赖基线。

### `src/Marker.Web/`

- `package.json`、`package-lock.json`：Web 工程脚本、CodeMirror 6、DOMPurify 及锁定版本。
- `index.html`、`preview.html`：编辑器与预览独立页面入口，分别声明内容安全策略 CSP。
- `src/main.ts`：CodeMirror 6 编辑器；常规编辑立即发送旧文档 UTF-16 范围的 changes，初始化/保存/重同步发送完整快照。中文搜索面板使用既有 search 包，排版通过 Compartment 重配置并保留历史；组合输入期间保护保存与编辑命令。接收 host 的主题、强制配色与减少动画设置；深色语法样式使用 HighlightStyle 复用默认装饰并调整标记配色，随 Compartment 切换而保留历史。快捷键见工程指南。
- `src/preview.ts`：检查会话、版本及 HTML 大小，净化预览并回报版本。大纲按同一 Markdig AST 的标题 ID/UTF-16 偏移回源；HTTP(S) 链接经原生确认打开。复用已安装 JavaScript/Lezer 解析器，以 DOM 文本节点实现 JS/TS 围栏高亮；其他语言或超长代码保留纯文本。更新正文保留页面滚动，设置不重建 DOM。
- `src/file-drop.ts`：在编辑器和预览页接收文件拖放，只把受限的 `filesDropped` 元数据及 DOM `File` 对象发送给宿主；文件路径不序列化到消息 JSON。
- `src/style.css`、`src/preview.css`：编辑器和预览的明暗与强制配色、焦点状态、空文档提示、拖放反馈和减少动画样式。
- `vite.config.ts`：构建编辑器和预览两个本地页面入口。
- `tsconfig.json`：TypeScript 编译器设置。
- `dist/`：Vite 构建目录，由构建生成，不提交；Web 依赖随产物本地打包，不从 CDN 加载。

桌面端分别将 `editor.marker.example` 与 `preview.marker.example` 映射到包内 `Web/` 目录，使用两个 HTTPS 来源隔离页面。两个 WebView2 共享同一个环境，分别由原生子 HWND 承载。Win32 负责窗口和 WebView2 客户区布局；`DesktopWindowXamlSource` 仅承载顶部工具栏，不覆盖编辑区或预览区。宿主只允许对应页面和 `/assets/` 路径，关闭开发者工具、默认菜单和宿主对象，拦截其他导航、子框架及新窗口。

此宿主把 WinUI/XAML 与 windowed WebView2 放在不同 HWND，具备原生窗口的输入和 DPI 路径，但引入 HWND 空间约束：XAML Island 与 WebView2 子窗口之间需手动协调尺寸、Z 顺序、焦点、DPI 和关闭生命周期；原生子窗口也限制跨区域 XAML 裁剪、Composition 动画及覆盖式浮层。Mica 分别应用于 Win32 根窗口与 XAML Island；编辑器/预览保持不透明纸面，根 HWND 间隙使用明暗纯色，避免透材质干扰阅读。Composition 只作用于工具栏 Island 内部；减少动画偏好作用于应用自定义 Composition 与 Web CSS，不关闭 WinUI 内置系统动画。

### `tests/Marker.Tests/`

- `Marker.Tests.csproj` 与 `packages.lock.json`：MSTest 项目及锁定依赖。
- `BridgeSessionTests.cs`：覆盖可信来源、命令、快照 requestId / snapshotError、会话、字段、版本与尺寸校验。
- `MarkdownRendererTests.cs`：覆盖常见 Markdown、选定扩展、自动链接、原始 HTML 禁用、图片解析和受控长文完整性。
- `DocumentFileTests.cs`、`RecoveryStoreTests.cs`、`LocalImageResourcesTests.cs`：使用真实临时文件覆盖编码/换行、文件冲突与恢复、图片路径与内容边界；符号链接检查因测试环境权限跳过。测试结果以[项目历程](progress.md)中的最新实际记录为准。
- `AppSettingsTests.cs`：设置 roundtrip、字段类型/缺失回退、损坏与未来版本保留。
- `MarkdownActivationTests.cs`：支持的扩展名、完整路径与无效命令行路径筛选。
- 测试工程通过 Compile Link 直接复用桌面端八个纯逻辑源文件；目前无需额外抽取 `CoreLib`。

## 独立 Islands 宿主实验

`experiments/Marker.IslandsProbe/` 是独立 Release 原型：Win32 HWND 作为根窗口，`DesktopWindowXamlSource` 只承载工具栏，编辑器和预览分别放在原生子 HWND 的 windowed WebView2 controller 中。它复用生产 Web 内容、桥接会话和 Markdown 渲染源文件，但使用独立 WebView2 用户数据目录。该实验不修改 `src/Marker.App/`，不加入 `Marker.sln`，也不进入生产 EXE/MSIX。

用户在独立原型实机确认微信输入和候选框正常，并在窗口移动/缩放后仍正常；宿主随后获批迁入生产，用户也已确认生产微信输入法正常。原型自动烟测见 `artifacts/islands-probe-smoke.json`，系统 DPI 实测为 120，不能据此宣称它自动覆盖用户报告的 200% 缩放。生产无障碍与最低 build 尚未完整实测；生产 MSIX 安装仍待执行。

## 数据流与边界

1. 应用启动时通过 `AppInstance` 注册 Marker 单实例；文件激活和命令行参数进入并发队列，等待根窗口与编辑器就绪后才串行打开。每批最多 64 个文件，超限整批拒绝。启动恢复占用同一操作锁，并在异步步骤后复核文件激活，避免旧草稿抢占启动文件。创建窗口时恢复普通位置，并按目标显示器 DPI/work area 夹取。
2. 桌面端创建 Win32 根窗口、两个原生内容子窗口和工具栏 XAML Island；确认包内 `Web/index.html` 与 `Web/preview.html` 存在并检查 WebView2 Evergreen Runtime，再创建共享 WebView2 环境并为两个子窗口创建 controller。
3. 编辑器与预览发送 `ready` 后，桌面端建立文档会话并向 CodeMirror 初始化当前文档文本。文件命令经过来源、会话、字段和消息大小验证后交由原生侧执行。
4. CodeMirror 是编辑期唯一文本权威。所有消息声明 protocolVersion 1；常规编辑发送 baseVersion/version 连续的增量，原生缓存仅在来源、会话、范围、容量均合法后原子更新。拒绝增量时请求完整重同步；保存/切换仍带 requestId 请求最新完整快照，未结束的输入法组合通过 snapshotError 阻止文件操作。桥接 JSON 上限 2 MiB，文本上限 1 Mi UTF-16 单元。
5. 原生文档服务读取/保存本地文件、维护 SHA-256 指纹，并监控磁盘变化。保存前确认冲突并原子替换；恢复草稿独立存放，不自动写回原始路径。
6. 桌面端在后台使用 Markdig 解析最新快照；本地图片先经根目录、扩展名、大小、重解析点和最终文件句柄校验，再替换为会话随机 URL。WebView2 不接收任意文件路径或通用文件 API。
7. 预览检查会话、版本与 HTML 长度，通过 DOMPurify 白名单净化，再用 `innerHTML` 更新页面并回报已渲染版本。图片源仅允许当前会话资源 URL，CSP 只开放本地图片来源。
8. 系统高对比、系统颜色或 Windows 动画偏好变化时更新根窗口、XAML Island 与 WebView2 的外观/动画设置；Mica 不可用或开启高对比时使用系统色背景。
9. 应用激活、XAML/OLE 拖放和 WebView2 `AdditionalObjects` 文件对象均进入同一个串行文件打开队列；只有 `.md`/`.markdown` 路径进入既有未保存确认与文档读取流程。桥接只传计数和会话信息，宿主对原生文件对象及路径再次校验。
10. 窗口尺寸/位置变化时按客户区和当前 DPI 更新 Island 与两个子窗口，并通知 WebView2 宿主窗口位置变化；关闭前进行未保存确认，之后保存普通位置、释放主题监听和资源，再关闭 controller、释放 XAML Island 并销毁根窗口。

当前限制：文档读写与保存文本上限 8 MiB；恢复 JSON 草稿上限 8 MiB；桥接 JSON 最多 2 MiB（UTF-8），文本最多 1,048,576 个 UTF-16 单元，实际快照同时受两者约束；预览 HTML 最多 4,194,304 个 UTF-16 单元；单张本地图片最多 16 MiB。恢复写入的秒级节流及草稿写入节流意味着突发断电或进程崩溃可能丢失尚未落盘的最新尾部输入；本机强制退出重启场景已测通过，但断电、磁盘耗尽和更广泛的崩溃时序未验证。仅支持常见 UTF 编码 BOM 识别及明确的 GB18030 选择，不保证其他编码。预览仅支持受控 HTTP(S) 链接；不支持 SVG、表单和内联样式；图片只支持 PNG/JPEG/GIF/WebP/BMP。WebView2 Evergreen Runtime 由目标机器提供，应用只提示缺失，不自动安装。实际多屏、高对比整机、最低 build、读屏器与生产 MSIX 安装仍待验；多标签、文件树和 SQLite 暂未实现。

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

- 用户已确认生产 EXE 中微信输入法正常；M1 输入法与 Web 安全核心门槛已通过。M2 核心功能与本机闭环验证完成；生产 MSIX 安装仍未执行，作为独立包验收待办。
- M3 单元、Web、桌面和性能检查结果及未覆盖边界见[项目历程](progress.md)；文档中的阶段结果不替代最新一次构建记录。
- 独立原型仅使用内置样例，没有打开、保存、恢复、文件树、多标签或真实图片工作流。
- 当前生产版代码提供 M3 编辑阅读与 M4 视觉/动效/文件激活能力；M4 本机核心回归已完成，实际多屏、高对比整机、最低 build、读屏器与生产 MSIX 安装尚未全部完成。多标签、文件树、SQLite 和跨 HWND 内容动画仍未实现。
- 运行、测试与打包证据及其限制见[项目历程](progress.md)。

## 文档维护

- 目录与职责随实际代码变化更新本文件。
- 新的稳定技术取舍记入[技术决策](decision.md)，不要在此复制整段理由。
- 每次阶段工作结束后，将结果、验证、限制和提交记入[项目历程](progress.md)。
- 产品行为和验收标准以[开发方案](开发方案.md)为准；工程命令以[工程开发指南](工程开发指南.md)为准。
