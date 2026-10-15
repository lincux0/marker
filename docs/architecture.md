# 项目结构与架构基线

本文描述仓库当前真实结构。生产应用由 Win32 主窗口承载两个原生子窗口式 WebView2 和隐藏的 WinUI 3 XAML Island 兼容宿主。主编辑器 WebView 同时承载可见 HTML/CSS 浮动工具栏和 Markdown 编辑器；M3 曾实现源码、分栏和阅读模式，后续 D016 将交互改为单一正文编辑视图，CodeMirror 6 装饰在编辑时隐藏常用 Markdown 标记。Markdig 解析和受控资源桥接继续运行于隐藏的预览 WebView2。设置由独立 WinUI owned 窗口承载。各次构建与检查结果以[项目历程](progress.md)为准。

- 当前状态：Win32 + 双原生 windowed WebView2 + 隐藏为 1×1 的 XAML Island 兼容宿主；主编辑器 WebView 从客户区 `(0,0)` 铺满并承载正文及浮动工具栏，Markdig 预览 WebView 隐藏为 1×1 并继续承担解析/资源安全桥接。多文档文件流程、独立设置窗口、窗口位置和文件激活能力保留。
- SQLite 已用于本地设置持久化；多标签已实现，文件树尚未实现。
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
| `installer/` | Inno Setup 当前用户安装配置及 SQLite 依赖的完整许可证文本；`scripts/build-setup.ps1` 包装现有自包含 x64 Release 输出。 |
| `experiments/Marker.IslandsProbe/` | 独立 Win32 + WinUI 3 XAML Islands + windowed WebView2 宿主实验，不属于解决方案或 MSIX。 |
| `.github/workflows/` | Windows CI 构建工作流定义；远端是否执行需看 Actions 记录。 |
| `docs/` | 产品方案、工程指南、架构、决策和历程文档。 |
| `AGENTS.md` | 仓库开发与文档持续维护要求。 |
| `LICENSE` | 项目 MIT 许可证。 |
| `THIRD_PARTY_NOTICES.md` | 当前直接依赖声明及许可证维护要求。 |
| `.tools/` | 仓库局部 SDK 和依赖缓存，不提交。 |
| `artifacts/` | 本地产物、截图和验证结果，不提交。 |
| `graphify-out/` | 本地图谱产物，不作为运行时或文档关系事实。 |

M4 历史检查入口为 `scripts/test-web-m4.js`、`scripts/test-webview-m4.js`、`scripts/test-activation-m4.ps1` 和 `scripts/capture-marker.ps1`，运行条件见工程指南。M3 的视图切换脚本与 M4 的分栏/阅读场景脚本按旧三模式界面编写，不适用于 D016 单页 UI；只有更新脚本并明确新场景后才能用于当前验收。

## 当前模块

### `src/Marker.App/`

- `Assets/`：应用 ICO、`AppLogo.png` 与 MSIX 标识素材以用户提供的 `asserts/icon.svg` 为原图，先栅格化为 512×512 透明 `asserts/icon.png`；`scripts/build-icon-assets.ps1` 保留完整画布、原始留白和透明度，等比缩放并封装七尺寸 ICO，不额外施加圆角遮罩。PNG/ICO 随 EXE 输出复制；原生主窗口与设置窗口从输出 ICO 加载，按本轮验收要求，Web 顶栏只显示文档标题，不再显示应用图标。

