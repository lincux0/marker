# U2 复杂内容验收样张

该样张覆盖宽表、长单元格、三种对齐、转义竖线、长代码和图片状态。展示状态变化时，Markdown 原文应保持一致；切换源码视图后仍可读到完整语法。

## 宽表与源码保真

| 项目 | 左对齐 | 居中对齐 | 右对齐 | 含转义竖线 | 长内容 | 第七列 | 第八列 | 第九列 | 第十列 | 第十一列 | 第十二列 |
| :--- | :--- | :---: | ---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 对齐 | 左侧文本 | 居中文字 | 右侧数字 123 | A \| B | 这一格包含较长中文与 English mixed content，用于观察单元格换行、高度增长和宽表边缘是否越界。 | c7 | c8 | c9 | c10 | c11 | c12 |
| 第二行 | 普通短文 | **粗体单元格** | 456.78 | x \| y | long-cell-with-a-deliberately-long-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789 | 7 | 8 | 9 | 10 | 11 | 12 |
| 第三行 | 多行观察 | 仍应居中 | 789 | `inline \| code` | 表格内容可以自然增高；正文和表格源码里的竖线数量需要保持，不能因显示转换丢失反斜线。 | α | β | γ | δ | ε | ζ |

## 长代码块

```text
U2_CODE_COPY_BEGIN
    leading spaces are significant
tabs\tstay as the two literal characters above
中文 English 123 混排与标点 !?; 复制不应插入语言标签或提示文案。
line 004: 0123456789 abcdefghijklmnopqrstuvwxyz
line 005:     indented payload stays indented
line 006: quote: "copy exactly" and backslash: \\
line 007: pipes | remain inside the code fence
line 008: ends of lines must retain their order
line 009: placeholder payload for long-code scrolling
line 010: placeholder payload for long-code scrolling
line 011: placeholder payload for long-code scrolling
line 012: placeholder payload for long-code scrolling
line 013: placeholder payload for long-code scrolling
line 014: placeholder payload for long-code scrolling
line 015: placeholder payload for long-code scrolling
line 016: placeholder payload for long-code scrolling
line 017: placeholder payload for long-code scrolling
line 018: placeholder payload for long-code scrolling
line 019: placeholder payload for long-code scrolling
line 020: placeholder payload for long-code scrolling
line 021: placeholder payload for long-code scrolling
line 022: placeholder payload for long-code scrolling
line 023: placeholder payload for long-code scrolling
line 024: placeholder payload for long-code scrolling
line 025: placeholder payload for long-code scrolling
line 026: placeholder payload for long-code scrolling
line 027: placeholder payload for long-code scrolling
line 028: placeholder payload for long-code scrolling
line 029: placeholder payload for long-code scrolling
line 030: placeholder payload for long-code scrolling
U2_CODE_COPY_END
```

## 容器内代码复制

- 列表围栏：
  ```js
  list first
  list second
  ```

> 引用围栏：
> ```py
> quote first
> quote second
> ```

## 图片状态

![成功 **粗体** 与 `code` 不重叠](u2-safe-image.png)

![缺失图片的替代文字](u2-missing-image.png)

![相对越界资源也不得泄漏磁盘绝对路径](../../private/u2-secret-image.png)
