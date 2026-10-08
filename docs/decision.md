# 技术决策

记录已经确认且会影响实现或发布的取舍。产品需求与分阶段验收见[开发方案](开发方案.md)；当前目录结构见[架构基线](architecture.md)，历程见[项目历程](progress.md)。

状态：**已采纳**表示当前基线；**待落实**表示已有决定但相关能力/凭据尚未完成；**延期**表示明确不进入当前阶段。

## D001 产品与包身份

- 状态：已采纳；M0 已落入包清单。
- 产品名与 MSIX Identity Name：`Marker`；开发证书主题：`CN=Marker.Dev`。
- 理由：让产品显示名、包身份与开发签名流程保持一致。
- 代价：Identity 和发布者变化可能影响升级识别；正式发布前应冻结包身份。
- 实现位置：`src/Marker.App/Package.appxmanifest`。

## D002 许可证

- 状态：已采纳。
- 项目使用 MIT；根目录 `LICENSE` 为准，许可证决策由项目维护者负责。
- 理由：采用简单、宽松的开源许可证，方便复用和贡献。
- 代价：MIT 不替代第三方组件许可证义务；发布时需完成完整依赖及随包文件审查。
- 现有直接依赖记录见根目录 `THIRD_PARTY_NOTICES.md`，传递依赖盘点仍待发布阶段。

## D003 支持平台

- 状态：已采纳；M0 清单目标为 Windows build 26100、x64。
- 首发支持 Windows 11 24H2 及更新的受支持版本，最低 build `26100`，架构 x64。
- Windows 10 与 ARM64 暂不纳入首发支持承诺。
- 理由：先控制兼容矩阵，并以方案所选 WinUI/Windows App SDK 工具链作为目标。
- 代价：暂时不覆盖更旧 Windows 设备与 ARM64 用户。
- 本机 M0 安装记录在 build 26300；不等于在最低 build 26100 设备验收。

## D004 开发工具链

- 状态：已采纳并在 M0 工程锁定。
- 桌面：C#、.NET SDK `10.0.401`、WinUI 3、Windows App SDK `2.5.1`。
- Windows SDK Build Tools NuGet：`10.0.26100.9169`。
- Web：Node `24.19.x`、npm `12.x`、Vite `8.3.3`、TypeScript `7.0.2`。
- CodeMirror 6 依赖固定在 `src/Marker.Web/package.json`；准确包版本以该文件和 lockfile 为准。
- 理由：WinUI 承担 Windows 原生窗口，Web 工程承载可独立迭代的编辑器。
- 代价：CLI 构建同时需要 .NET、Node、Windows 打包工具链；WebView2 Runtime 仍需目标系统提供。
- 维护规则：`global.json`、项目清单和锁文件是实际版本依据，文档不替代它们。

## D005 编辑器与网页宿主

- 状态：已采纳并迁入生产源码。生产使用 Win32 根窗口、承载工具栏的 WinUI 3 `DesktopWindowXamlSource`，以及分别承载 CodeMirror 编辑器和预览的两个原生子 HWND/windowed WebView2 controller。用户已确认迁移后的生产 EXE 微信输入法正常，M1 输入法与安全核心门槛通过并获准进入 M2；本轮 MSIX 安装尚未执行，独立待验。
- CodeMirror 6 通过 Vite 本地资源构建；两个 WebView2 共享 `CoreWebView2Environment`，并使用不同的 HTTPS 虚拟主机来源。WinUI 应用仍提供消息泵，Win32 根窗体由 `MainWindow` 注册和管理。
- CodeMirror 文档为编辑期唯一文本权威，桌面端通过全量快照、会话标识和版本号与编辑器/预览协调；先不引入增量 patch。
- 理由：保留成熟编辑器历史能力，并采用经独立原型与迁移后生产 EXE 双重用户验收可正常进行微信输入及候选框定位的宿主组合。
- 代价：快照随文档大小增长，当前限制 1 Mi UTF-16 单元；全量解析和 WebView2 消息负担需在更大文档场景评估。Win32 HWND 布局需手动管理尺寸、DPI、焦点交接、Z 顺序和关闭生命周期；XAML 与原生 WebView2 子窗口存在 airspace 限制，可能影响跨区域动画、裁剪和浮层。M1 核心门槛已通过，但读屏器、最低 build 26100 和本轮 MSIX 安装仍待独立验收。模态文件选择器异步完成后的焦点恢复由统一 `TryMoveFocus` 检查忙碌/窗口启用/controller 可见状态；实机曾观察到焦点恢复路径异常，WinUI/WebView2 API 未说明该精确时序条件，时序解释属于实现推断。
- M2 正在为单文档工作流增加本地文件与受控图片路径，范围和安全不变量见 D013。
- 2026-10-07 宿主实验与迁移：WinUI `Window` 内的原生子 HWND/windowed WebView2 路径无法通过物理输入检查，未采纳。后续独立原型改为 Win32 主窗口、工具栏使用 WinUI 3 XAML Islands、编辑器与预览放入原生子 HWND 的 windowed WebView2。用户确认原型中的微信输入、候选框及移动/缩放后表现正常；原型自动烟测实测 DPI 为 120，不能证明用户报告的 200% 缩放已被自动测量。维护者随后确认迁入生产，当前生产源码采用同一宿主组合；用户已确认生产 EXE 微信输入法正常。无障碍、最低 build 和生产 MSIX 安装仍分别待验。