- `App.xaml`、`App.xaml.cs`：注册 WinUI 资源，通过 WinUI 应用消息泵创建并显示唯一 `MainWindow`；使用 `DispatcherShutdownMode.OnExplicitShutdown`，避免关闭唯一 WinUI 设置窗口时自动结束 Win32 主窗口，主窗口关闭流程显式退出应用；用 `AppInstance` 保证单实例运行，并通过并发队列串行路由后续 `.md`/`.markdown` 文件激活，避免编辑器初始化前丢失请求。
- `MainWindow.xaml`：XAML Island 工具栏缩为 1×1 隐藏，保留原生控件字段及兼容 handler；主编辑器 WebView 从客户区原点 `(0,0)` 填满整个客户区。可见浮动工具栏放在编辑器 WebView 的 HTML/CSS 层内，覆盖随正文滚动的内容，不跨 HWND。
- `SettingsWindow.xaml`、`SettingsWindow.xaml.cs`：独立 WinUI 设置子窗口，由主窗口拥有并单例显示；提供外观、排版、字体卡片；SettingsComboBox 在下拉展开后的 UI 回合调整真实 PopupBorder 圆角，菜单使用不透明系统主题背景。设置即时应用并保存，包含主题、减少动画、字号、行高、段间距、自动换行、正文/H1/H2 字体、颜色组合、顶部栏功能显示和默认关闭的自动隐藏选择。窗口边界按 owner DPI 换算为物理坐标并夹入显示器工作区；滚动内容由限宽居中容器承载，关闭设置后排队恢复 Win32 owner 的可见性、前台和编辑焦点。主窗口关闭或文件操作期间不执行此恢复；主窗口关闭时一并关闭。
- `MainWindow.Views.cs`：加载外观设置并同步主题/动效偏好；旧 `viewMode` 设置仅为兼容读取，不启动写回迁移。从 SettingsDatabase 读取持久化值；启动读取失败时本次运行禁止写入，关闭并重新打开设置时安全重试并仅合并本次待保存字段。损坏或未知数据库仍以默认值运行且禁止覆盖，旧 JSON 损坏不会阻止首次建立新数据库；简短说明仅在设置窗口显示。
- `AppSettings.cs`：schemaVersion 1 设置模型及共用 JSON 字段验证/序列化；保存主题、字体、段间距、排版、减少动画、配色、顶部栏显示、自动隐藏和窗口位置。旧 JSON Load/Save 仅为兼容和测试保留，生产不再写设置 JSON。
- `SettingsDatabase.cs`：`%LOCALAPPDATA%/Marker/settings.db` 的 SQLite 单行设置表；DB `user_version` 和记录版本均为 1。生产启动读取，设置更改与窗口位置更改事务保存；64 KiB payload 限制，共用设置校验。首次导入有效旧 `settings.json`，损坏/未来 JSON 保留并以默认设置初始化新 DB；已有损坏/未来 DB 保留且禁写。目录、DB 与 journal/WAL/SHM 重解析点检查继续执行，采用 DELETE 回滚日志、无连接池。启动时临时读取失败可在重新打开设置时安全重试，并只合并失败期间变化的字段；损坏或未知版本库仍不得覆盖。

