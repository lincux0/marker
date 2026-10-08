"""Check native chrome against the editor's light/dark palette tokens."""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
native = (root / "src/Marker.App/WritingPalette.cs").read_text(encoding="utf-8")
css = (root / "src/Marker.Web/src/style.css").read_text(encoding="utf-8")
entries = re.findall(r'\("(\w+)", (false|true)\) => \(0x([\dA-F]+)u, 0x([\dA-F]+)u\)', native)
for dark, pattern in [("false", r'_ => \(0x([\dA-F]+)u, 0x([\dA-F]+)u\)'),
                      ("true", r'\(_, true\) => \(0x([\dA-F]+)u, 0x([\dA-F]+)u\)')]:
    match = re.search(pattern, native)
    assert match, "Native default palette is missing"
    entries.append(("lavender", dark, *match.groups()))
assert len(entries) == 10, "Expected five light/dark palettes"
for palette, dark, background, accent in entries:
    selector = 'html' if palette == "lavender" else f'html[data-color-palette="{palette}"]'
    if dark == "true":
        selector = 'html[data-theme="dark"]' + (f'[data-color-palette="{palette}"]' if palette != "lavender" else '')
    block = css.split(selector + " {", 1)[1].split("}", 1)[0]
    for name, expected in [("background", background), ("accent", accent)]:
        actual = re.search(r"--editor-" + name + r":\s*#([\da-fA-F]+)", block).group(1)
        assert actual.upper() == expected, (palette, dark, name, actual, expected)
print("Native/Web palette parity: 10 light/dark combinations passed")
