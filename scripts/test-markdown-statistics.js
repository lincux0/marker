// Pure countMarkdown regression; run through the existing Playwright script runner.
async (page) => {
  await page.goto('http://127.0.0.1:5173/index.html');
  const results = await page.evaluate(async () => {
    const { countMarkdown } = await import('/src/statistics.ts');
    const cases = [
      ['', 0, 0],
      ['你好世界 Hello world!', 6, 1],
      ['# 标题\n\n第一行\n软换行', 8, 1],
      ['wo**rd** and *italic*', 3, 1],
      ['[read docs](https://example.com "site")\n\n[ref][id]\n\n[id]: https://example.com', 3, 2],
      ['before ![ignored image](image.png) after', 2, 1],
      ['![only image](image.png)', 0, 0],
      ['```javascript\nconst hello = world\n```', 3, 0],
      ['- item\n- [x] done task', 3, 2],
      ['- [x] 完成', 2, 1],
      ['- item\n- [x] done task\n- third', 4, 3],
      ['Use `code word` here', 4, 1],
      ['| name | value |\n| --- | --- |\n| one | two |', 4, 0],
      ['> 引用 text\n> continued', 4, 1],
    ];
    return cases.map(([source, words, paragraphs]) => ({
      source,
      expected: { words, paragraphs },
      actual: countMarkdown(source),
    }));
  });
  const failures = results.filter(({ expected, actual }) => expected.words !== actual.words || expected.paragraphs !== actual.paragraphs);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return { passed: true, cases: results.length };
}
