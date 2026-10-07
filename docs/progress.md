# 项目建设历程

本页记录已完成工作的证据与限制，按日期追加。当前源码结构见[架构基线](architecture.md)，稳定取舍见[技术决策](decision.md)，验收目标见[开发方案](开发方案.md)。

## 记录规则

- 每个工作条目写日期、变更、实际验证、限制及提交；未执行的检查明确标记未执行。
- 历史记录只在发现事实错误时更正；当前状态由最新条目和源码共同判断。
- M0 的构建、安装及清理结果来自当时记录，本次创建文档没有重跑构建或安装。
- 后续阶段完成后追加一小条，并更新架构或决策文档中已变化的现状。

## 已完成阶段

### M0：工程与决策基线

- 状态：已完成；方案中的 M0 任务与验证记录见[工程开发指南](工程开发指南.md)。
- 2026-10-07，提交 `b997f23`：建立 WinUI 3 桌面工程、独立 TypeScript/Vite Web 工程、MSTest 脚手架、MSIX 配置、锁文件、构建与签名脚本、Windows CI 定义及 MIT 许可证。
- 同日，提交 `f65c2b7`：记录 M0 决策和验收基线，更新 README、工程指南和开发方案状态。
- 方案与阶段计划提交：`31def50` 增加 CodeMirror 6 开发方案；`cc09388` 细化分阶段实施和验收门槛。以上提交均为 2026-10-07，具体提交顺序以 Git 历史为准。

### M0 变更顺序（本地 Git 记录）

| 时间（+08:00） | 提交 | 变更 |
|---|---|---|
| 07:47 | `31def50` | 新建 CodeMirror 6 产品与技术开发方案。 |
| 07:54 | `cc09388` | 补充阶段拆分、交付物和退出门槛。 |
| 08:21 | `b997f23` | 落地 WinUI/Web/MSTest 工程、构建脚本和 MSIX 基础。 |
| 08:27 | `f65c2b7` | 记录决策和当时的 M0 构建、安装验收结果。 |

提交时间来自本地 Git 元数据；它只说明版本库记录时间，不代表远端推送或 CI 执行时间。

### M0 历史验证（当时记录）

- 本机 Web `npm ci`、TypeScript 检查、Vite 生产构建通过。
- x64 Release、锁定依赖恢复与未签名 MSIX 生成通过；记录为 0 warning、0 error。
- 独立本地干净克隆完成锁定依赖恢复、Release 与 MSIX 构建；复用指定外部 SDK，但不复用源目录的 node_modules/bin/obj。
- MSTest 工程可运行，报告 0 tests；没有业务测试结论。
- 开发签名 MSIX 在本机安装、启动并卸载通过，窗口标题为 Marker、正文为 Marker M0。
- 烟雾测试关闭应用进程、卸载应用并移除本次临时机器级 `LocalMachine\TrustedPeople` 信任。
- 当前用户 `CurrentUser\My` 的不可导出开发私钥与 `CurrentUser\TrustedPeople` 公钥信任保留；排查用当前用户 Root 条目已清理。
- 测试环境为 Windows build 26300，不能替代最低支持 build 26100 设备验收。
- 本机 Release/MSIX 验收和独立克隆构建是两种本地证据；两者都不能替代远端 CI。
- MSIX 烟雾测试验证了当时的空窗口安装启动，不覆盖 Markdown 编辑、文件安全或升级流程。
- 开发证书当前用户信任留存与机器级信任清理是不同状态，详见[技术决策 D010](decision.md)。
- 远端 GitHub Actions 尚未执行；没有 Git push；生产签名凭据未提供，应用尚未发布。

## 2026-10-07：建立持续维护的项目文档

- 新增 `architecture.md`、`decision.md`、`progress.md`，分别维护实际结构、技术决策和建设历程，并区分当前实现与 M1 规划。
- README 增加文档入口；根目录 [AGENTS.md](../AGENTS.md) 明确后续开发、修复与文档建设的同步维护要求。
- 验证：核对当前源码、依赖配置与 M0 验收记录，检查本地 Git 提交日期、文档相对链接和 Markdown 结构。
- 限制：本轮为纯文档建设，未重跑 M0 构建、安装或业务测试，未执行远端 CI，也未生成新的 EXE/MSIX。
- 提交追溯：本记录随文档提交维护，可通过 `git log -- docs/progress.md` 查看对应提交。原有开发方案表格格式修改保留在工作区，不纳入本轮提交。