## D006 Markdown 解析

- 状态：Markdig 1.4.0 已加入项目引用并用于生产预览；本地 NuGet nuspec 声明许可证 SPDX 为 `BSD-2-Clause`。
- C# 侧在后台统一解析全量快照，再向常驻预览视图提供版本化 HTML。
- 当前启用 PipeTables、TaskLists、AutoLinks、EmphasisExtras，禁用原始 HTML；预览净化移除链接元素及其 URL 属性，图片仅由 M2 受控本地图片解析器提供。
- 理由：解析集中于宿主可统一管理扩展、资源边界和版本更新。
- 代价：前后端需定义文本快照、版本号和 HTML 安全传递方式。
- 语法扩展、安全规则和真实兼容范围以[开发方案](开发方案.md)及实际管线为准；M1 只覆盖已验证的有限扩展。

## D007 配置与存储

- 状态：轻量 JSON 设置已实现；SQLite 延期。M4 在 schema 1 中加入可选减少动画偏好、窗口位置，D017 继续加入可选字体、段间距与配色字段；旧 schema 1 缺少新增字段时静默使用默认值。D016 后旧 `viewMode` 只为兼容读取，不自动迁移写回。
- 计划用 JSON 保存轻量设置；Markdown 文档首发保存在普通本地文件中。
- SQLite 仅在需要查询型元数据、规模化历史或跨文档关系后重新评估。
- 恢复草稿与设置使用各自独立的 schemaVersion 1 JSON，并记录 applicationVersion。设置持久化已在 M3 实现；不把设置当文档恢复库。设置字段无效时单字段回退默认值并提示；损坏或未来 schema 使用默认值且禁止覆盖原文件。说明只在独立设置窗口显示，不展示底层 JSON 异常或重复启动提示。
- 理由：M0/M1 没有数据库功能需求，M2 草稿也无需查询型存储，避免引入迁移与数据维护成本。
- 代价：复杂查询或多实体事务需求出现时，JSON 不适合作为数据库替代品。

## D008 视觉与动效

