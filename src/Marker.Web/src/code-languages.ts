import { StreamLanguage, type Language } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { php } from "@codemirror/lang-php";
import { c, cpp, csharp, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { css } from "@codemirror/legacy-modes/mode/css";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { mySQL, pgSQL, sqlite } from "@codemirror/legacy-modes/mode/sql";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";

const languages = new Map<string, Language>();
for (const [aliases, language] of [
  [["javascript", "js", "jsx", "mjs", "cjs"], javascript({ jsx: true }).language],
  [["typescript", "ts", "tsx"], javascript({ typescript: true, jsx: true }).language],
  [["python", "py"], python().language],
  [["json"], json().language],
  [["csharp", "cs", "c#"], StreamLanguage.define(csharp)],
  [["shell", "sh", "bash", "zsh"], StreamLanguage.define(shell)],
  [["html"], StreamLanguage.define(html)],
  [["xml"], StreamLanguage.define(xml)],
  [["css"], StreamLanguage.define(css)],
  [["sql", "sqlite"], StreamLanguage.define(sqlite)],
  [["postgres", "postgresql", "pgsql"], StreamLanguage.define(pgSQL)],
  [["mysql"], StreamLanguage.define(mySQL)],
  [["c"], StreamLanguage.define(c)],
  [["cpp", "c++", "cxx"], StreamLanguage.define(cpp)],
  [["java"], StreamLanguage.define(java)],
  [["kotlin", "kt"], StreamLanguage.define(kotlin)],
  [["go", "golang"], StreamLanguage.define(go)],
  [["rust", "rs"], StreamLanguage.define(rust)],
  [["swift"], StreamLanguage.define(swift)],
  [["php"], php({ plain: true }).language],
  [["ruby", "rb"], StreamLanguage.define(ruby)],
  [["yaml", "yml"], StreamLanguage.define(yaml)],
  [["toml"], StreamLanguage.define(toml)],
  [["ini", "properties"], StreamLanguage.define(properties)],
  [["powershell", "ps1"], StreamLanguage.define(powerShell)],
  [["lua"], StreamLanguage.define(lua)],
  [["dockerfile", "docker"], StreamLanguage.define(dockerFile)],
  [["diff", "patch"], StreamLanguage.define(diff)],
] as const) for (const alias of aliases) languages.set(alias, language);

export function codeLanguage(info: string): Language | null {
  return languages.get(info.trim().split(/\s+/)[0].toLowerCase()) ?? null;
}
