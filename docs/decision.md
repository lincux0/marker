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

- 状态：早期轻量 JSON 设置已实现，SQLite 曾延期；用户后续明确要求设置进入数据库，现由 D021 替代生产设置存储。M4 在 schema 1 中加入可选减少动画偏好、窗口位置，D017 继续加入可选字体、段间距与配色字段；旧 schema 1 缺少新增字段时静默使用默认值。D016 后旧 `viewMode` 只为兼容读取，不自动迁移写回。
- 计划用 JSON 保存轻量设置；Markdown 文档首发保存在普通本地文件中。
- SQLite 仅在需要查询型元数据、规模化历史或跨文档关系后重新评估。
- 恢复草稿与设置使用各自独立的 schemaVersion 1 JSON，并记录 applicationVersion。设置持久化已在 M3 实现；不把设置当文档恢复库。设置字段无效时单字段回退默认值并提示；损坏或未来 schema 使用默认值且禁止覆盖原文件。说明只在独立设置窗口显示，不展示底层 JSON 异常或重复启动提示。
- 理由：M0/M1 没有数据库功能需求，M2 草稿也无需查询型存储，避免引入迁移与数据维护成本。
- 代价：复杂查询或多实体事务需求出现时，JSON 不适合作为数据库替代品。

## D008 视觉与动效

