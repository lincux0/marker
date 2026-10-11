# Marker

Marker 是面向 Windows 的本地 Markdown 编辑与阅读器，在同一正文页面中编辑并即时呈现 Markdown。文件始终以普通 Markdown 源文保存，无需账户或云服务。

目前处于早期开发阶段，支持 **Windows 11 24H2（build 26100）及以上、x64**。源码采用 [MIT 许可证](LICENSE)，第三方组件遵循[各自许可证](THIRD_PARTY_NOTICES.md)。

## 功能

- 单文档编辑、查找替换、撤销重做、同页源码标记切换。
- 常见 Markdown、任务列表、表格和代码高亮；标题大纲、锚点导航、本地图片放大、专注模式与字数统计。
- KaTeX 公式、脚注、五类提示框，以及受限的 Mermaid 流程图和时序图。
- 保存冲突检测、外部修改通知与重载、恢复草稿、编码和换行保留。
- 外观与排版设置、顶部栏自动隐藏、减少动画、高对比适配和当前用户 Markdown 打开方式注册。

编辑期呈现与 Markdig 解析存在差异，原始 HTML、远程图片和任意 Mermaid 图类型不受支持。多标签、文件树、云同步、导出和打印尚未实现；具体用法与容量限制见[用户指南](docs/用户指南.md)。

## 安装与开始使用

从本仓库 [Releases](https://github.com/lincux0/marker/releases) 查找可用版本；若尚无发布资产，请从源码构建。

1. 确认系统要求并安装可用的 Microsoft Edge WebView2 Evergreen Runtime，缺失时 Marker 会提示。
2. 使用 `Marker-Setup-<版本>-x64.exe` 安装到当前用户目录；安装不会接管已有 Markdown 默认应用。
3. 从开始菜单启动，用 `Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Alt+M` 显示或隐藏源码标记。

当前本地构建的 Setup/MSIX 未签名；MSIX 需按工程指南完成签名和安装流程。不要关闭系统安全策略或信任来源不明的开发证书。下载校验、恢复、卸载及默认打开方式见用户指南。

## 从源码构建

需要 Windows x64、PowerShell 7 或 Windows PowerShell、Node.js `24.19.x`、npm `12.x`、Windows SDK `10.0.26100` 工具链和可用网络。.NET SDK 固定为 `10.0.401`，禁止 roll-forward；仓库脚本可将该 SDK 下载到 `.tools` 并核对 SHA-512，不安装到系统。无需安装 Visual Studio IDE；应用依赖由项目清单和锁文件固定。

```powershell
git clone https://github.com/lincux0/marker.git
Set-Location marker
./scripts/bootstrap.ps1
./scripts/build.ps1
```

脚本使用锁定依赖，执行 Web 类型检查、生产构建、Release 构建和 MSTest。EXE 位于 `src/Marker.App/bin/x64/Release/net10.0-windows10.0.26100.0/win-x64/Marker.App.exe`，运行时须保留完整输出目录。

```powershell
# 当前用户 Setup（含 Release 构建与测试）
./scripts/build-setup.ps1
# 未签名 MSIX
./scripts/build.ps1 -Package
```

Setup 输出到 `artifacts/setup/`，MSIX 输出到 `artifacts/msix/`。环境、测试、签名和故障排查见[工程开发指南](docs/工程开发指南.md)。

## 文档

- [用户指南](docs/用户指南.md)：安装、编辑、文件保护、快捷键、数据与限制。
- [文档索引](docs/README.md)：区分当前说明、长期规划与历史验收。
- [贡献指南](CONTRIBUTING.md)：问题反馈、PR 与验证要求。
- [安全政策](SECURITY.md)：私密漏洞报告与安全边界。
- [发布指南](docs/发布指南.md)：源码公开与二进制分发检查。
- [项目结构](docs/architecture.md)：当前架构、模块职责与后续设计边界。
- [技术决策](docs/decision.md)：已确认的选型、理由和待决事项。
- [项目建设历程](docs/progress.md)：阶段状态、建设记录与验证依据。
- [工程开发指南](docs/工程开发指南.md)：环境、日常构建、测试、MSIX 与 CI。
- [第三方依赖声明](THIRD_PARTY_NOTICES.md)：当前直接依赖的版本和许可证来源。
- [开发方案](docs/开发方案.md)：产品架构与阶段计划。

## 参与

一般问题或功能建议请提交 [Issue](https://github.com/lincux0/marker/issues)，附上版本、系统环境和最小复现；不要上传私密文档或恢复草稿。漏洞报告请遵循安全政策。历史验证和未完成验收见项目建设历程，不将其视为每次提交均已重新执行。