- 状态：M4 系统材质、Fluent 2 shell 与减少动画已实现，本机核心检查及用户输入法/动效体验回归通过；多屏、整机高对比与读屏器仍待验。
- Win32 根窗口使用 DWM 主窗口 backdrop，顶部 XAML Island 使用与正文同色的实色底层，其浮起表面使用 Acrylic；高对比或 backdrop 不可用时回退到系统色背景。编辑器/预览保留不透明纸面，窗口间隙用主题实色填充以保持阅读对比度。
- 约 84 DIP 工具栏承载常用文档命令与设置入口，另为真实文件错误保留约 24 DIP 状态区；外观/排版选项位于独立 WinUI 设置窗口。圆角玻璃工具栏使用 Acrylic、渐变描边和 ThemeShadow，阴影接收器仅在工具栏 Island 内，不覆盖不同 HWND 上的正文。高对比模式关闭 Acrylic/阴影并采用系统色，Acrylic 无法使用时退化为纯色。代码模式默认收起文字标签，但 Tooltip、无障碍名称和窄窗溢出项标签保留。全局命令由 WinUI Island 路由，窗口保留系统标题栏与 Snap 行为。
- Composition 仅用于工具栏 Island 内部短暂入场反馈（167 ms opacity、250 ms scale）；不跨 HWND 动画。用户“减少动画”或 Windows `UISettings.AnimationsEnabled=false` 会停止应用自定义 Composition 与 Web CSS 动画；WinUI 内置动画继续遵循系统策略。
- 理由：Fluent 2 建议短时、自然并提供无动效方式；轻量玻璃与阴影只塑造工具栏 Island 内部层级，编辑/阅读内容维持稳定表面。整条宿主 band 和系统标题栏 caption 跟随选中的配色背景，避免与正文形成异色边框。
- 代价：XAML Island 与 windowed WebView2 处于不同 HWND，不能做覆盖编辑器/预览的连续 Composition 动画；目标系统材质、缩放和辅助功能仍需实机检查。
- 依据：[Fluent 2 motion](https://fluent2.microsoft.design/motion)、[Mica material](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)、[DWM system backdrop](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)、[DwmSetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmsetwindowattribute)、[DesktopWindowXamlSource.SystemBackdrop](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.hosting.desktopwindowxamlsource.systembackdrop)。

## D009 分发渠道

- 状态：已采纳站外 MSIX；Microsoft Store 为后续候选。
- M0 生成的开发包可用于本机安装验证，不是公开发布包。
- 理由：当前发布规划选择 MSIX 作为站外安装载体。
- 代价：公开站外分发需要受信任的生产签名链及升级/安装验收。
- 正式签名账号、证书或服务的供应方尚未知；维护者用户需在 M5 前提供凭据或签名服务。
- 私钥不得提交仓库或写入普通 CI 日志；CI 当前只生成未签名包。

## D010 开发证书信任边界

- 状态：M0 操作已记录，当前用户开发签名材料保留。
- 开发证书在当前用户 `CurrentUser\My` 创建，私钥不可导出；公钥导入 `CurrentUser\TrustedPeople`。
- 本机安装测试曾临时导入 `LocalMachine\TrustedPeople`；测试结束已移除。
- 不将开发证书放入系统 Root；排查时创建的当前用户 Root 条目也已清理。
- 理由：区分当前用户开发签名与系统级安装信任，限制信任范围。
- 代价：自签名包不能直接作为通用公开安装包；其他机器必须另行建立适当信任或使用生产证书。
- 后续如复用开发证书，按[工程开发指南](工程开发指南.md)的脚本和指纹检查流程操作。

## D011 测试与抽象边界

- 状态：M2 核心逻辑有 MSTest 覆盖。
- MSTest 覆盖 BridgeSession 命令/快照/requestId/错误、Markdig、DocumentFile 编码/换行/冲突、RecoveryStore 写入覆盖/旧 schema 兼容/损坏/未知版本，以及 LocalImageResources 路径/图像边界。最新本机运行 21 通过、1 跳过；符号链接用例因权限限制跳过。
- 纯逻辑实现通过测试工程 Compile Link 直接复用，没有另建 CoreLib。
- 自动测试不能证明 WebView2 导航/CSP/本地资源策略或真实输入法行为；这些仍需集成和实机验收。
- 维护规则：新增可测业务行为时一并增加针对行为的检查，不将测试运行器启动等同为业务验收。

## D012 WebView2 桥接与预览信任边界

- 状态：生产 Win32/XAML Islands 双 windowed WebView2 使用来源/会话/字段/版本/大小白名单桥接；用户已确认生产 IME 正常，M1 的输入和安全核心门槛通过。Web 安全回归 9 类检查通过；MSIX 安装未执行，读屏器与最低 build 仍待验。
- 两个视图只从包内 Web 资源加载，使用 `editor.marker.example` 与 `preview.marker.example` 两个来源；宿主限定页面导航、页面资源路径、消息来源、字段、会话、消息深度与尺寸，并拒绝 frame 导航和新窗口。编辑器 CSP 只为受控的 `document.marker.example` 图片端点开放 `img-src`。
- 不暴露 WebView2 Host Object 或通用文件 API。文件命令和快照经会话桥接；本地图片只通过受控 `document.marker.example` 资源端点响应。单页编辑的图片映射由相对 Markdown 引用和随机会话 URL 组成，不包含原始路径；原生端仍从已验证路径/句柄读取，未通过映射容量的图片回退 alt 占位。Markdig 禁用原始 HTML；预览通过 DOMPurify 白名单后写入 DOM，并由 CSP 限制网络、对象、表单和 frame。
- 单页正文新增受限 `openLink` 消息，复用既有来源、协议、会话、当前文档版本、字段与 URL 校验；编辑器不获得预览的 `revealSource` 权限。编辑器和预览共用原生外链确认入口。
- M4 正文拖放用 `postMessageWithAdditionalObjects` 单独传送原生 File 对象；JSON 只携带已校验会话、类型和文件数。宿主校验来源/会话/协议、对象数量与 `.md`/`.markdown` 扩展名后读取 `CoreWebView2File.Path`，绝不接受网页 JSON 提供的任意磁盘路径。
- 理由：将原生文件操作和受限图片读取留在宿主，网页只接收当前文档文本、HTML 和不透明资源引用。
- 原先 M1/M2 禁止所有预览超链接；M3 由 D014 替代该限制，仅开放经宿主确认的 HTTP(S) 与受控本页标题定位。SVG、表单等仍拒绝；安全样例通过不替代发布验收。
- 依据：[WebView2 postMessageWithAdditionalObjects](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/javascript/webview#postmessagewithadditionalobjects)、[CoreWebView2WebMessageReceivedEventArgs.AdditionalObjects](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2webmessagereceivedeventargs#additionalobjects)。

## D013 本地文档与图片资源安全

- 状态：M2 核心功能与本机核心闭环验证完成；发布和兼容验收待完成。
- Markdown 保持普通本地文件；读写支持严格 UTF-8（有/无 BOM）和 BOM UTF-16LE/BE，无法解码时经原生提示允许用户明确选择 GB18030。编辑器快照统一 LF，保存时恢复原 BOM/编码与 LF、CRLF 或 CR；混合换行保存前须选择统一策略。
- 文档读写最多 8 MiB，恢复 JSON 草稿最多 8 MiB；普通编辑桥接仍受 2 MiB JSON 和 1 Mi UTF-16 文本双限制。保存校验 SHA-256 指纹，先写同目录临时文件并 flush 到磁盘，再原子替换；保存期间限制普通写入，复核替换前后内容。并发替换时保留 `.external` 副本并报告冲突。
- 恢复草稿按文档 ID 保存 schemaVersion 1 JSON，增加可选 `applicationVersion` 元数据；旧 schema 1 文件缺少该属性仍可读取。写入采用同目录临时文件加覆盖式移动。维护者在真实私有 Recovery 目录验证时观察到 `File.Replace` 抛出“无法删除要被替换的文件”，而覆盖式 `File.Move` 探针成功；原因未知，不推断为 EFS 或某一种文件系统特性。
- 恢复只创建未命名副本，原路径仅作来源/差异提示，绝不自动写回或覆盖原文件；关闭/切换时由用户确认保存、放弃或取消。M3 增量即时同步、预览约 100 ms 合并，草稿约 1 秒节流；突然断电或崩溃仍可能丢失尚未写入的最新尾部内容。
- 本地图片只接受文档目录内 PNG/JPEG/GIF/WebP/BMP，单张不超过 16 MiB；通过路径规范化、解码遍数限制、重解析点检查和最终打开句柄真实路径复核，并以当前会话随机令牌映射不透明资源 URL。
- 理由：保留 Markdown 普通文件互操作性，同时把并发保存、崩溃恢复和本地图片读取作为独立的原生信任边界；私有 Recovery 目录上的探针结果支持草稿使用覆盖式移动替换。
- 代价：M2 当前单文档，无工作区、多标签、图片复制/粘贴或图片资产搬迁；编码种类与文件大小受限。文件监控不是保存安全的唯一依据，保存时仍必须执行指纹复核。

## D014 M3 编辑阅读与增量协议

- 状态：增量协议、编辑历史、Markdig 解析和安全边界继续适用；其源码/分栏/阅读三模式交互已由 D016 取代。以下模式行为记录 M3 原始实现，不代表当前界面。
- 常规编辑立即发送 protocolVersion 1、baseVersion/version 与旧文档 UTF-16 范围增量。初始化、保存、重同步保留完整快照；重复、跳号、重叠及乱序增量不改变原生缓存。字数明确显示为 UTF-16 单元，不冒充中文词数。
- 源码、分栏和阅读模式共用原有两个 WebView2；仅改变窗口布局与可见性。主题/排版用 CodeMirror Compartment 和 CSS 更新，不重建文档或历史。
- 模式切换保留同一编辑器实例的历史与光标，也保留预览滚动位置。源码模式暂停预览解析并使在途结果过期；返回分栏/阅读时从最新快照重新解析，避免隐藏视图持续消耗解析工作。
- 标题 HTML、大纲和源码偏移来自同一 Markdig AST。代码围栏复用现有 CodeMirror/Lezer 依赖，仅 JS/TS 高亮；未知语言与超过 100,000 字符的单块降级纯文本。大纲超过 10,000 项或无效时隐藏大纲，不阻断正文。
- 预览强调扩展只启用删除线；CodeMirror 的 GFM 语言提供编辑高亮，最终语法以预览 AST 为准。表格对齐由同一 AST 输出安全 align 属性，以保留排版并继续禁止内联 style。
- HTTP(S) 链接先净化并验证协议及无 userinfo，再转原生消息；显示完整地址并以默认“否”的确认框打开系统浏览器。页面自身不导航、不获取远程图片。
- 设置缺字段或单字段无效时回默认值并提示；损坏和未知 schema 原文件保留，应用禁止覆盖。视图状态保存在设置中，不存文档全文，不自动重开文件。初始化控件事件须在加载设置前禁写。
- 代价：预览采用完整 HTML 更新；当前在约 100 ms 安静窗口后解析以合并快速输入，不引入缓存。性能探针表明超长文档的持续编辑不保证实时舒适；具体样本、对照和测量范围见项目历程，不将单次输入到预览完成时间解释为连续输入延迟或帧率保证。
- 兼容范围以[样例](samples/m3-compatibility.md)为准；参考 [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) 与 [GFM 官方规范](https://github.github.com/gfm/)，未宣称完整规范符合性或与 GitHub 渲染完全一致。

## D016 单页即时呈现编辑

- 状态：已采纳并进入源码，Release EXE 构建与短网页检查通过；本轮未做桌面 IME 或长时间实机验收。
- 当前界面为单一正文编辑页。CodeMirror 6 在编辑时隐藏常见 Markdown 标记并呈现对应排版；同一编辑器仍保存完整 Markdown 原文，原有增量消息、撤销历史和文件保存协议不变。`Ctrl+Alt+M` 在同页临时显示源码标记，用于复杂结构、地址和引用调整；再次按下恢复排版编辑。
- 即时呈现基于 CodeMirror Markdown 语法树（含 GFM 和上下标扩展）及 decorations，覆盖标题、粗斜/删除线/上下标、行内代码、引用、列表与任务项、围栏/缩进代码、链接、水平线及常规 GFM 表格行。复选任务项可点击或用键盘 Space/Enter 切换；本地图片经原生受控资源 URL 显示。Markdig 隐藏预览页继续处理解析快照及安全图片资源桥接。
- 正文进入、搜索面板、设置窗口和控件状态使用短时过渡或动画，并遵循减少动画设置与系统偏好；按后续反馈移除文字行悬停底色及点击脉冲。标题上下留白使用行内边距，不使用垂直外边距，使 CodeMirror 的行高测量与实际文字位置一致，避免点击光标错位。
- CodeMirror 语法识别和装饰不承诺与 Markdig 输出完全一致。富表格结构编辑、复杂空单元格、参考式图片、原始 HTML、脚注、数学公式和 Mermaid 图表未形成完整富呈现；不支持或有歧义的文本仍保留在同一源文档中，可切换源码标记编辑。正文普通单击合法 HTTP(S) 链接，经宿主确认交系统浏览器；Ctrl/Shift/Alt/Meta 点击、拖选及源码模式继续用于编辑。相对链接与本页锚点暂不开放。
- 顶栏采用 WinUI 原生 CommandBar 动态溢出，撤销/重做/查找/替换集中到顶栏，代码模式显示图标及文字；文档标题放大后按后续反馈并入 logo 右侧，取消独立标题行；顶栏资源局部收紧图标与内部间距，保留原生命令溢出与系统焦点，忽略不支持的启动参数时不展示常态通知，文件筛选与实际读写错误提示仍保留。代码模式复用同一正文/源码切换函数，模式状态仅通过受限布尔消息同步，不保存到文档或设置。
- 常用格式快捷键参考 [Typora Windows 官方快捷键](https://support.typora.io/Shortcut-Keys/)，当前实现粗体、斜体、删除线、行内代码、链接与 ATX 标题/正文。复用 CodeMirror 事务与历史，不引入编辑框架；保留 Ctrl+Alt+M 的现有切换习惯。空选区使用选中的占位文本，避免空的 `****` 被解析为分隔线而无法输入；输入法组合期间不改写文档。复杂嵌套格式、跨段行内格式及 Setext 标题的格式转换不承诺完整语义规范化，可用代码模式精确编辑。
- 六级标题使用递减字号与字重；初版采用 H1 宋体、H2 微软雅黑 UI。后续 D017 将标题和正文的字体选择开放到设置，H1/H2 默认宋体。本机缺少所选字体时使用 CSS 回退，不捆绑或下载字体。表格列分隔线改由整行背景绘制，避免内容换行导致短单元格竖线中断；末行明确标记并绘制底部圆角。任务框两种状态共用固定尺寸与基线，选中勾形使用 CSS 直线绘制，保留原有鼠标、键盘与无障碍行为。
- Win32 根窗口、WinUI 3 XAML Islands 工具栏及双原生子 HWND/windowed WebView2 宿主保持不变。编辑器 WebView 占据正文区域，预览 WebView 隐藏为 1×1 并继续运行；不引入新的 UI 或编辑器依赖。
- 设置错误不展示异常 JSON 或重复启动通知：保留损坏/未知版本设置文件，采用默认值并禁止覆盖，简短中文提示仅在设置窗口显示。无草稿及普通解析进度、源码行列等常态状态不再提示；保存/文件操作错误仍明确告知。
- 理由：把解析后的文本作为写作时的主界面，减少源码符号干扰并缩短编辑、阅读之间的心智切换，同时保留 Markdown 文件互操作性和既有文件安全边界。
- 代价：编辑期语法视图与 Markdig 最终 HTML 由不同解析器产生，复杂语法可能出现外观差异；需要以兼容样例和用户编辑验证明确边界。旧 M3/M4 三模式脚本只覆盖历史界面，不能作为本决策验收依据。
- 实现位置：`src/Marker.Web/src/live-markdown.ts`、`src/Marker.Web/src/main.ts`、`src/Marker.App/MainWindow.xaml`、`MainWindow.Views.cs`、`MainWindow.xaml.cs`。

## D017 独立设置窗口与可配置写作排版

- 状态：已实现。主工具栏保留同高设置入口；设置使用独立 WinUI owned 窗口单例显示，主窗口关闭时一并关闭。设置值即时应用并写入原 schema 1 JSON。
- 设置划分为外观、排版和字体卡片，保留主题、动效偏好、正文大小、行高、自动换行；新增段间距、正文/H1/H2字体与五组颜色组合。段间距范围为 0–2 em、默认 0.5 em；段间距通过顶层段落末尾 padding 实现，不删除 Markdown 空行。字号范围 12–24，行高范围 1.2–2。
- 字体选项为系统、宋体、微软雅黑、等线和衬线；正文默认系统字体，H1/H2 默认宋体。颜色组合由 `WritingPalette.GetColors` 统一解析，Web 编辑器的背景与强调 CSS 变量和原生主工具栏 band、宿主客户区、系统标题栏 caption及设置窗口使用完全相同的值；普通原生控件其余部分沿用系统样式。正文 WebView 铺满工具栏下方客户区，去除旧分栏宿主边距。Windows 高对比系统色优先。
- 新字段沿用 schema 1 且均可缺省，旧配置无新增字段时静默使用默认值；非法新字段独立回退并提示。损坏或未知版本仍保留原文件并禁止写入。设置窗口坐标按 owner DPI 换算到物理边界并夹入目标显示器工作区。
- 理由：把较多的外观和写作控制从正文工具栏移出，同时让读者可分别调整正文字体、标题字体和段落节奏；兼容 schema 1 避免仅因新增偏好打断旧配置。
- 代价：所选字体是否安装由目标 Windows 决定，Web CSS 回退到可用字体；palette 统一着色范围限于约定的窗口背景和强调面，其他 WinUI 控件仍使用系统样式。
- 替代关系：本决策替代 D008 中可展开的内联外观/排版面板方案，以及 D016 中固定 H2 微软雅黑 UI 的方案；D016 记录的 H1 宋体默认继续保留。
- 变更依据：D017 初版只把 palette 应用于 Web 正文和隐藏预览；本轮为解决顶部宿主 band、窗口 caption与纸面颜色不一致，扩展为原生复用 `WritingPalette`、其背景/强调色与 Web 编辑器 CSS 保持同值。高对比时仍由 Windows 系统颜色优先；这一扩展没有改变“其他 WinUI 控件使用系统样式”的边界。
- 实现位置：`src/Marker.App/SettingsWindow.xaml`、`SettingsWindow.xaml.cs`、`AppSettings.cs`、`MainWindow.Views.cs`、`MainWindow.Windows.cs`、`App.xaml.cs`、`src/Marker.Web/src/main.ts`、`style.css`、`preview.css`。
- Win32 主窗口不计入 XAML Window 数量，应用采用 `DispatcherShutdownMode.OnExplicitShutdown`，关闭设置子窗不会退出；主窗口复用现有未保存确认与显式退出流程。依据：[DispatcherShutdownMode](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.dispatchershutdownmode)。

- 图标变更：根据用户指定的 `asserts/icon.png` 裁剪生成 ICO 与 PNG，应用/设置窗口图标和顶栏右侧 logo 同源；logo 保留原图色彩，不再根据配色替换为通用文档图形。

## D015 启动激活与窗口恢复

- 状态：M4 已实现；本机文件队列、真实 OLE 拖放和窗口恢复通过；安装后 Explorer 文件关联与多显示器恢复仍待验。
- `AppInstance` 保证单实例；文件关联、命令行、二次实例重定向和原生拖放统一进入串行队列，并复用现有未保存确认与文档打开流程。只接收 `.md`/`.markdown`。
- 每批最多 64 个文件，超限整批拒绝；启动恢复与文件命令共享操作锁，并在恢复的异步边界复核激活状态，让启动文件优先，避免旧草稿覆盖已打开文件。
- `WINDOWPLACEMENT.rcNormalPosition` 保存为屏幕坐标时显式转换 work area 偏移；恢复时按目标 monitor DPI 将位置夹入 work area。新窗口默认 960×700 DIP，最小尺寸 720×480 DIP；保留 Windows 系统标题栏和 Snap。
- 理由：单实例避免同一文档由多个应用副本竞争，串行队列保留现有文档切换/冲突保护；显式屏幕坐标与 work area 夹取可恢复已拔除显示器上的窗口。
- 代价：窗口位置与目标显示器 DPI 相关，拓扑变化后的实际摆放必须在多屏设备验证；平台保留的系统标题栏优先于自定义拖拽/标题区动画。
- 依据：[WINDOWPLACEMENT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-windowplacement)、[AppLifecycle AppInstance](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.windows.applifecycle.appinstance)。

## 决策维护

- 新增稳定且影响架构、依赖、支持范围、数据或发布的决定时，分配下一个 `Dxxx` 编号并记下状态、理由、代价和实现位置。
- 需求未定或一次性实现细节记入开发方案/阶段记录，不为每个小选择增加决策条目。
- 决定改变时更新原编号状态与说明，并在[项目历程](progress.md)注明变更依据；不要重复编号。
