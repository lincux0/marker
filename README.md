# Marker

Marker 是一款面向 Windows 的 Markdown 编辑与阅读器，目标是提供本地文件工作流、CodeMirror 6 编辑体验和 Markdig 预览。

项目当前处于 M0 工程阶段。现有程序是可构建的 WinUI 3 空窗口；CodeMirror 6 依赖已锁定，但尚未接入窗口，Markdig 也尚未加入。不要把当前构建描述为可用的 Markdown 编辑器。

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

本机 Windows build 26300 上的 Release 构建、MSIX 生成及开发签名安装烟雾测试已通过；安装后的空窗口标题为 `Marker`、正文为 `Marker M0`，随后已关闭并卸载，临时机器信任已移除。独立本地干净克隆中的锁定依赖恢复、Release 和 MSIX 构建也已通过。测试项目目前没有业务测试，`dotnet test` 显示 0 tests，不代表业务行为已测试。GitHub Actions 尚未在远端执行；没有进行 Git push。
