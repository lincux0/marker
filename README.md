# Marker

Marker 是一款面向 Windows 的 Markdown 编辑与阅读器，提供安全的本地文件工作流，并以 CodeMirror 6 在单一正文页面即时呈现和编辑 Markdown。

当前界面采用单一正文编辑视图：常见 Markdown 标记会在编辑时隐藏并显示排版效果，原始 Markdown 仍作为唯一文档内容保存；`Ctrl+Alt+M` 可临时显示源码标记。Markdig 继续负责最终解析，编辑期语法呈现与 Markdig 的差异及未支持语法见[技术决策](docs/decision.md)。本轮 Release EXE 构建成功，40 项业务测试通过、1 项因符号链接权限跳过，针对单页编辑的短网页检查通过；没有进行桌面输入法或长时间实机测试，需由用户验收新体验。

## 项目决策

- 产品名与 MSIX 包身份：`Marker`，开发发布者：`CN=Marker.Dev`。
- 许可证：MIT；许可证决策由项目维护者负责，见根目录 `LICENSE`。
- 支持范围：Windows 11 24H2，最低 build 26100；首发 x64。
- 仓库：[https://github.com/lincux0/marker](https://github.com/lincux0/marker)，当前为私有仓库。
- 分发：已选定站外 MSIX，Microsoft Store 保留为候选渠道；正式站外签名凭据由维护者在 M5 前提供。

## 构建

需要 Windows x64、PowerShell 7 或 Windows PowerShell、Node.js 24.19.x、npm 12.x、Windows SDK 10.0.26100 和可用网络。无需安装 Visual Studio IDE；Windows App SDK、WebView2 和 .NET 依赖由项目锁定。若全局没有 .NET SDK，仓库脚本可将指定 SDK 下载到 `.tools` 并核对 SHA-512，不安装到系统。

```powershell
./scripts/bootstrap.ps1
./scripts/build.ps1
./scripts/build.ps1 -Package
```

MSIX 输出到 `artifacts/msix/`，默认未签名。构建、签名与安装流程及安全边界见[工程开发指南](docs/工程开发指南.md)。

## 文档

- [项目结构](docs/architecture.md)：当前架构、模块职责与后续设计边界。
- [技术决策](docs/decision.md)：已确认的选型、理由和待决事项。
- [项目建设历程](docs/progress.md)：阶段状态、建设记录与验证依据。
- [工程开发指南](docs/工程开发指南.md)：环境、日常构建、测试、MSIX 与 CI。
- [第三方依赖声明](THIRD_PARTY_NOTICES.md)：当前直接依赖的版本和许可证来源。
- [开发方案](docs/开发方案.md)：产品架构与阶段计划。

## 当前状态

本轮只重新生成 EXE，未重建 MSIX；之前 M3/M4 对三种模式的 UI 自动化脚本针对旧界面，不适用于当前单页界面。文件桥接、安全与语法兼容范围分别见[架构基线](docs/architecture.md)、[技术决策](docs/decision.md)及[历史兼容样例](docs/samples/m3-compatibility.md)。