## 2026-10-07：M1 编辑/预览技术原型

- 实现：WinUI 双 WebView2 共享环境但使用不同本地 HTTPS 来源；CodeMirror 6 编辑与历史、带会话/版本的全文快照、Markdig 后台解析、DOMPurify 常驻预览、过期结果丢弃与同版本重同步。
- 安全边界：对应页面导航和资源白名单、禁止 frame/新窗口/宿主对象、精确消息来源/字段/会话/尺寸校验、原始 HTML 禁用、预览标签/属性白名单与 CSP；不提供文件 API。
- 验证：`scripts/build.ps1 -Package` 完成锁定恢复、Web 类型检查/生产构建、x64 Release 和 MSIX，0 warning、0 error。后续增加受控长文检查后，MSTest 5/5 通过，结果在 `artifacts/tests/m1-tests.trx`。
- 长文基线：114,006 个 UTF-16 单元的受控 Markdown 转为 270,012 个 HTML 单元，预热后本次解析 85.47 ms，末尾标记完整。单次本机解析不代表端到端延迟、内存或输入法性能保证。
- Playwright：使用现有 MCP 和 `scripts/test-web-m1.js` 检查中文/emoji 快照、Ctrl+Z/Ctrl+Y、重同步、危险 HTML 净化、旧版本/错误会话丢弃及 render ack；全部通过。初次脚本用 Ctrl+Shift+Z 检查 Windows 重做而超时，按 CodeMirror Windows 默认 Ctrl+Y 修正后通过。测试上下文、页面及 Vite 服务器已关闭。
- 真实 Windows EXE：在 build 26300 直接启动本轮 Release EXE，内置样例预览 v0 就绪，原生按键编辑后预览更新为 v3，正常关闭窗口并退出进程。`artifacts/exe-smoke.json` 的 `passed/previewReady/editPreviewUpdated/closedNormally` 均为 true；截图 `artifacts/marker-m1.png` 已检查。原始 UI Automation 控件树可定位状态栏；优化查询会遗漏 WebView 后的兄弟控件，安装脚本已据此修正。
- MSIX：已重新生成并开发签名，大小 95,408,605 字节；SHA-256 `2027BB95276F79FFCB1D4DE386B52C93033C76AB0B95A9F564C836E7B58999F1`。包路径仍为 `artifacts/msix/Marker.App_0.1.0.0_x64_Test/Marker.App_0.1.0.0_x64.msix`。本轮 UAC 启动安装测试被系统报告用户取消，因此 M1 包安装验证未执行；旧 `msix-smoke.json` 属于 M0，不作为本轮证据。
- 清理：本轮 Marker 测试进程已关闭；没有本轮测试包安装，也未新增机器级信任，精确 Marker.Dev 指纹在 LocalMachine/TrustedPeople 中不存在。当前用户开发签名材料仍保留。
- Graphify：执行 `graphify extract . --code-only --no-cluster`，371 节点、461 边；没有语义提取，CSS、manifest、文档和 global.json 的关系不能由图谱替代核验。
- 限制：用户暂不方便参与真实 IME，组合输入、候选框定位、跨视图焦点和窗口浮层仍待人工验收。浏览器插入文本与原生按键测试均不冒充 IME 通过。M1 MSIX 安装、最低 build 26100 实机、完整 WebView 导航/资源安全集成、远端 Actions 和生产发布未验收。
- 提交追溯：本记录随 M1 原型提交维护，使用 `git log -- docs/progress.md` 查询；无 Git push。原有方案阶段总览表格格式修改继续保留在工作区，不纳入本轮提交。

## 2026-10-07：补齐 M1 安装与真实 WebView 安全样例验收

