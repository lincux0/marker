# M3 Markdown 兼容样例

本文件记录首版预览承诺的 CommonMark 核心语法和选定 GFM 扩展。JavaScript 和 TypeScript 代码围栏由本地解析器高亮，其它语言按纯文本安全显示；标题大纲、链接与受控图片由预览单独处理。

## 标题与行内格式

Setext 标题
----------

段落支持 **粗体**、*斜体*、`行内代码`、~~删除线~~、软换行，以及转义字符 `\*`。

## 引用、列表与任务项

> 引用段落可以包含 **强调**。
>
> - 引用内列表
> - 第二项

1. 有序列表
2. 第二项
   - 嵌套无序项

- [x] 已完成任务
- [ ] 待办任务

## 表格

| 对齐 | 语法 |
| :--- | ---: |
| 左对齐 | `:---` |
| 右对齐 | `---:` |

## 链接与自动链接

[CommonMark](https://commonmark.org/) 和自动识别的 https://example.com 链接由预览点击处理，页面不会直接导航。

## 代码围栏

```typescript
const answer: number = 42;
console.log(`answer = ${answer}`);
```

```javascript
function greet(name) {
  return `Hello, ${name}`;
}
```

```text
未知语言标记不执行外部查找，代码仍以纯文本安全显示。
```

## HTML 安全边界

原始 HTML 不作为活动内容传入预览：

<script>alert("不得执行")</script>

不承诺 Obsidian 双链、Callout、嵌入、数学公式、Mermaid 或 GitHub 专有扩展。
