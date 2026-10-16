# Third-party notices

本文件记录 Marker 的直接依赖、Web 运行时传递依赖，以及当前 Windows x64 Release 实际运行时依赖的许可证信息。NuGet 版本以 `src/Marker.App/packages.lock.json` 和 `src/Marker.App/obj/project.assets.json` 为准；Web 版本以 `src/Marker.Web/package-lock.json` 为准。对应 NuGet 包内许可证/NOTICE 原文汇总于 [NuGetThirdParty.txt](installer/licenses/NuGetThirdParty.txt)，Web 生产依赖原文汇总于 [WebThirdParty.txt](installer/licenses/WebThirdParty.txt)。这些说明覆盖当前核对的 Release 输出与 Setup 附件，不构成对其他分发形式或后续版本的自动覆盖。

## 应用直接依赖

| 包 | 版本 | 用途 | 许可证依据 |
|---|---:|---|---|
| Microsoft.WindowsAppSDK | 2.5.1 | WinUI 3 / Windows App SDK | NuGet 包内 `license.txt`：Microsoft Software License Terms for Microsoft Windows App SDK；按该包及包含组件各自条款使用，不是 MIT。 |
| Microsoft.Windows.SDK.BuildTools | 10.0.26100.9169 | Windows 应用与 MSIX 构建工具 | 仅构建依赖；NuGet nuspec 指向 Microsoft Windows SDK License 条款。它及 MSIX 编译器不属于应用运行时分发内容。 |
| Microsoft.Data.Sqlite | 10.0.12 | 本地设置 SQLite 数据库 | NuGet nuspec SPDX 为 `MIT`；核心 `Microsoft.Data.Sqlite.Core` 同为 MIT。 |
| Markdig | 1.4.0 | C# Markdown 解析 | 本地 NuGet 包 `markdig.nuspec` 的 SPDX 表达式为 `BSD-2-Clause`。 |

`Microsoft.Web.WebView2` 当前由 Windows App SDK 依赖传递引入，准确版本见 `src/Marker.App/packages.lock.json`，不是应用项目中的直接 PackageReference。