- 范围：复核当前实现与尚需人工处理的事项；没有修改应用源码，没有重建既有应用二进制。使用 `cdab1fa` 生成的 MSIX 重签名并完成安装测试，新增可复跑的 `scripts/test-webview-m1.js`。
- 安装结果：`test-msix.ps1 -M1` 在 Windows build 26300 通过；本轮 `msix-smoke.json` 的 installed、windowShown、previewReady、editPreviewUpdated、closedNormally、uninstalled、machineTrustRemoved 和 passed 均为 true，编辑后状态为 `预览已同步 · v2`。该结果取代当前产物目录中的旧安装结果，不改变前一条历史记录。
- 最新开发签名包：95,408,604 字节，SHA-256 `71B52CCFD0DF232BDFFAC588C8AF7832E7AEE408D530A9779FF7F2892485E1A8`；路径仍为 `artifacts/msix/Marker.App_0.1.0.0_x64_Test/Marker.App_0.1.0.0_x64.msix`。重签名改变包哈希，不代表应用代码改变。
- 真实 WebView2 安全样例：现有 Playwright MCP 通过临时本机 CDP 连接实际编辑/预览视图，验证原生解析与预览净化、CSP 外部网络限制、本地文件拒绝、新窗口阻止、外部/跨视图/file 导航取消、错误会话拒收，以及预览页不能发送编辑快照；均通过。测试脚本最初将 request 事件误当作网络访问成功，改为检查被取消请求的失败状态后通过，产品实现没有因此改动。
- 清理：临时 MSIX 已卸载，机器级 Marker.Dev TrustedPeople 信任不存在；直接启动的测试窗口正常关闭，Marker 进程与本机 9222 调试监听不存在，MCP 页面已关闭。调试参数只传给本次测试进程，未写入发布配置。
- 源码复核：结合 Graphify 与源码检查会话、过期渲染和窗口生命周期，未发现明确阻断问题。快照同时受 UTF-16 文本上限与 UTF-8 JSON 字节上限约束，实际可同步长度取两者较小值；大量中文可提前触发 JSON 上限，原文仍留在编辑器中，不代表支持任意 1 Mi 字符文档。
- Graphify：code-only、no-cluster 更新后为 372 节点、461 边，没有语义提取。
- 仍需人工：按工程指南检查真实中文 IME 组合、候选框位置、跨视图焦点、撤销重做和浮层；用户此前表示暂不方便，继续保留待验收。最低 build 26100 兼容结论须有该环境的设备证据，本机不替代它。正式生产签名属于 M5，当前无需提供凭据或重新决定产品名称、许可证与渠道。
- 本次未重跑 MSTest、Web 构建或远端 CI；前一条 5/5 测试与构建结果为历史证据。无 Git push；记录和新增测试脚本随本次提交维护。

## 2026-10-07：M1 人工反馈与新段落快捷键

- 用户反馈：大部分体验验收通过；微信输入法、多显示器、200% 缩放时，刚启动即可出现候选框不可见或落屏外。另指出换段需要两次 Enter，希望有更直接的操作。
- 已修复换段操作：新增 Ctrl+Enter，在当前逻辑行后原子插入 Markdown 段落空行并定位光标，使用独立撤销事务；增加界面及无障碍说明。保留 Enter 单换行规则，不通过空白区域点击隐式改文档。
- 验证：本轮 Web 类型/生产构建、Release 与 MSIX 构建通过，0 warning、0 error；MSTest 5/5 通过；现有 Playwright 脚本增加快捷键、撤销和重做检查并全部通过。开发签名包安装、预览 v3 更新、正常关闭、卸载和临时信任清理通过。
- 本轮 MSIX SHA-256：`17D2FC2D0FAA63EC8499A42692AC507D4172EEEEDAAFE629283AFD8B958227DD`；产物路径不变。应用二进制已重新生成，未推送远端。
- 候选框：尚未修复。源码未发现自定义屏幕坐标补偿；CodeMirror Windows 路径没有启用 EditContext，manifest 已为 PerMonitorV2。公开 WebView2 同类报告只作为线索，不能证明本机根因。当前进行普通 textarea 与编辑器的临时对照，未把诊断控件或调试端口写入应用或发布配置。
- 提交：换段改动单独验证并提交；保留用户既有方案表格格式修改。M1 保持候选框缺陷待修复状态，不进入 M2。

## 2026-10-07：微信输入法候选框宿主对照

