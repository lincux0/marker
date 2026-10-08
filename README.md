# Marker

Marker 是一款面向 Windows 的 Markdown 编辑与阅读器，目标是提供本地文件工作流、CodeMirror 6 编辑体验和 Markdig 预览。

项目已实现 M3 编辑阅读功能：在 M2 安全文件闭环上加入版本化增量同步、源码/分栏/阅读模式、标题大纲、中文查找替换、光标状态，以及可持久化的主题与排版设置。生产宿主采用 Win32 根窗口、WinUI 3 XAML Islands 工具栏与原生 WebView2；M1 微信输入法已由用户实机确认正常。发布与兼容性验收仍在进行。

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

Web 生产构建、x64 Release/MSIX 构建通过；业务测试 34 项通过、1 项因符号链接权限跳过。M3 Web 测试覆盖增量、查找替换、设置与历史保留、大纲、链接安全和代码高亮。完整实测结果与未通过/待验范围见[项目建设历程](docs/progress.md)；语法边界见[兼容样例](docs/samples/m3-compatibility.md)。GitHub Actions 尚未在远端执行。
