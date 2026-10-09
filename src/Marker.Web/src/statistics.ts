import { markdownLanguage } from "@codemirror/lang-markdown";

export type MarkdownStatistics = { words: number; paragraphs: number };

const excludedNodes = new Set([
  "Image",
  "LinkReference",
  "LinkLabel",
  "URL",
  "LinkTitle",
  "HorizontalRule",
  "CodeInfo",
  "HTMLTag",
  "TaskMarker",
  "TableDelimiter",
]);

export function countMarkdown(text: string): MarkdownStatistics {
  const removed = new Uint8Array(text.length);
  const separated = new Uint8Array(text.length);
  const tree = markdownLanguage.parser.parse(text);
  const paragraphRanges: Array<[number, number]> = [];

  tree.iterate({
    enter(node) {
      if (node.name === "Paragraph" || node.name === "Task") paragraphRanges.push([node.from, node.to]);
      const exclude = excludedNodes.has(node.name);
      if (!exclude && !node.name.endsWith("Mark")) return;
      for (let offset = node.from; offset < node.to; offset++) {
        if (exclude) removed[offset] = 1;
        else separated[offset] = 1;
      }
    },
  });

  const visibleText = (from: number, to: number): string => text.slice(from, to).replace(/[\s\S]/g, (character, offset: number) => {
    const position = from + offset;
    if (character === "\n") return "\n";
    if (removed[position]) return " ";
    return separated[position] ? "" : character;
  });
  const plainText = visibleText(0, text.length);
  let paragraphs = 0;
  for (const [from, to] of paragraphRanges) {
    if (visibleText(from, to).trim()) paragraphs++;
  }
  let hanCount = 0;
  const han = /\p{Script=Han}/gu;
  while (han.exec(plainText)) hanCount++;
  const withoutHan = plainText.replace(/\p{Script=Han}+/gu, " ");
  const Segmenter = Intl.Segmenter;
  const segmenter = new Segmenter("en", { granularity: "word" });
  let englishCount = 0;
  for (const part of segmenter.segment(withoutHan)) {
    if (part.isWordLike) englishCount++;
  }
  return { words: hanCount + englishCount, paragraphs };
}