- 状态：M4 的 DWM/Mica 与减少动画决策继续有效；原生 XAML Island 可见工具栏的 Acrylic 实现由 D018 替代。保留已通过用户输入法回归的编辑宿主；本轮输入法与新界面体验仍需用户复验，实测情况以项目历程记录为准。
- Win32 根窗口保留 DWM 主窗口 backdrop，应用设置决定宿主背景/标题栏配色；高对比或 backdrop 不可用时回退到系统色。编辑器/预览保持不透明纸面，窗口客户区随当前配色填充。
- 原生 XAML Island 曾显示约 84 DIP 的命令工具栏和真实文件错误状态区，外观包括圆角 Acrylic、渐变描边与 ThemeShadow；高对比关闭玻璃/阴影并回退系统色。该方案可以形成 Island 内局部视觉层次，但受到 HWND 空间约束，不能覆盖原生子窗口 WebView2 正文。
- M4 时 Composition 用于可见工具栏 Island 内部短暂入场反馈（167 ms opacity、250 ms scale）；D018 隐藏该 Island 后，这段原生入场动画不再作用于可见工具栏。用户“减少动画”或 Windows `UISettings.AnimationsEnabled=false` 仍停止应用自定义 Composition 与 Web CSS 动画；WinUI 内置动画继续遵循系统策略。
- 理由：Fluent 2 建议短时、自然并提供无动效方式；原生工具栏视觉尝试以轻量玻璃和阴影塑造 Island 内层级，编辑/阅读内容维持稳定表面。整条宿主 band 和系统标题栏 caption 跟随选中的配色背景，避免与正文形成异色边框。D018 后可见工具栏采用 WebView 同层覆盖以实现正文透过磨砂层滚动的视觉。
- 代价：XAML Island 与 windowed WebView2 处于不同 HWND，不能做覆盖编辑器/预览的连续 Composition 动画；目标系统材质、缩放和辅助功能仍需实机检查。
- 依据：[Fluent 2 motion](https://fluent2.microsoft.design/motion)、[Mica material](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)、[DWM system backdrop](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)、[DwmSetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmsetwindowattribute)、[DesktopWindowXamlSource.SystemBackdrop](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.hosting.desktopwindowxamlsource.systembackdrop)。

## D009 分发渠道

- 状态：早期采纳站外 MSIX；用户后续选择当前用户 Setup.exe，站外交付由 D022 替代，MSIX 构建工具保留；Microsoft Store 仍为后续候选。以下保留早期 MSIX 决策依据。
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
- 单页正文新增受限 `openLink` 消息，复用既有来源、协议、会话、当前文档版本、字段与 URL 校验；编辑器不获得预览的 `revealSource` 权限。早期编辑器与预览共用外链确认入口；正文打开交互现由 D023 替代，隐藏预览保留确认。
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
- D016 采纳时：标题 HTML、大纲和源码偏移来自同一 Markdig AST。代码围栏复用现有 CodeMirror/Lezer 依赖，仅 JS/TS 高亮；未知语言与超过 100,000 字符的单块降级纯文本。大纲超过 10,000 项或无效时隐藏大纲，不阻断正文。高亮语言扩充见后续 D026。
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
- D016 采纳时，CodeMirror 语法识别和装饰不承诺与 Markdig 输出完全一致。富表格结构编辑、复杂空单元格、参考式图片、原始 HTML、脚注、数学公式和 Mermaid 图表未形成完整富呈现；D026 后续替代脚注、数学和 Mermaid 的状态。早期正文普通点击 HTTP(S) 后确认打开，且未开放相对链接；当前交互由 D023 替代。本页锚点仍未开放。
- 顶栏采用 WinUI 原生 CommandBar 动态溢出，撤销/重做/查找/替换集中到顶栏，代码模式显示图标及文字；文档标题放大后按后续反馈并入 logo 右侧，取消独立标题行；顶栏资源局部收紧图标与内部间距，保留原生命令溢出与系统焦点，忽略不支持的启动参数时不展示常态通知，文件筛选与实际读写错误提示仍保留。代码模式复用同一正文/源码切换函数，模式状态仅通过受限布尔消息同步，不保存到文档或设置。
- 常用格式快捷键参考 [Typora Windows 官方快捷键](https://support.typora.io/Shortcut-Keys/)，当前实现粗体、斜体、删除线、行内代码、链接与 ATX 标题/正文。复用 CodeMirror 事务与历史，不引入编辑框架；保留 Ctrl+Alt+M 的现有切换习惯。空选区使用选中的占位文本，避免空的 `****` 被解析为分隔线而无法输入；输入法组合期间不改写文档。复杂嵌套格式、跨段行内格式及 Setext 标题的格式转换不承诺完整语义规范化，可用代码模式精确编辑。
- 六级标题使用递减字号与字重；初版采用 H1 宋体、H2 微软雅黑 UI。后续 D017 将标题和正文的字体选择开放到设置，H1/H2 默认宋体。本机缺少所选字体时使用 CSS 回退，不捆绑或下载字体。表格列分隔线改由整行背景绘制，避免内容换行导致短单元格竖线中断；末行明确标记并绘制底部圆角。任务框两种状态共用固定尺寸与基线，选中勾形使用 CSS 直线绘制，保留原有鼠标、键盘与无障碍行为。
- Win32 根窗口、双原生子 HWND/windowed WebView2 编辑宿主保持不变；可见工具栏迁入编辑器 WebView，原 XAML Island 隐藏为 1×1 兼容宿主。预览 WebView 隐藏为 1×1 并继续运行；D018 不更换编辑器 WebView2 或 IME 宿主，也不引入新的 UI 依赖。
- 设置错误不展示异常 JSON 或重复启动通知：保留损坏/未知版本设置文件，采用默认值并禁止覆盖，简短中文提示仅在设置窗口显示。无草稿及普通解析进度、源码行列等常态状态不再提示；保存/文件操作错误仍明确告知。
- 理由：把解析后的文本作为写作时的主界面，减少源码符号干扰并缩短编辑、阅读之间的心智切换，同时保留 Markdown 文件互操作性和既有文件安全边界。
- 代价：编辑期语法视图与 Markdig 最终 HTML 由不同解析器产生，复杂语法可能出现外观差异；需要以兼容样例和用户编辑验证明确边界。旧 M3/M4 三模式脚本只覆盖历史界面，不能作为本决策验收依据。
- 实现位置：`src/Marker.Web/src/live-markdown.ts`、`src/Marker.Web/src/main.ts`、`src/Marker.App/MainWindow.xaml`、`MainWindow.Views.cs`、`MainWindow.xaml.cs`。

## D017 独立设置窗口与可配置写作排版

- 状态：设置窗口、字体及排版设置仍有效；其早期可见原生 Acrylic 工具栏方案已被 D018 替代。设置使用独立 WinUI owned 窗口单例显示，主窗口关闭时一并关闭。设置值即时应用并写入原 schema 1 JSON。设置滚动页采用显式限宽居中容器；独立 WinUI 窗口关闭后通过 DispatcherQueue 接回 Win32 owner 的前台与编辑焦点，保留正常/最大化状态，并在主窗口关闭、文件操作或新设置窗口已打开时跳过恢复。
- 设置划分为外观、排版和字体卡片，保留主题、动效偏好、正文大小、行高、自动换行；新增段间距、正文/H1/H2字体与五组颜色组合。段间距范围为 0–2 em、默认 0.5 em；段间距通过顶层段落末尾 padding 实现，不删除 Markdown 空行。字号范围 12–24，行高范围 1.2–2。
- 字体选项为系统、宋体、微软雅黑、等线和衬线；正文默认系统字体，H1/H2 默认宋体。颜色组合由 `WritingPalette.GetColors` 统一解析，Web 编辑器背景与强调 CSS 变量和宿主客户区、系统标题栏 caption 及设置窗口使用完全相同的值；早期还用于原生可见工具栏 band。D018 后可见工具栏本身和正文共用 Web CSS 色值，普通原生控件其余部分沿用系统样式。正文 WebView 铺满客户区，Windows 高对比系统色优先。
- 新字段沿用 schema 1 且均可缺省，旧配置无新增字段时静默使用默认值；非法新字段独立回退并提示。损坏或未知版本仍保留原文件并禁止写入。设置窗口坐标按 owner DPI 换算到物理边界并夹入目标显示器工作区。
- 理由：把较多的外观和写作控制从正文工具栏移出，同时让读者可分别调整正文字体、标题字体和段落节奏；兼容 schema 1 避免仅因新增偏好打断旧配置。配色统一宿主背景和 CSS 的决定仍有效。
- 代价：所选字体是否安装由目标 Windows 决定，Web CSS 回退到可用字体；palette 统一着色范围限于约定的窗口背景和强调面，其他 WinUI 控件仍使用系统样式。
- 替代关系：本决策替代 D008 中可展开的内联外观/排版面板方案，以及 D016 中固定 H2 微软雅黑 UI 的方案；D016 记录的 H1 宋体默认继续保留。
- 变更依据：D017 初版只把 palette 应用于 Web 正文和隐藏预览；后续曾扩展到原生工具栏/宿主背景/标题栏，以统一窗口配色。D018 移除可见的原生工具栏，但保留宿主客户区和设置窗使用 `WritingPalette`，并让 Web 浮动工具栏与正文 CSS 同层配色；高对比仍由 Windows 系统颜色优先。
- 实现位置：`src/Marker.App/SettingsWindow.xaml`、`SettingsWindow.xaml.cs`、`AppSettings.cs`、`MainWindow.Views.cs`、`MainWindow.Windows.cs`、`App.xaml.cs`、`src/Marker.Web/src/main.ts`、`style.css`、`preview.css`。
- Win32 主窗口不计入 XAML Window 数量，应用采用 `DispatcherShutdownMode.OnExplicitShutdown`，关闭设置子窗不会退出；主窗口复用现有未保存确认与显式退出流程。依据：[DispatcherShutdownMode](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.dispatchershutdownmode)。
- 设置下拉菜单关闭 `ComboBoxHelper.KeepInteriorCornersSquare`，并在展开后的 UI 回合直接调整 `PopupBorder` 的 10 DIP 圆角和零边距；当前运行时会用 Canvas 包装 Popup 内容，不能假定 `Popup.Child` 就是 Border。保持原生选择、键盘和无障碍行为，不复制整套控件模板。菜单使用不透明的系统主题背景，避免设置行透出；升级 WinUI 时需重新核对模板部件。依据：[WinUI 圆角选项](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.primitives.comboboxhelper.keepinteriorcornerssquare)。

- 图标变更历史：根据用户指定的旧版 `asserts/icon.png` 裁剪生成 ICO 与 PNG，应用/设置窗口图标和顶栏 logo 同源；logo 保留原图色彩，不再根据配色替换为通用文档图形。旧图采用显式方形裁剪，主体从约 85% 缩至约 75%，各尺寸资源共用抗锯齿透明圆角遮罩；此裁剪记录由 D019 的新图标方案取代。

## D018 WebView 内浮动工具栏

- 状态：已采纳并接入当前实现；本轮桌面验收状态以项目历程为准。
- 可见工具栏作为 HTML/CSS 固定层放在编辑器 WebView2 内，初版横向边距为 32–56 CSS px，后续按用户反馈改为居中、宽度随正文纸面收缩，常规宽度最初比纸面多 32 px（1012 对 980 px），随后按用户反馈放宽至多 64 px（1044 对 980 px），加入统计后进一步增至多 128 px（1108 对 980 px），窄窗保留至少 16 px 外边距；长文档名采用原生省略号，悬停保留完整名称；以 `backdrop-filter` 模糊同页滚动正文，产生真正悬浮于文本上的效果。原 76% 纸面底色与 28 px 模糊虽有滤镜属性，但白色纸面上材质感不明显；依据用户反馈，改为 36% 画布底色、32 px 模糊及 1.5 倍饱和度，首屏与纸面间隔固定为 32 px。验证除计算样式外，增加滤镜开启/关闭的像素对照。工具栏和 CodeMirror 正文在同一 WebView2 HWND，原生编辑器子窗口继续从客户区 `(0,0)` 铺满。
- 原 `DesktopWindowXamlSource` 缩为 1×1 隐藏，只保留旧控件字段和 handler 的兼容路径。Win32 主窗口、编辑器/预览 WebView2、中文输入法宿主和窗口焦点路径不因工具栏迁移而替换。
- HTML 工具栏将撤销、重做、查找、替换和代码模式直接路由给现有编辑器；`new`、`open`、`save`、`saveAs`、`recover` 和 `settings` 通过既有 command envelope 交原生宿主。原生 `TryReadCommand` 仅增加 `recover` 与 `settings` 白名单值，来源、sessionId、protocolVersion、字段精确检查保持不变。宿主通过当前协议版本和 session 绑定的 `toolbarState` 传递 `title`、`notification`、`busy`。
- 顶栏品牌图标通过 Web 包内 `/app-logo.png` 使用桌面端 `Assets/AppLogo.png` 的副本；图标置于文档标题左侧；不增加运行时依赖或 CDN 资源。
- 替代关系：本决策替代 D017/D008 中“可见 XAML Island 原生 Acrylic/ThemeShadow 工具栏”的实现方案；D017 的独立设置窗口、字体/段间距偏好、schema 1 配色及宿主背景/标题栏配色仍有效。D017/D008 记录的原生方案依据保留为历史：它无法跨 HWND 覆盖 windowed WebView2 内容，不能让正文在磨砂层后滚动。
- 理由：让正文、工具栏和浮动模糊层共用一个 WebView 的合成表面，绕过 HWND airspace 对跨窗口覆盖的限制，同时保持现有原生编辑/IME 宿主。
- 代价：浮动层样式与键盘/无障碍行为由 Web 内容负责；高对比模式关闭 backdrop blur/透明效果并使用系统色。该选择不宣称已通过本轮桌面辅助功能验收。
- 实现位置：`src/Marker.Web/src/toolbar.ts`、`src/Marker.Web/src/main.ts`、`src/Marker.Web/src/style.css`、`src/Marker.App/MainWindow.xaml.cs`、`src/Marker.App/BridgeSession.cs`。

## D019 保留新图标完整画布

此图标素材和圆角遮罩方案由 D032 替代；以下保留历史决策依据。

- 状态：已采纳；新图标 PNG/ICO 资源已生成并包含于 Release EXE；构建与资源一致性证据见项目历程。
- 对当前 1254×1254 的 `asserts/icon.png` 使用完整方形裁框 `(0,0,1254,1254)`，保留蓝色圆角背景及 M+向下箭头周围的原始留白；继续生成应用、设置、Web 与 MSIX 图标资源。
- PNG 与 ICO 帧使用 25% 边长半径的抗锯齿透明圆角遮罩，使透明边界贴合素材自带的圆角背景。脚本仍允许调用方指定其他方形裁框，以适配未来素材。
- 理由：新图标主体刻意留有较宽边距，裁切放大会改变既定比例；保留整张画布可让桌面图标保持完整背景与合适留白。
- 代价：图形主体相对图标画布较小；未来若更换为不同圆角或边距的素材，需要重新确认裁框和遮罩半径。
- 实现位置：`scripts/build-icon-assets.ps1`、`src/Marker.App/Assets/`、`src/Marker.Web/public/app-logo.png`。

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

## D020 本地正文统计与顶部栏显示偏好

- 状态：已实现。按用户确认口径，中文 Han 字逐字、其他文本由 `Intl.Segmenter` 按词计数；忽略 Markdown 语法、链接目标、图片及引用链接定义，标题、代码内容和表格文字计入字数。非空 Paragraph/Task 节点计段落，软换行不另算；标题、代码块、表格与纯图片不计段数。
- 使用现有 CodeMirror Markdown parser 完整解析源文，统计不依赖可见编辑器 DOM，代码/排版模式口径相同。输入停顿 180 ms 后重算，避免每次按键同步统计；不发送额外桥接文本、不新增解析依赖。
- schema 1 加入可选 `hiddenToolbarActions`；旧配置默认全显示，严格限制 11 个已知功能、禁止重复、未知值和隐藏设置入口。隐藏项移入“更多”，快捷键保持可用；窄窗原有溢出行为保留，恢复全显示后宽窗不保留空菜单。
- 代价：隐藏指从顶部栏直显区移走，功能仍可访问。超长文档完整解析的额外成本尚未专项压测，不能把短样例通过视为性能验收。

## D021 SQLite 设置持久化

- 状态：按用户指令采纳并实现，替代 D007 中生产 JSON 设置路径。使用 Microsoft.Data.Sqlite；版本与传递依赖以工程/锁文件为准。
- `%LOCALAPPDATA%/Marker/settings.db` 存储一条版本化设置 payload，采用事务 UPSERT；模型/字段验证与旧 schema 1 共用。独立只读连接加载，保存后立即关闭连接；不依赖退出时集中保存。窗口位置也写同一数据库。
- 只在数据库不存在时导入旧 `settings.json`。有效值导入，原文件保持不动；损坏或未知 JSON 保留并用默认值建立 DB，修复旧文件损坏导致长期禁止保存的问题。以后以数据库为权威，不重复导入旧文件。
- 已存在的损坏/未知数据库或记录版本不自动覆写；默认运行、设置页面显示简短说明并禁写。参数化事务写入失败保持旧提交值。重解析点保护涵盖目录、主库及 journal/WAL/SHM 文件；DELETE journal 避免不必要的 WAL 生命周期。
- 权衡：单行 JSON payload 存于 SQLite，保留已有字段兼容而不为小规模设置引入多表映射。SQLite 只管理设置，不保存 Markdown 文档文本或替代恢复草稿存储；磁盘满、断电等极端场景仍待专项验证。

## D022 当前用户 Setup.exe

- 状态：用户明确选择可双击的 Setup.exe、仅当前用户安装；新增此交付路径，MSIX 工具保留，原站外首发 MSIX 约定由本决策调整为 Setup.exe，Store 仍为后续候选。
- Inno Setup 固定编译器版本、下载 SHA-256 与签名发布者；脚本默认执行现有 Release 构建/测试，`-SkipBuild` 只用于包装刚验证的产物。安装器仅允许 Windows 11 build 26100 起的 x64，默认安装到 `%LOCALAPPDATA%/Programs/Marker`，无需管理员权限。
- 携带自包含 .NET/Windows App SDK 输出，WebView2 Evergreen Runtime 仍为前置条件；检测缺失时明确提示，不静默下载。开始菜单快捷方式默认创建，桌面快捷方式可选，不注册 Markdown 默认关联。
- 卸载只移除安装文件及快捷方式，保留 `%LOCALAPPDATA%/Marker` 设置、恢复草稿和用户文档。项目 MIT、第三方声明及新增 SQLite 依赖 MIT/Apache-2.0 全文随包提供。
- 当前 Setup 未做产品代码签名；编译器签名验证不代表产物受信任。正式签名凭据仍需维护者提供；升级路径、最低系统与完整分发许可盘点留待发布验收。

## D023 Ctrl+点击访问链接

- 状态：按用户要求替代 D016 正文普通点击后确认的交互。链接标题提示“按ctrl并点击以访问”，只有 Ctrl+左键触发访问；普通点击继续定位光标，拖选和源码模式用于编辑。
- HTTP(S) 验证来源、会话、当前版本、长度和无 userinfo 后，直接调用系统默认浏览器，不重复确认；本地相对链接基于当前已保存文档目录，盘符/file URI 支持本地目标。Markdown 文件复用既有打开流程及未保存确认，其他普通文件/目录交系统关联。
- 对 URI 解码后的路径再次检查本地盘符、ADS 与重解析点，拒绝 UNC、设备路径、未知协议和可执行/脚本/快捷方式/安装器。允许点击文档中的链接不等于允许页面获得通用文件接口；未保存文档不能解析相对路径。页内锚点尚未开放。
- 代价：Ctrl 是访问手势，仍须由用户判断目标是否可信；系统关联应用的具体行为不由 Marker 控制。隐藏 Markdig 预览继续保留旧确认机制。

## D024 U2 复杂内容与复制边界

- 状态：按阅读优化方案 U2 实施，保留 D016 的同一编辑器、源文档和历史。表格继续使用等宽可编辑单元格，分隔行只产生固定左/中/右对齐类；不替换整表 widget、不增加 TSV 或结构编辑。
- 单元格布局使用 CodeMirror `outerDecorations`，保证强调、行内代码及隐藏标记位于单元格盒子内，避免装饰嵌套顺序改变布局。引用按 AST 层级显示缩进和边线，视觉强化最多五层；缩进代码隐藏语法缩进，额外代码缩进及完整源码保留。高对比保留实际引用外边线和层级缩进。
- 围栏操作条使用现有 CodeMirror widget。点击时从当前文档的所有 `CodeText` 范围提取内容，保留代码空白和换行，去掉引用/列表容器标记；无语言显示“代码”，未知语言保留原标签。复制仅在用户手势下调用浏览器 Clipboard API，不新增原生桥接或权限接口；失败明确反馈，组合输入期间不复制，文档或 widget 失效后不播报旧结果。
- 图片 alt 作为替代文本，不自动当 caption。可见页使用单一图片 widget；未映射、被拒绝或加载失败时显示 alt 安全占位，不回退远程请求、不显示源路径。Markdig 的未解析图片从“移除”改为安全文字占位，替代 architecture/D016 旧行为描述；D013 的目录、类型、大小、句柄及签名 URL 校验保持不变。
- 权衡：沿用既有 AST、浏览器能力和受控资源协议，无新增依赖；平台可以转换剪贴板文本换行。窄窗宽表仍可能形成很窄的等宽列，复杂表格布局、图片重试/灯箱与扩展高亮留给后续阶段，不以样式更新宣称它们已实现。

## D025 U3 导航、灯箱与专注

- 状态：用户确认同时实施大纲、页内锚点、图片灯箱与专注模式。保留 D016 的同一可编辑正文；本决策替代 D023 页内锚点尚未开放及 D024 灯箱延后的部分。专业语法已由 D026 决策。
- 大纲默认收起，复用 Markdig 唯一标题 ID 与 UTF-16 偏移。宿主发送当前会话/版本的完整消息；超过 2 MiB 时提示并清空目录，不截断标题。前端校验字段、唯一 ID、偏移与版本；编辑后立即失效，避免跳到过期位置。每页 200 项，宽窗右侧停靠、窄窗浮层；返回操作恢复跳转前的选区与滚动。
- Ctrl+点击页内锚点在当前正文定位；解码后只匹配已有标题 ID，未知锚点提示，不交系统打开。复制得到编码后的片段地址；不虚构文件 URL。定位使用工具栏实际高度避让。
- 灯箱只接受当前受控映射中已成功加载的图片。独立放大按钮保留图片链接的 Ctrl+点击行为；支持适配、原尺寸、按钮/键盘缩放、Tab 与 Esc，关闭恢复触发焦点。映射更新、编辑和新文档关闭旧灯箱，不新增文件或网络读取能力。
- 专注模式仅保留当前应用会话状态，收起可选操作并保留既有保存入口/快捷键、设置及明确的退出入口；不覆盖用户隐藏按钮偏好，不隐藏错误通知，不重建正文与撤销历史。没有新增持久化字段、依赖或只读页面。

## D026 U4 可编辑正文专业语法

- 状态：用户确认在当前单一可编辑正文实施脚注、五类提示框、数学、多语言代码高亮及 Mermaid。实现接在 D016 的同一 CodeMirror 文档；不恢复独立只读视图，也不因隐藏预览页存在而承诺两视图功能一致。
- 原生 Markdig AST 是数学、脚注与提示框的范围权威。`richContent` 为同一文档快照附带当前 session/version 的 UTF-16 `From`/exclusive `To`、文本及语义字段；脚注定义可按展示需要在预览/装饰中重组，但源文档位置不变。2 MiB JSON 限制下必须发送完整 metadata 或空列表，不截断；任何编辑立即清除过期 metadata。前端不得对整篇文本用美元正则猜公式。
- 行内/块数学使用锁定 KaTeX 0.19；`trust:false`、strict/error 处理、文档内宏隔离、`maxExpand:1000`、`maxSize:50`、每个 TeX 片段 8192 字符。输出包含 MathML；对 KaTeX 生成的 SVG/path 使用单独限制的处理规则，不扩大普通 Markdown 的 SVG 许可。错误呈现安全源码回退，复制返回原 TeX；编辑器选择/源码状态显示可编辑原文。
- 脚注引用显示上标，定义保持在源位置；点击定义回到最近点击的引用，重复引用返回具体点击位置。定义前缀在正常装饰视图中可隐藏，但源码/相关选择中必须可还原原文。五种 alert 只识别 NOTE、TIP、IMPORTANT、WARNING、CAUTION；仅替换 marker 为标题，保留其余引用 AST 内容；未知 marker 保持普通引用。
- 代码语言配置由 CodeMirror 与 HTML 预览共享，D026 采纳时为 JS/TS/C#/Python/JSON/Shell，后续扩充见 D027；以 `StreamLanguage` 复用 legacy modes，不引入 Shiki。编辑器全文超过 100,000 字符时停用语言解析，仅重新配置语言 compartment 并保留历史；预览单个代码块超过同一阈值降为纯文本。
- Mermaid 12.1 只在可见编辑器按需异步加载，串行队列最多 4 个待处理项；仅 flowchart/graph/sequence，源码不超过 32768 个 UTF-16 单元、250 行、800 tokens，预检估算节点最多 100 个，Mermaid 原生 `maxEdges:150` 限制连线。根级 `htmlLabels:false` 禁用 HTML 标签；禁用 directives/front matter、click、style、classDef、linkStyle、图片/图标形状和外部链接；仅专用 SVG 白名单及本地引用处理生成结果。过期/断开 widget 丢弃结果；关闭对话框销毁 widget。图表只提供受限显示、源码复制/编辑、缩放/平移、Esc 和焦点恢复，不解释或执行图中操作。
- 安全边界：Markdig 禁止原始 HTML；DOMPurify 和 CSP 继续用于普通预览；生成数学/Mermaid SVG 使用各自专用输出处理，不能把 SVG 规则扩展到用户文件。所有 range 元数据通过既有来源、协议、会话、版本、字段白名单与 2 MiB 限制。未知/错误/超限语法保留源文本并局部降级。
- 当前不一致：可见编辑器提供数学、脚注、提示框、Mermaid；隐藏 HTML preview 仅有数学与共享代码高亮，尚无脚注导航适配和 Mermaid widget。两者仍共享原始 Markdown 文档与保存历史。
- 依赖：KaTeX 0.19.0、Mermaid 12.1.0；`katex` override 统一 Mermaid 传递依赖版本。代码语言依赖为 `@codemirror/lang-python` 6.2.1、`@codemirror/lang-json` 6.0.2、`@codemirror/legacy-modes` 6.5.2。许可证与分发边界见 `THIRD_PARTY_NOTICES.md`。验证与验收状态以项目历程/验收记录的实际结果为准。

## D027 常用代码语言扩充

- 用户确认新增 HTML/XML、CSS、SQL、C/C++、Java/Kotlin、Go/Rust、Swift、PHP、Ruby、YAML/TOML/INI、PowerShell、Lua、Dockerfile、Diff；连同原六类共 26 类。编辑器与隐藏预览继续使用同一映射，语言名大小写不敏感，别名见工程开发指南；`sql`/`sqlite` 使用 SQLite 模式，PostgreSQL/MySQL 提供独立别名。
- 复用锁定的 legacy modes，不升级其他依赖；PHP 使用官方 `@codemirror/lang-php` 6.0.2，`plain:true` 支持带或不带开标签片段。Diff 浅/深主题分别区分新增和删除；不改变代码文本、复制、撤销及既有长文降级规则。
- 权衡：StreamLanguage 是词法高亮，不提供 IDE 语义诊断。HTML 模式不解析内嵌 JavaScript/CSS；未支持的语言继续显示纯文本。没有加入自动语言猜测或运行代码功能。
- 资料核实：Exa 定位 [CodeMirror 官方参考](https://codemirror.net/docs/ref/) 与[维护者的 Markdown/legacy 模式说明](https://discuss.codemirror.net/t/codemirror-lang-markdown-with-codemirror-legacy-modes/7925)；Context7 查询官方文档核实 StreamLanguage/语言支持用法，PHP 参数以锁定版本包内类型声明为准。许可随生产依赖聚合文件分发。

## D028 U5 交互回归修正

- 源码切换移除行级排版后，CodeMirror 6.43.13 的高度图仍可能保留旧行高，导致鼠标位置映射到前一行。仅在模式切换时用 `EditorView.setState(editor.state)` 重建内部视图；保留同一 EditorView、EditorState、文档、选区及撤销历史，不使用私有高度缓存字段。普通编辑和设置仍沿用事务更新。代价是模式切换时重建插件与 DOM；选择、滚动、撤销、目录、灯箱及专业语法均须回归。Context7 官方指南和锁定版本实现用于核实状态/视图边界。
- 减少动画时使用 `transition:none`，避免非零的全局 transition-duration 给原本没有过渡的字号等属性启动动画，也取消正在运行的过渡；普通动画设置不变。
- 不超过 400 CSS px 时，撤销、重做、查找复用既有“更多”菜单，保留快捷键；720 px 的直显布局及用户按钮偏好不变。默认排版仍是用户确认的 16 px、1.5 行高、0.5em 段距。

## D029 外部文件变更与重新加载

- 按用户验收意见取消常驻的“磁盘文件已修改、删除或移动……”提示。可读取的外部修改改为不抢焦点的通知“磁盘中文件已被修改，是否重新加载？”，提供“重新加载”和“关闭”；关闭只收起通知，不解除保存时的指纹冲突保护。文件缺失/不可读取时保留磁盘变更状态，不提供无内容可加载的通知。
- 监控事件经 300 ms 合并、串行读取原始字节指纹；同一磁盘版本只提醒一次，新版本可再提醒。保存/文档切换清理旧通知；回到已保存版本取消通知。监控结果和桥接动作分别核对文档对象、会话及随机通知编号，避免旧事件或按钮操作影响新文档。
- 重新加载复用现有读取/容量校验、当前快照、原生确认和文档切换流程。冻结编辑后再次取得快照；有未保存内容时明确确认丢弃，并在替换前再次读取磁盘。取消、组合输入或读取失败保留当前编辑与恢复草稿，不自动写回外部修改。
- 权衡：文件监控仅提供及时提示，原子写入过程可能暂不可读；保存前仍独立复核指纹。通知关闭不会自动同步源文档，用户仍可继续编辑或另存副本。

## D030 顶栏与目录焦点修正

- 用户确认顶栏取消应用图标，保留文档名；此项替代 D018 的顶栏品牌图标呈现决策，窗口/安装图标及素材生成保持原有用途。
- 目录按钮允许原生鼠标聚焦，防止从编辑器继承键盘焦点可见状态后，程序聚焦的目录关闭按钮及返回触发按钮持续出现外框。继续采用 `:focus-visible`，键盘 Tab、Enter 和 Esc 保留清晰焦点，不全局取消 outline。
- 统一图标路径的视觉中心，保留 19 px SVG 和 36 px 操作按钮。极窄窗口收起文档标识区域，操作使用已有更多菜单；高对比悬停/按下状态使用 HighlightText/Highlight，避免前景与背景同色。

## D031 当前用户 Markdown 打开方式注册

- 用户要求双击已有 Markdown 文件使用 Marker，或自动加入“打开方式”。当前 Setup 默认注册 `.md`、`.markdown` 的 Marker 候选项，复用现有文件路径启动与单实例激活，不扩展可打开文件类型。
- 仅写 HKCU：`Marker.Markdown` ProgID 的图标/带引号打开命令、扩展名 `OpenWithProgids` 值、`Applications/Marker.App.exe` 名称与 SupportedTypes。安装/卸载通过 ChangesAssociations 通知 Explorer 刷新。用户在 Windows“打开方式”选择始终使用 Marker 后，双击文件使用所选默认应用；安装器不覆盖扩展名默认值或 UserChoice。
- 此项补充 D022 的候选关联注册；D022 不抢占默认关联的约定继续有效。卸载清理 Marker 专用键及共享键中的 Marker 值，不删除其他程序候选项，用户设置/草稿/文件仍保留。
- 依据：Context7 核实 Inno 注册/卸载处理；具体配置参考 [Microsoft OpenWithProgids 文档](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box)、[Inno Registry](https://jrsoftware.org/ishelp/topic_registrysection.htm) 与 [ChangesAssociations](https://jrsoftware.org/ishelp/topic_setup_changesassociations.htm)。


## D032 用户 SVG 图标原样替换

- 用户指定透明背景的蓝色渐变 M 字母 SVG，保存为 `asserts/icon.svg`；以浏览器原样栅格化的 512×512 `asserts/icon.png` 作为既有图标脚本输入。保留完整画布、留白、轮廓及内部模糊渐变，不增加背景或修改图形。
- 此项替代 D019 的 1254×1254 素材及 25% 圆角遮罩。现有 PNG 尺寸、七尺寸 ICO、宽图居中、Web 同源副本和原生窗口加载路径不变；D030 的顶栏无应用图标继续有效。
- 透明角及非全透明检查继续保留；M 的中心可以透明，不再将中心不透明作为有效图标条件。代价是 SVG 修改后需先重新栅格化 PNG，再运行图标脚本；不增加运行时 SVG 依赖。

## D033 编辑模式与任务复选框滚动位置

- 状态：已实现。源码/呈现标记切换前记录 CodeMirror 视口快照，更新状态后恢复视口，避免切换瞬间跳到文档末尾；任务复选框点击沿用既有文档更新流程，但阻止无必要的编辑器聚焦滚动。
- 权衡：只修复交互引起的滚动变化，正常编辑、选区、撤销历史和文档滚动行为仍由 CodeMirror 管理。原生 WebView2 与浏览器 mock 均验证了当前路径；跨 DPI 等其他滚动情形仍按既有验收边界处理。

## D034 顶部栏自动隐藏

- 状态：已实现，默认关闭。设置存储于现有 schema 1 数据库字段；缺少字段的旧设置保持关闭。开启后无操作 3 秒收起，指针进入窗口顶部 8 CSS 像素范围重新展开；指针悬停、键盘焦点及“更多”菜单保持可访问。
- 权衡：收起仅改变视觉位置，不从辅助技术/键盘顺序移除工具栏；减少动画偏好及系统减少动画均会停用过渡动画。

## D035 设置数据库暂时读取失败后的安全重试

- 状态：已实现。启动加载失败时不直接写入，也不将本次修改立即持久化；用户关闭并重新打开设置时重新读取数据库，只合并失败期间用户实际修改过的顶层字段。写入仍通过原有字段校验和事务完成。
- 安全边界：损坏或未知 schema/版本仍保留原库并禁止覆盖。真实安装版与当前数据库核验未能回溯截图产生时的具体触发原因；exclusive SQLite lock 测试复现了启动暂时读取失败后的锁存问题，修复对象是安全重试与恢复行为，不据此断定截图当时就是锁导致。
- 诊断补充：加载失败提示实际数据库路径和内部校验原因，数据库版本不兼容时显示实际版本号。只展示本地路径、静态校验说明或 SQLite 错误码，不展示设置 payload、SQL 或任意外部异常的 Message；不放宽原数据库保护。
- 版本读取修正：使用 SQLite 官方支持的 `SELECT user_version FROM pragma_user_version()`，严格要求返回整数，不再将空结果转换为版本 0。仍只接受版本 1；真实 0、未来版本和同名普通表伪装均拒写并保持原文件字节。表值函数使用带括号调用，同名普通表会报错，不读取其伪造版本值。依据：[SQLite PRAGMA functions](https://www.sqlite.org/pragma.html#pragfunc)。

## D036 PDF 导出

- 状态：已实现。顶部栏命令打印当前编辑快照，布局采用 A4 与四边约 15 mm 边距；打印前等待预览中的字体、图片、公式及受支持 Mermaid 图就绪。PDF 不替代或写回 Markdown 文档。
- 安全与失败处理：路径仅由系统保存对话框选择；禁止将 PDF 覆盖为当前 Markdown 文件。准备失败时不写入目标；写入前指纹冲突时拒绝覆盖。导出在目标同目录写临时文件并核对指纹；替换时出现外部并发修改，会将外部版本保存为 `.external` 并报告路径。预览消息校验来源、会话和版本。
- 限制：页面打印与系统 PDF 阅读器的最终排版仍可能受字体及打印实现影响。生产预览 mock 已验证中文、公式、Mermaid 与多页输出；本轮真实系统保存对话框、WebView2 打印流和取消导出已验收，生成三页 PDF 包含未保存快照且不改源文件。


## D037 多文档与左侧悬浮标签

- 状态：已实现。替代 D013 的单文档限制及“切换即离开当前文档”的行为。打开、新建和恢复各自保留文档；同一路径再次打开时激活已有标签。文件选择器支持一次选择多个文件，拖放与系统激活继续使用原有串行队列。
- 标签在编辑器左侧显示为圆形悬浮按钮，内容为文档标题首字，提供完整名称提示、活动状态、未保存标记与关闭入口。切换保留正文、保存基线、编码/换行、撤销历史、选区及滚动位置；关闭单标签或退出窗口仍确认未保存内容。
- 安全边界：磁盘路径仍仅由宿主持有，页面只接收不透明文档 ID、标题与脏状态；标签命令校验来源、当前桥接会话、字段白名单和目标文档。每次切换重建桥接会话及图片资源映射，失效的解析结果不得更新新文档。另存为禁止覆盖另一已打开标签的路径。
- 权衡：同一时刻只有活动文档使用编辑 WebView 与文件监控，后台文档切回后复核磁盘指纹，保存继续执行冲突保护。打开标签和撤销历史仅在当前运行内保留，不增加工作区持久化或最近文件列表；未保存草稿继续沿用恢复机制。

- 2026-10-16 交互修订：根据标签关闭按钮遮挡首字的反馈，移除悬停/聚焦时的圆形关闭按钮，改为标签右键菜单的“关闭”，同时支持菜单键/Shift+F10 及原有 Ctrl+W。关闭仍复用宿主的未保存确认，不增加新的文档操作协议。