- `MainWindow.Windows.cs`、`WindowPlacement.cs`：管理系统主题/高对比/Windows 动画偏好、DWM Mica 与系统色回退、根窗口背景、减少动画即时停止以及多显示器普通位置恢复。新窗口为 960×700 DIP，最小尺寸 720×480 DIP；位置按目标显示器 DPI 换算、夹入工作区，并在 `WINDOWPLACEMENT` 工作区坐标与持久化屏幕坐标间换算，保留系统标题栏和 Snap 布局。
- `WritingPalette.cs`：根据配置的颜色组合与明暗主题统一提供背景/强调色；宿主客户区、系统标题栏 caption、设置窗口复用该配色，并与 Web 正文、预览及浮动工具栏 CSS 变量保持精确一致。高对比模式改用 Windows 系统色。
- `MainWindow.Activation.cs`、`MarkdownActivation.cs`：串行打开受支持的文件激活；校验完整路径及 `.md`/`.markdown` 扩展名；XAML Island 接收 `StorageItems` 拖放，根窗口与两个 WebView2 子窗口提供 `WM_DROPFILES` 兼容路径。
- `MainWindow.xaml.cs`：`MainWindow` 创建并管理 Win32 根 HWND、编辑器/隐藏预览子 HWND 和工具栏 XAML Island；负责客户区布局、焦点、DPI/窗口消息、WebView2 安全配置、桥接路由、异步 Markdig 解析及关闭流程，并拥有设置子窗口。编辑器图片只接收受控 `document.marker.example` URL，通过现有 `LocalImageResources.TryRead` 校验后响应；JSON 只传相对 Markdown 引用到随机会话 URL 的映射，不传磁盘绝对路径。启动前检测 Evergreen Runtime，缺失时显示安装提示但不运行安装器。文件拖放通过 `AdditionalObjects` 接收原生 File 对象，宿主不从 JSON 收取路径。
- `MainWindow.Documents.cs`：管理多个打开文档及当前活动会话、独立脏状态、原生文件选择器、命令/快照 requestId 往返、原生消息框确认、多选打开/保存/另存为/逐标签关闭/恢复流程、活动文档外部文件监控和每秒节流的草稿写入。外部修改事件经 300 ms 合并后读取受限原始字节指纹；`DiskChangeNotice` 对相同磁盘版本去重，通知与动作绑定会话和随机编号，重新加载先验证文件并确认未保存内容的丢弃。保存前向 CodeMirror 请求最新完整快照；输入法组合尚未提交时拒绝保存。恢复草稿成为未命名副本，不自动覆盖来源文件。
- `MainWindow.Export.cs`、`PdfExportFile.cs`：在主窗口安全处理 PDF 文件选择、当前编辑快照和 WebView2 打印流；采用 A4、约 15 mm 边距。准备失败时不写入目标，写入前的指纹冲突会拒绝覆盖；若替换时发生竞态，外部版本保存为 `.external` 并报告其路径。PDF 输出不改变 Markdown 源文件或其未保存状态。
- `DocumentFile.cs`：按严格 UTF-8（含/不含 BOM）或带 BOM 的 UTF-16 LE/BE 读取；解码失败由界面明确询问 GB18030。磁盘编码与换行保持为元数据，编辑快照统一 LF；混合换行须用户选择策略后保存。文件读取/保存限制 8 MiB，以 SHA-256 指纹检测变更，并通过同目录临时文件、flush-to-disk、原子替换和替换前后校验保存；并发替换的外部内容保留为 `.external` 副本。拒绝路径重解析点。
- `RecoveryStore.cs`：在 LocalAppData 的 Marker/Recovery 目录按文档 ID 保存 schemaVersion 1 JSON 草稿，附可选 `applicationVersion`；读取旧 schemaVersion 1 时允许该字段缺省。通过同目录临时文件及覆盖式移动保存。未知版本、损坏或超限草稿保留原文件并返回可提示错误。
- `LocalImageResources.cs`：仅允许当前文档目录内 PNG/JPEG/GIF/WebP/BMP 图片，单张不超过 16 MiB；拒绝绝对/越界/重解析路径，并从最终打开的文件句柄核验真实路径。通过会话绑定随机不透明 URL 提供资源，不将磁盘路径交给 Web 内容。
- `BridgeSession.cs`：校验页面来源、消息类型与字段白名单、会话标识、版本、JSON 深度和消息/文本大小；支持快照 requestId、文档命令和 snapshotError，并允许相同版本且相同文本的完整重同步。原生文档命令白名单含 `recover` 与 `settings`；命令 envelope 的来源、protocolVersion、sessionId 和字段精确校验维持原规则。文本最多 1 Mi UTF-16 单元，JSON 消息最多 2 MiB。打开、重载、草稿恢复、快照和增量结果共用完整保存快照容量校验，按 Web `JSON.stringify` 的 UTF-8 与字符转义规则计数，预留宿主快照请求字段；收到的原始消息仍另行检查 2 MiB 限额，拒绝时不改变会话内容和版本。
- `MarkdownRenderer.cs`：使用显式 Markdig 管线，启用表格、任务列表、自动链接、强调、脚注、数学和提示框所需扩展，禁用原始 HTML；同一 AST 提供 HTML、大纲与 `richContent` 富语法节点的 UTF-16 精确范围。脚注和五类已知提示框保留源位置/标识；图片链接必须通过本地受控资源解析器转换，否则以保留 alt 的安全文本占位，不输出被拒绝的源路径。
- `installer/Marker.iss`：当前用户 Setup 将 `.md`/`.markdown` 注册为 Marker 的打开方式候选，配置专用 ProgID 和带引号打开命令，安装/卸载刷新 Explorer；不设置默认应用或 UserChoice。`Package.appxmanifest`：MSIX 身份为 Marker、发布者 `CN=Marker.Dev`、x64，最低 build 26100，并注册 `.md`/`.markdown` 文件关联。
- `app.manifest`：桌面进程清单；声明 Per-Monitor V2 DPI 感知及 `asInvoker` 权限。
- `Assets/`：MSIX 使用的 PNG 磁贴/商店图标与窗口图标。
- `Marker.App.csproj`：WinUI 3、Windows App SDK、Markdig、自包含打包及 Web dist 内容映射；将项目 LICENSE、第三方声明和 `installer/licenses/*.txt` 映射到输出、publish 和 MSIX 的 `LICENSE.txt`、`THIRD_PARTY_NOTICES.md`、`licenses/`。Setup 通配复制排除这些附件，再从明确的源文件纳入，避免重复打包并保留缺失时编译失败的检查。
- `packages.lock.json`：桌面端 NuGet 锁文件；锁文件版本才是实际依赖基线。

