# Marker.Tests

测试工程使用 MSTest，当前覆盖 M1 原生桥接会话和 Markdig 渲染基线：

- 快照来源、会话、版本、同版本重同步、未知字段与消息大小边界。
- CommonMark 基础语法、选定 GFM 扩展和原始 HTML 禁用。
- 受控长文解析完整性与耗时记录；不把解析耗时当作端到端延迟或 IME 性能。

运行 `dotnet test tests/Marker.Tests/Marker.Tests.csproj -c Release -p:Platform=x64`。这些测试不代替真实 WebView2 安装链路及中文输入法实机验收。
