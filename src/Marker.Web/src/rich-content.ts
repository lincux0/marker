import { StateEffect } from "@codemirror/state";

export type RichNode = { kind: "math-inline" | "math-block" | "footnote-reference" | "footnote-definition" | "alert"; from: number; to: number; text: string; label: string; target: number };
export const richContent = StateEffect.define<readonly RichNode[]>();

export function validateRichContent(value: unknown, length: number): RichNode[] | null {
  if (!Array.isArray(value) || value.length > 16384) return null;
  const nodes: RichNode[] = [];
  let previous = -1;
  let lastReplacementEnd = -1;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 6 ||
        !["math-inline", "math-block", "footnote-reference", "footnote-definition", "alert"].includes(item.kind) ||
        !Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to) || item.from < previous || item.from < 0 || item.to <= item.from || item.to > length ||
        typeof item.text !== "string" || typeof item.label !== "string" || item.text.length > 1048576 || item.label.length > 1048576 ||
        !Number.isSafeInteger(item.target) || item.target < 0 || item.target > length) return null;
    if (item.kind === "alert" && !["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].includes(item.text)) return null;
    if (item.kind === "math-inline" || item.kind === "math-block" || item.kind === "footnote-reference") {
      if (item.from < lastReplacementEnd) return null;
      lastReplacementEnd = item.to;
    }
    nodes.push(item as RichNode);
    previous = item.from;
  }
  return nodes;
}