### `src/Marker.Web/`

- `package.json`、`package-lock.json`：Web 工程脚本、CodeMirror 6、DOMPurify 及锁定版本。
- `index.html`、`preview.html`：编辑器与预览独立页面入口，分别声明内容安全策略 CSP。
- `src/document-tabs.ts`：左侧圆形悬浮文档按钮，按文档 ID 复用节点、显示首字/未保存标记及关闭入口；仅发送受当前桥接会话约束的标签命令。`main.ts` 校验宿主标签列表，并按文档 ID 缓存 CodeMirror 状态以保留撤销、选区和滚动位置，切换清空旧会话的图片与富语法资源。
- `src/toolbar.ts`：在编辑 WebView 内创建固定定位的浮动工具栏、文档标题、常用命令和窄窗溢出菜单。原生操作发送既有文档命令；撤销、重做、查找、替换、PDF 导出和代码模式由当前编辑器/宿主处理。接收经协议版本及 session 校验的 `toolbarState`，包含标题、通知和 busy 状态。支持按设置将常用功能移入“更多”菜单（设置入口常驻），实时显示本地字数/段数；自动隐藏开启后空闲 3 秒收起、指针进入顶部 8 px 区域时展开，悬停/焦点/菜单保持可用；宽度在普通宽窗为 1108 px，正文为 980 px。
- `src/disk-change.ts`：展示可关闭的磁盘修改通知，提供重新加载与关闭按钮；不自动改写文档或抢走编辑焦点。专用 `diskChange`/`diskChangeAction` 桥只传通知编号与动作，不接收页面指定路径；旧会话、旧通知及非白名单字段均被拒绝。
- `src/statistics.ts`：使用现有 CodeMirror Markdown 完整语法树剔除标记、链接目标及图片，中文逐字、其余文本按词统计；非空 Paragraph/Task 节点作为正文段落。编辑短暂停顿 180 ms 后更新，不经原生桥接或上传文档。
- `src/main.ts`：CodeMirror 6 编辑器；常规编辑立即发送旧文档 UTF-16 范围的 changes，初始化/保存/重同步发送完整快照。中文搜索面板使用既有 search 包，排版与代码语言通过 Compartment 重配置并保留历史；组合输入期间保护保存与编辑命令。接收 host 的主题、强制配色、减少动画和顶部栏自动隐藏设置；深色语法样式使用 HighlightStyle 复用默认装饰并调整标记配色，随 Compartment 切换而保留历史。使用 CodeMirror 原生 placeholder，与编辑内容、字号、源码模式共享编辑器行布局和光标坐标；模式切换前后保存并恢复编辑器视口，避免打开源码时跳到文尾。装配工具栏、即时 Markdown、专业语法装饰及快捷键；`richContent` 受来源、协议、session、文档版本、字段及 2 MiB 整包大小校验，编辑后立即失效。
- `src/live-markdown.ts`：复用 CodeMirror Markdown/GFM 语法树装饰常见 Markdown；新增代码语言与 AST-based math、脚注、提示框呈现。Math 范围来自 Markdig 权威 `richContent` 元数据，不对全文扫描美元符号；脚注引用为可操作上标，脚注定义只替换源前缀并在原位置显示，点击引用后定义提供回跳。进入源/选择编辑上下文时显示原文，修改文档即清除旧 metadata；任务复选框点击不再通过聚焦编辑器触发页面滚动。提示框仅替换识别出的 `[!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` 标记为标题，保留嵌套引用正文。HTML/编辑器语法不承诺全量一致；CodeMirror 侧坐标仍按 UTF-16 源偏移对齐。
- `src/annotations.ts`、`src/annotations.css`：脚注引用/定义导航按钮与五种提示框的专用装饰；跳转事件携带目标和返回偏移，由根编辑器状态管理失效与返回。
- `src/math.ts`、`src/math.css`：KaTeX 公式显示及错误/源码回退；只渲染 Markdig 提供的 TeX 范围，原始 TeX 可复制，MathML 和专用公式 SVG 输出受限处理。隐藏预览先去除容器外侧空白再解包 Markdig 的公式定界符。
- `src/code-languages.ts`：编辑器和隐藏预览共享 JS/TS/C#/Python/JSON/Shell 及 D027 新增的 20 类常用代码语言定义。编辑器文档超过 100,000 字符时停用语言解析器，跨阈值只重配语言 Compartment 并保留撤销历史；这是性能降级捷径，超长预览代码块为纯文本。
- `src/mermaid.ts`、`src/mermaid.css`：可见编辑器支持受限 Mermaid flowchart/graph/sequence diagram，使用懒加载、串行队列与复杂度门槛；生成 SVG 经专用白名单处理，不放宽普通 Markdown SVG 边界。普通预览不接 Mermaid widget；PDF 导出复用该模块的安全 SVG 渲染和队列，在预览页生成打印图表。
- `src/outline.ts`、`src/outline.css`：可见大纲默认收起，消费宿主同一 Markdig 结果的标题 ID/UTF-16 偏移；当前会话/版本及整包校验、编辑失效、200 项分页、宽窗停靠/窄窗浮层、滚动高亮、片段复制及返回原选区。`main.ts` 将页内片段交此模块，使用工具栏实际高度避让定位。
- `src/lightbox.ts`、`src/lightbox.css`：成功加载的受控图片通过独立按钮进入原生 dialog 灯箱，适配/原尺寸与缩放、焦点循环及 Esc 返回；资源更新关闭旧图。图片正文仍可编辑，链接图片保留 Ctrl+点击。
- U3 专注模式由 `main.ts` 与 `toolbar.ts` 保存会话状态，临时收起可选按钮，保留设置、退出及既有保存入口；退出恢复按钮偏好，不写设置数据库。
- `src/links.ts`：正文链接悬停显示“按ctrl并点击以访问”；只有 Ctrl+左键触发访问；页内片段本地定位，其余链接发送当前会话/版本的 `openLink`，普通点击、拖选与源码模式保持编辑。HTTP(S) 经宿主校验后直接交默认浏览器，页面不导航；本地 Markdown 复用文档打开与未保存保护，其他普通文件/目录由系统关联打开。
- `MarkdownLinkResolver.cs`：本地链接解析与路径边界，共用纯逻辑测试；相对地址基于已保存文档目录，盘符或 file URI 规范化后检查本地根、重解析点、编码路径与 ADS，拒绝 UNC、设备路径和危险文件类型。
- `src/preview.ts`：检查会话、版本及 HTML 大小，净化预览并回报版本。大纲按同一 Markdig AST 的标题 ID/UTF-16 偏移回源；HTTP(S) 链接经原生确认打开。复用共享语言配置，以 DOM 文本节点实现 JS/TS/C#/Python/JSON/Shell 及 D027 新增的 20 类常用语言的围栏高亮；其他语言或单块超长代码保留纯文本。普通预览有数学与代码高亮，脚注 HTML 也未适配为当前编辑器的脚注导航体验；不能据此宣称两视图能力一致。PDF 导出时由同一预览完成 KaTeX/Mermaid 和图片/字体就绪通知，随后由 WebView2 打印，不接收页面指定磁盘路径。
- `src/file-drop.ts`：在编辑器和预览页接收文件拖放，只把受限的 `filesDropped` 元数据及 DOM `File` 对象发送给宿主；文件路径不序列化到消息 JSON。
- `src/style.css`、`src/preview.css`：编辑器和预览的明暗与强制配色、主题 palette、可配置字体/排版、Web 浮动工具栏与减少动画样式。工具栏 fixed 并在视口内居中，与正文共享 980 px 纸面宽度及响应式边距变量；常规顶栏总宽 1108 px，比纸面宽 128 px，窄窗随纸面收缩且至少保留 16 px 外边距。纸面最小宽度与响应式目标宽度一致，并禁止 flex 收缩，避免容器挤压成极窄列。文档名可收缩并以原生省略号截断，保留完整名称 Tooltip；玻璃表面使用 36% 画布底色、32 px backdrop blur 和 1.5 倍饱和度，模糊随正文滚动的内容；首屏纸面与工具栏下沿保持 32 px 距离（滚动内边距随顶栏顶部偏移计算）。高对比模式停用透明模糊效果并回退到系统色。
- `public/app-logo.png`：由桌面端裁剪生成的 `Assets/AppLogo.png` 复制，为现有构建输出的同源图标副本；Web 顶栏已取消引用，不从 CDN 加载。
- `vite.config.ts`：构建编辑器和预览两个本地页面入口。
- `tsconfig.json`：TypeScript 编译器设置。
- `dist/`：Vite 构建目录，由构建生成，不提交；Web 依赖随产物本地打包，不从 CDN 加载。