- 用户实测对照：Marker 的 CodeMirror 与临时普通 textarea 都异常；独立 Edge 普通 textarea 正常，用户确认移到其描述的 200% 问题屏后仍正常；Marker 切换微软拼音正常；临时 WinForms 原生窗口 WebView2 普通 textarea 使用微信输入法正常。
- 本机微信输入法文件版本为 `2.1.4.6`。Edge、Marker 和原生窗口对照实际运行的 WebView2/Edge 均为 `154.0.4258.62`，CDP revision 一致。因此没有把对照差异归因于浏览器版本，也没有把问题归因于 CodeMirror 换段命令。
- 限制：最终读取的 Edge 原生窗口 DPI 为 120，网页 devicePixelRatio 为 1.25；Marker 与原生窗口对照网页也读取为 1.25。这些采样不能证实用户描述的 200% 屏幕状态，也不能单独解释候选框故障。后续宿主实验需记录复现当时的显示器、原生 DPI 与候选框位置。
- 官方 WinUI WebView2 源码已包含初始化 HWND 切换、XamlRoot 比例与 Bounds 更新、窗口移动通知。其控制器未公开给应用；未找到可靠的应用层最小修复，不使用反射或猜测性坐标乘除。源码与官方 API 核查只支持宿主模式是下一步调查方向，尚不能确定 WinUI、WebView2 或微信输入法哪一方的具体缺陷。参考：[WinUI 实现](https://github.com/microsoft/microsoft-ui-xaml/blob/main/controls/dev/WebView2/WebView2.cpp)、[控制器窗口移动通知](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.notifyparentwindowpositionchanged)。
- 临时原生窗口对照程序位于被忽略的 `.tools/ime-windowed/`，使用现有 WebView2 NuGet 版本，独立用户数据目录，不进入解决方案或发布包。诊断构建成功，0 error、1 个 WindowsBase/WPF 引用冲突 warning；首次启动的 STA 线程错误已在诊断程序修正，随后页面初始化与用户输入对照成功。此结果不代替 Marker 的构建或发布验收。
- 对照用 Marker、独立 Edge 和原生窗口测试进程均已正常关闭，诊断端口已清理。生产代码与安装包未因本次诊断改变；本次只维护文档，无需重建应用或 Graphify。
- 待用户决策：保留 WinUI 3 外壳，先在应用内验证编辑区原生子窗口 WebView2 宿主；该方式会增加 HWND 布局、DPI、焦点和无障碍集成工作，并限制 XAML 动画、裁剪及覆盖编辑区的浮层。独立窗口通过不能证明嵌入 WinUI 后必然修复，必须先验证再确认架构。M1 保持未退出。

## 当前阶段

- M0 已完成；M1 原型实现与上述自动/EXE 检查完成，安装与上述真实 WebView 安全样例验收通过；用户人工反馈大部分通过，但微信输入法候选框异常待定位/修复，阶段尚未退出。
- 当前程序仅使用内置受控样例，没有打开、保存、文件树或真实文档工作流。
- M2 保持待实施；先完成 M1 的真实 IME 退出检查。

## 后续阶段

| 阶段 | 目标 | 状态 |
|---|---|---|
| M1 技术风险原型 | 编辑/预览链路、中文输入、WebView 安全边界和长文基线 | 原型、安装与安全样例通过；候选框缺陷待修复 |
| M2 安全文件闭环 | 打开、保存、冲突检测、恢复与本地资源边界 | 待实施 |
| M3 可用编辑阅读 | P0 编辑、阅读和 Markdown 能力 | 待实施 |
| M4 UI 与 Windows 适配 | 原生交互、视觉、动效与系统适配 | 待实施 |
| M5 发布验收 | P0 回归、签名、MSIX 安装和发布准备 | 待实施；生产签名凭据待维护者提供 |
| M6 P1 迭代 | 按用户反馈评估并实现 P1 能力 | 待 M5 后排期 |

## 下一步：M1 剩余退出条件

- 按[开发方案 M1](开发方案.md)完成剩余人工 IME 验收；已通过的本次检查不重复冒充新结果。
- 验证 CodeMirror 编辑文本经过 C# 会话版本校验、Markdig 解析并更新常驻预览页的全量快照链路。
- 使用两个职责分离的 WebView2，并验证共享环境、资源映射、消息来源检查、导航和文档 HTML 隔离。
- 在真实 Windows 桌面验证中文 IME、焦点、撤销、编辑长文和预览更新；记录设备 build 与观察结果。
- 未通过安全门槛前，不将预览暴露给真实用户文档内容。
- 完成后记录改动文件/行为、可复现命令、测试结果、真实设备限制和 Git 提交，再将阶段状态改为完成。

## 持续维护

- 每个有意义的开发任务完成后追加简短记录，未验证事项继续保留为未验证。
- 构建、业务测试、最低系统实机、签名、安装、远端 CI、push 和发布是不同证据，不互相推断。
- 新的稳定技术结论同步更新[技术决策](decision.md)；源码职责变化同步更新[架构基线](architecture.md)。
- 本文件描述历程，不替代产品需求、操作指南、Git 历史或 CI 运行记录。
