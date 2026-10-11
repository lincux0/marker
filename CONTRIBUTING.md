# 贡献指南

一般缺陷、文档修订和小范围修复可直接提交 Issue 或 PR；改变产品边界、数据格式、发布渠道或安全策略，请先在 Issue 中讨论。安全漏洞遵循 [SECURITY.md](SECURITY.md)。

## 开发与反馈

从 [README](README.md) 的构建步骤开始，阅读[工程指南](docs/工程开发指南.md)、[架构](docs/architecture.md)与[技术决策](docs/decision.md)。版本以 `global.json`、工程清单和锁文件为准。使用 Windows x64 和固定工具链；不要用升级依赖掩盖环境错误。

`src/Marker.App` 负责原生窗口、文件、恢复、设置和安全边界；`src/Marker.Web` 负责编辑呈现与交互；`tests/Marker.Tests` 测试共享生产纯逻辑。`experiments` 是独立历史原型，不进入生产解决方案。

反馈请提供版本/commit、Windows build、安装方式、复现步骤、预期与实际结果。涉及 WebView2 时记录 Runtime 版本。使用脱敏最小样例；不上传真实文档、草稿、密码或令牌。性能问题说明文档尺寸、语法类型、硬件与操作；安装问题附包来源、哈希、签名状态与完整错误。

## 修改与验证

1. 检查 Git 状态，阅读作用域内 `AGENTS.md` 与实现，保留其他工作。
2. 在共享根因处做必要修改；保护编码、换行、文档、草稿及安全校验，避免无关重构。
3. 非平凡逻辑补充回归；`./scripts/build.ps1` 执行锁定还原、类型检查、Web/Release 构建和 MSTest。UI、文件及安装变更使用工程指南中的现有流程，不引入第二套测试框架。
4. 功能变化重建受影响 EXE/Setup/MSIX，分别记录源码检查、包内容、安装及实机结果。清理本次进程、页面、测试设置和临时证书信任。
5. 更新实际受影响架构/决策说明，在 `docs/progress.md` 追加范围、结果和限制。纯文档检查事实、链接和 diff，无需重建。

源码变化可用 `graphify extract . --code-only --no-cluster` 更新本地图谱，不启用语义提取；图谱不提交，不代替源码或测试。

## PR 与许可证

保持目标清晰，说明问题、修改后行为、验证命令/结果和限制。独立修复分别提交，只暂存相关文件。不要提交 `.tools`、`artifacts`、`bin`、`obj`、`node_modules`、私钥或用户数据。

依赖升级说明理由，并提交清单、锁文件及许可变化。`build.ps1 -UpdateLockfile` 仅用于有意的 NuGet 变更；Web 使用既有 npm 锁文件流程。平时保持锁定还原。

贡献内容须有权按项目 MIT 分发，保留已有版权及第三方条款。来源不明的图标、字体、图片和代码不可提交；第三方内容记录来源与适用许可。

CI 在 Windows 构建未签名 MSIX 并上传 artifact，不自动创建正式 Release。区分网页 mock、真实桌面、包安装与远端 CI；未执行写明未执行，不虚构验证结果。
