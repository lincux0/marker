# Third-party notices

本文件记录 Marker 当前直接依赖和 M0 测试工程的声明式许可证信息。依赖版本以项目清单与锁文件为准。它不是完整的分发许可证清单：NuGet/npm 传递依赖、Windows SDK/Windows App SDK 的组件级条款，以及最终 MSIX 实际分发内容，须在 M5 发布准备时逐项复核。

## 应用直接依赖

| 包 | 版本 | 用途 | 许可证依据 |
|---|---:|---|---|
| Microsoft.WindowsAppSDK | 2.5.1 | WinUI 3 / Windows App SDK | NuGet 包内 `license.txt`：Microsoft Software License Terms for Microsoft Windows App SDK；按该包及包含组件各自条款使用，不是 MIT。 |
| Microsoft.Windows.SDK.BuildTools | 10.0.26100.9169 | Windows 应用与 MSIX 构建工具 | NuGet nuspec 指向 Microsoft Windows SDK License 条款；须遵守其许可和分发限制，不将其标为 MIT。 |

`Microsoft.Web.WebView2` 当前由 Windows App SDK 依赖传递引入，准确版本见 `src/Marker.App/packages.lock.json`，不是应用项目中的直接 PackageReference。

## Web 工程直接依赖

以下许可证已对照安装包的 `package.json` 核实；版本以 `src/Marker.Web/package.json` 固定的直接依赖为准。

| 包 | 版本 | 用途 | 许可证 |
|---|---:|---|---|
| @codemirror/commands | 6.11.1 | 编辑命令 | MIT |
| @codemirror/lang-markdown | 6.5.2 | Markdown 语言支持 | MIT |
| @codemirror/language | 6.12.4 | 语言基础设施 | MIT |
| @codemirror/search | 6.7.2 | 查找与替换能力 | MIT |
| @codemirror/state | 6.7.6 | 编辑器状态 | MIT |
| @codemirror/view | 6.43.13 | 编辑器视图 | MIT |
| typescript | 7.0.2 | 开发与类型检查 | Apache-2.0 |
| vite | 8.3.3 | Web 资源构建 | MIT |

## 测试工程直接依赖

以下许可证字段由本机 NuGet 缓存中对应版本的 nuspec 核实，均声明为 MIT。测试工程目前没有业务测试。

| 包 | 版本 | 用途 |
|---|---:|---|
| Microsoft.NET.Test.Sdk | 17.14.1 | .NET 测试运行 |
| MSTest.TestAdapter | 3.6.4 | MSTest 适配器 |
| MSTest.TestFramework | 3.6.4 | MSTest 框架 |

## 许可证与发布维护

项目自身许可证为根目录 `LICENSE` 中的 MIT License。项目许可证不替代第三方许可证。发布时应包含或提供所有适用的版权声明、许可证文本和微软组件使用条款；只根据包名或“常见许可证”推断许可不充分。

升级依赖后，先从锁文件确认实际解析版本，再检查对应 NuGet nuspec、npm lockfile license 字段及发布组件随附的许可文件。完整清单及所需文本应随发布产物或仓库文档一并交付。