桌面端分别将 `editor.marker.example` 与 `preview.marker.example` 映射到包内 `Web/` 目录，使用两个 HTTPS 来源隔离页面。两个 WebView2 共享同一个环境，分别由原生子 HWND 承载；编辑器占据从 `(0,0)` 开始的整个可见客户区，固定工具栏和正文处于同一 WebView2 文档，CSS backdrop blur 呈现正文从工具栏后方滚动的效果；预览隐藏为 1×1 并继续处理 Markdig 结果及受控图片资源。`DesktopWindowXamlSource` 也隐藏为 1×1，仅保留原生字段及 handler 兼容路径。编辑器 windowed WebView2、IME 输入宿主和桥接 session 校验没有变化。宿主只允许对应页面和 `/assets/` 路径，关闭开发者工具、默认菜单和宿主对象，拦截其他导航、子框架及新窗口。

此宿主把 WinUI/XAML 与 windowed WebView2 放在不同 HWND，具备原生窗口的输入和 DPI 路径，但引入 HWND 空间约束：XAML Island 与 WebView2 子窗口之间需手动协调尺寸、Z 顺序、焦点、DPI 和关闭生命周期；原生子窗口也限制跨区域 XAML 裁剪、Composition 动画及覆盖式浮层。现将可见工具栏置于编辑器 WebView 的 CSS 层，使浮动工具栏和滚动正文处于同一个窗口；原生 XAML Island 隐藏为 1×1。DWM 主窗口 backdrop 和宿主 caption 配色仍保留；D017 原有可见原生 Acrylic 工具栏已由 D018 替代。

