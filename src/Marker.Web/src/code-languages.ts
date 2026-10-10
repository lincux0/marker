import { StreamLanguage, type Language } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";

const languages = new Map<string, Language>();
for (const [aliases, language] of [
  [["javascript", "js", "jsx", "mjs", "cjs"], javascript({ jsx: true }).language],
  [["typescript", "ts", "tsx"], javascript({ typescript: true, jsx: true }).language],
  [["python", "py"], python().language],
  [["json"], json().language],
  [["csharp", "cs", "c#"], StreamLanguage.define(csharp)],
  [["shell", "sh", "bash", "zsh"], StreamLanguage.define(shell)],
] as const) for (const alias of aliases) languages.set(alias, language);

export function codeLanguage(info: string): Language | null {
  return languages.get(info.trim().split(/\s+/)[0].toLowerCase()) ?? null;
}