Markdig 1.4.0 的完整版权、条件与免责声明保留在 [Markdig.txt](installer/licenses/Markdig.txt)，来自 NuGet 元数据对应提交 `56e9c238584a44a169f174c881855c049768634c` 的[上游原文](https://github.com/xoofx/markdig/blob/56e9c238584a44a169f174c881855c049768634c/license.txt)。Setup 与 MSIX 均将该文本分发到 `licenses/Markdig.txt`；项目 MIT 不替代此许可证。

## SQLite 运行时传递依赖

本地 NuGet nuspec 核实 `SQLitePCLRaw.bundle_e_sqlite3`、`SQLitePCLRaw.core`、`SQLitePCLRaw.lib.e_sqlite3`、`SQLitePCLRaw.provider.e_sqlite3` 2.1.12 均声明 `Apache-2.0`，作者 Eric Sink；来源：[SQLitePCL.raw](https://github.com/ericsink/SQLitePCL.raw)。安装包包含解析后的 .NET 库及 Windows x64 原生 SQLite 库。SQLite 自身采用公有领域授权，包装库仍按各自许可证交付。

SQLitePCLRaw NuGet 包未在缓存包根目录提供单独许可文本，其 nuspec 均声明 Apache-2.0；随 Setup 附带的完整 [Apache-2.0](installer/licenses/Apache-2.0.txt) 文本适用于该声明。Microsoft.Data.Sqlite 使用完整 [MIT](installer/licenses/MIT.txt) 文本。Inno Setup 6.7.3 仅为安装器构建工具，来源为 [jrsoftware/issrc](https://github.com/jrsoftware/issrc)，按其分发许可使用；不作为应用运行时依赖。

### NuGet 与自包含 .NET 运行时分发文本

`installer/licenses/NuGetThirdParty.txt` 保留 Release 资产中 NuGet 提供的许可证、NOTICE 与第三方声明原文。它包括锁定版本的 Windows App SDK 组件、WebView2、Windows AI Machine Learning、System.Numerics.Tensors，以及 .NET Runtime pack 10.0.12 的许可和第三方声明。完全相同的上游文本只保留一份，并在文本前标出全部来源包和版本；其他不同文本逐份保留。Markdig、Microsoft.Data.Sqlite 和 SQLitePCLRaw 所需文本分别由 `Markdig.txt`、`MIT.txt` 和 `Apache-2.0.txt` 提供。

版本与分发范围通过应用锁文件、`project.assets.json`、Release `win-x64` 输出及其 runtimeconfig/deps 文件交叉核对。`Microsoft.Windows.SDK.BuildTools`、`Microsoft.Windows.SDK.BuildTools.MSIX` 是构建工具；`Microsoft.Windows.SDK.NET.Ref` 是编译引用包，均不作为应用运行时随包声明。Setup 显式携带 NuGet 聚合文件；MSIX/publish 输出由项目文件的 `installer/licenses/*.txt` 通配映射。依赖版本变化时，应从新锁定版本和对应本地 NuGet 包重新核对并更新原文汇总，再检查实际分发附件。

## Web 工程直接依赖

以下许可证已对照安装包的 `package.json` 核实；版本以 `src/Marker.Web/package.json` 固定的直接依赖为准。

| 包 | 版本 | 用途 | 许可证 |
|---|---:|---|---|
| @codemirror/commands | 6.11.1 | 编辑命令 | MIT |
| @codemirror/lang-javascript | 6.2.5 | JavaScript / TypeScript 代码块解析 | MIT（[上游项目](https://github.com/codemirror/lang-javascript)） |
| @codemirror/lang-json | 6.0.2 | JSON 代码解析 | npm 包 `package.json` 与 `LICENSE`：MIT |
| @codemirror/lang-markdown | 6.5.2 | Markdown 语言支持 | MIT |
| @codemirror/lang-python | 6.2.1 | Python 代码解析 | npm 包 `package.json` 与 `LICENSE`：MIT |
| @codemirror/lang-php | 6.0.2 | PHP 代码解析（含无开标签片段） | npm 包 `package.json` 与 `LICENSE`：MIT |
| @codemirror/language | 6.12.4 | 语言基础设施 | MIT |
| @codemirror/legacy-modes | 6.5.2 | 复用 Shell 等 StreamLanguage mode | npm 包 `package.json` 与 `LICENSE`：MIT |
| @codemirror/search | 6.7.2 | 查找与替换能力 | MIT |
| @codemirror/state | 6.7.6 | 编辑器状态 | MIT |
| @codemirror/view | 6.43.13 | 编辑器视图 | MIT |
| @lezer/highlight | 1.2.5 | 代码块 token 高亮 | MIT（[上游项目](https://code.haverbeke.berlin/lezer/highlight)） |
| dompurify | 3.4.16 | 预览 HTML 净化 | npm 包 `package.json` 声明 `(MPL-2.0 OR Apache-2.0)`；随包包含 `LICENSE-MPL`。 |
| katex | 0.19.0 | 数学排版 | npm 包 `package.json` 与 `LICENSE`：MIT；本地字体随包分发。 |
| mermaid | 12.1.0 | 受限 Mermaid 图表解析与生成 | npm 包 `package.json` 与 `LICENSE`：MIT。 |
| typescript | 7.0.2 | 开发与类型检查 | Apache-2.0 |
| vite | 8.3.3 | Web 资源构建 | MIT |

### Web 运行时传递依赖补充

`installer/licenses/WebThirdParty.txt` 汇总 Web 生产依赖闭包中实际安装包提供的 LICENSE/LICENCE/COPYING/NOTICE 文件，按包保留版权和完整文本；依据 `src/Marker.Web/package-lock.json` 生成，排除开发依赖、类型声明包、包安装辅助工具和 OS/CPU 专用绑定。当前 Mermaid 运行时树包含 Chevrotain（Apache-2.0）、`elkjs`（EPL-2.0）、D3 家族（主要 ISC，`d3-ease`/`d3-sankey` 为 BSD-3-Clause）、`rw`（BSD-3-Clause）及 `robust-predicates`（Unlicense）；其余核实的依赖主要为 MIT。DOMPurify 的 MPL 文本也保留在聚合文件中。

依赖更新并完成 `npm ci` 后，可运行 `node scripts/update-web-licenses.mjs` 重新生成 Web 聚合文件。脚本对无包目录、无许可证文本或未解析锁文件依赖会在输出中明确标记并返回失败，需在发布前补齐来源或处理结论。`installer/Marker.iss` 显式将 NuGet/Web 等聚合文件作为附件随 Setup 分发；`Marker.App.csproj` 将项目许可证、本文和 `installer/licenses/*.txt` 映射到 Release/publish 输出及 MSIX 的 `LICENSE.txt`、`THIRD_PARTY_NOTICES.md` 和 `licenses/`。其他分发形式仍须逐项确认实际附件。

## 测试工程直接依赖

以下许可证字段由本机 NuGet 缓存中对应版本的 nuspec 核实，均声明为 MIT。测试工程复用生产纯逻辑代码验证桥接、设置、Markdown 和文件安全行为。

| 包 | 版本 | 用途 |
|---|---:|---|
| Microsoft.NET.Test.Sdk | 17.14.1 | .NET 测试运行 |
| MSTest.TestAdapter | 3.6.4 | MSTest 适配器 |
| MSTest.TestFramework | 3.6.4 | MSTest 框架 |

## 许可证与发布维护

项目自身许可证为根目录 `LICENSE` 中的 MIT License。项目许可证不替代第三方许可证。发布时应包含或提供所有适用的版权声明、许可证文本和微软组件使用条款；只根据包名或“常见许可证”推断许可不充分。

### 项目图标资源

`asserts/icon.svg` 由维护者提供。维护者于 2026-10-16 确认有权按 MIT 发布该源图及其栅格化衍生图；应用图标资源、Web 标志及 `docs/samples/` 中复用的图标样张来自该资源。此来源说明记录维护者提供的权利确认，不表示第三方独立核验。

升级依赖后，先从锁文件确认实际解析版本，再检查对应 NuGet nuspec/许可文件、npm lockfile license 字段及发布组件随附的许可文本。完整清单及所需文本应随发布产物或仓库文档一并交付。