### `tests/Marker.Tests/`

- `Marker.Tests.csproj` 与 `packages.lock.json`：MSTest 项目及锁定依赖。
- `BridgeSessionTests.cs`：覆盖可信来源、命令、快照 requestId / snapshotError、会话、字段、版本与尺寸校验。
- `MarkdownRendererTests.cs`：覆盖常见 Markdown、选定扩展、自动链接、原始 HTML 禁用、图片解析和受控长文完整性。
- `DocumentFileTests.cs`、`RecoveryStoreTests.cs`、`LocalImageResourcesTests.cs`：使用真实临时文件覆盖编码/换行、文件冲突与恢复、图片路径与内容边界；符号链接检查因测试环境权限跳过。测试结果以[项目历程](progress.md)中的最新实际记录为准。
- `AppSettingsTests.cs`、`SettingsDatabaseTests.cs`：设置 roundtrip、字段类型/缺失回退，以及 SQLite 跨连接恢复、旧 JSON 迁移、损坏/未来库保留和事务回滚。
- `MarkdownActivationTests.cs`：支持的扩展名、完整路径与无效命令行路径筛选。
- 测试工程通过 Compile Link 直接复用桌面端八个纯逻辑源文件；目前无需额外抽取 `CoreLib`。

## 独立 Islands 宿主实验

`experiments/Marker.IslandsProbe/` 是独立 Release 原型：Win32 HWND 作为根窗口，`DesktopWindowXamlSource` 只承载工具栏，编辑器和预览分别放在原生子 HWND 的 windowed WebView2 controller 中。它复用生产 Web 内容、桥接会话和 Markdown 渲染源文件，但使用独立 WebView2 用户数据目录。该实验不修改 `src/Marker.App/`，不加入 `Marker.sln`，也不进入生产 EXE/MSIX。

