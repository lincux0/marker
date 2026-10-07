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

## 当前阶段

- M0 已完成；M1 原型实现与上述自动/EXE 检查完成，安装与上述真实 WebView 安全样例验收通过；阶段仍为“待人工 IME”，尚未退出。
- 当前程序仅使用内置受控样例，没有打开、保存、文件树或真实文档工作流。
- M2 保持待实施；先完成 M1 的真实 IME 退出检查。

## 后续阶段

| 阶段 | 目标 | 状态 |
|---|---|---|
| M1 技术风险原型 | 编辑/预览链路、中文输入、WebView 安全边界和长文基线 | 原型、安装与安全样例通过；待人工 IME |
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