用户在独立原型实机确认微信输入和候选框正常，并在窗口移动/缩放后仍正常；宿主随后获批迁入生产，用户也已确认生产微信输入法正常。原型自动烟测见 `artifacts/islands-probe-smoke.json`，系统 DPI 实测为 120，不能据此宣称它自动覆盖用户报告的 200% 缩放。生产无障碍与最低 build 尚未完整实测；生产 MSIX 安装仍待执行。

## 数据流与边界

1. 应用启动时通过 `AppInstance` 注册 Marker 单实例；文件激活和命令行参数进入并发队列，等待根窗口与编辑器就绪后才串行打开。每批最多 64 个文件，超限整批拒绝。启动恢复占用同一操作锁，并在异步步骤后复核文件激活，避免旧草稿抢占启动文件。创建窗口时恢复普通位置，并按目标显示器 DPI/work area 夹取。
2. 桌面端创建 Win32 根窗口、两个原生内容子窗口和兼容用工具栏 XAML Island；Island 随后缩为 1×1 隐藏，编辑器子窗口铺满客户区；确认包内 `Web/index.html` 与 `Web/preview.html` 存在并检查 WebView2 Evergreen Runtime，再创建共享 WebView2 环境并为两个子窗口创建 controller。
3. 编辑器与预览发送 `ready` 后，桌面端建立文档会话并向 CodeMirror 初始化当前文档文本。文件命令经过来源、会话、字段和消息大小验证后交由原生侧执行。
4. CodeMirror 是编辑期唯一文本权威。所有消息声明 protocolVersion 1；常规编辑发送 baseVersion/version 连续的增量，原生缓存仅在来源、会话、范围、容量均合法后原子更新。拒绝增量时请求完整重同步；保存/切换仍带 requestId 请求最新完整快照，未结束的输入法组合通过 snapshotError 阻止文件操作。桥接 JSON 上限 2 MiB，文本上限 1 Mi UTF-16 单元。
5. 原生文档服务读取/保存本地文件、维护 SHA-256 指纹，并监控磁盘变化。保存前确认冲突并原子替换；恢复草稿独立存放，不自动写回原始路径。
6. 桌面端在后台使用 Markdig 解析最新快照；本地图片先经根目录、扩展名、大小、重解析点和最终文件句柄校验，再替换为会话随机 URL。编辑器另收到相对 Markdown 图片引用至受控 URL 的精确版本映射，不含磁盘绝对路径；只允许 `document.marker.example` 图片请求经 `LocalImageResources.TryRead` 读取。映射受现有消息容量限制，未能送达的图片显示 alt 占位。
7. 预览检查会话、版本与 HTML 长度，通过 DOMPurify 白名单净化，再用 `innerHTML` 更新页面并回报已渲染版本。图片源仅允许当前会话资源 URL，CSP 只开放本地图片来源。
8. 系统高对比、系统颜色或 Windows 动画偏好变化时更新根窗口、XAML Island 与 WebView2 的外观/动画设置；Mica 不可用或开启高对比时使用系统色背景。
9. 应用激活、XAML/OLE 拖放和 WebView2 `AdditionalObjects` 文件对象均进入同一个串行文件打开队列；只有 `.md`/`.markdown` 路径进入既有未保存确认与文档读取流程。桥接只传计数和会话信息，宿主对原生文件对象及路径再次校验。
10. 窗口尺寸/位置变化时按客户区和当前 DPI更新隐藏 Island 与两个子窗口；编辑器 WebView 从 `(0,0)` 调整为完整客户区边界。关闭前进行未保存确认，之后保存普通位置、释放主题监听和资源，再关闭 controller、释放 XAML Island 并销毁根窗口。
11. PDF 导出由系统保存对话框选路径，编辑器提供当前快照，隐藏预览按会话/版本准备打印内容并回报就绪；宿主使用 WebView2 打印流写入同目录临时文件，核对目标文件指纹后替换。

当前限制：文档读写与保存文本上限 8 MiB；恢复 JSON 草稿上限 8 MiB；桥接 JSON 最多 2 MiB（UTF-8），文本最多 1,048,576 个 UTF-16 单元，实际快照同时受两者约束；`richContent` 超限时整包清空而不截断；预览 HTML 最多 4,194,304 个 UTF-16 单元；单张本地图片最多 16 MiB。编辑页单次图片资源映射亦受 2 MiB 桥接消息上限约束，超过部分退化为 alt 占位。即时呈现与 Markdig 最终 HTML 不保证一致：编辑器已支持 Markdig range 驱动的行内/块公式、脚注引用/定义、五类已知提示框与受限 Mermaid；预览当前只有数学和代码高亮，脚注语义/跳转和 Mermaid widget 尚未适配。编辑器代码语言范围为 JS/TS/C#/Python/JSON/Shell 及 D027 新增的 20 类常用语言，超 100,000 字符文档会停用语言装饰；预览单块代码超过 100,000 字符降为纯文本。恢复写入的秒级节流及草稿写入节流意味着突发断电或进程崩溃可能丢失尚未落盘的最新尾部输入。仅支持常见 UTF 编码 BOM 识别及明确的 GB18030 选择，不保证其他编码。预览仅支持受控 HTTP(S) 链接；不支持用户任意 SVG、表单和内联样式；图片只支持 PNG/JPEG/GIF/WebP/BMP。WebView2 Evergreen Runtime 由目标机器提供，应用只提示缺失，不自动安装；多标签已实现，文件树尚未实现。

## 构建与打包管线

`scripts/build.ps1` 是统一构建入口，命令细节以[工程开发指南](工程开发指南.md)为准。

1. 选择仓库局部 `.tools/dotnet/dotnet.exe`，否则使用 PATH 中的 dotnet。
2. 把 dotnet、NuGet、npm 状态及包缓存定向到 `.tools/`。
3. 在 `src/Marker.Web/` 执行 `npm ci`、`npm run check` 和 `npm run build`。
4. 对 `Marker.sln` 执行锁定模式 NuGet restore，平台为 x64。
5. 构建 Release 解决方案并运行测试工程；具体测试结果以本次实际运行记录为准。
6. 使用 `-Package` 时生成未签名 x64 MSIX 到 `artifacts/msix/`。
7. `Marker.App.csproj` 将 `Marker.Web/dist/**/*` 以 `Web/` 前缀复制进应用输出/包。

`scripts/build-setup.ps1` 默认复用上述 Release 构建/测试，再用固定并校验来源的 Inno Setup 编译器与 `installer/Marker.iss` 生成当前用户 Setup.exe 到 `artifacts/setup/`。它打包自包含应用、资源与许可证，不打包测试工程、PDB 或 MSIX 容器；WebView2 Runtime 仍须目标机预先安装。默认安装于 `%LOCALAPPDATA%/Programs/Marker`，卸载保留应用数据目录；不设置文件默认关联，当前产物未签名。

`.github/workflows/build.yml` 在 Windows runner 安装固定 .NET、Node 和 npm 版本，调用打包构建并上传未签名产物。工作流文件存在不等于远端 CI 已成功运行。

## 未完成验收与后续边界

- 用户已确认生产 EXE 中微信输入法正常；M1 输入法与 Web 安全核心门槛已通过。M2 核心功能与本机闭环验证完成；生产 MSIX 安装仍未执行，作为独立包验收待办。
- M3 单元、Web、桌面和性能检查结果及未覆盖边界见[项目历程](progress.md)；文档中的阶段结果不替代最新一次构建记录。
- 独立原型仅使用内置样例，没有打开、保存、恢复、文件树、多标签或真实图片工作流。
- 当前生产宿主具备 Win32/XAML Islands/双 WebView2 边界、单页即时呈现和独立设置窗口。旧 M3 视图脚本不覆盖此单页 UI。多标签已实现；文件树和跨 HWND 内容动画仍未实现；SQLite 设置持久化已实现。
- 运行、测试与打包证据及其限制见[项目历程](progress.md)。

## 文档维护

- 目录与职责随实际代码变化更新本文件。
- 新的稳定技术取舍记入[技术决策](decision.md)，不要在此复制整段理由。
- 每次阶段工作结束后，将结果、验证、限制和提交记入[项目历程](progress.md)。
- 产品行为和验收标准以[开发方案](开发方案.md)为准；工程命令以[工程开发指南](工程开发指南.md)为准。
