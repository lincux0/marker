import { WidgetType, type EditorView } from "@codemirror/view";

export class AnnotationWidget extends WidgetType {
  constructor(readonly label: string, readonly target: number, readonly from: number, readonly isReference = true) { super(); }

  eq(other: AnnotationWidget): boolean {
    return other.label === this.label && other.target === this.target && other.from === this.from && other.isReference === this.isReference;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-md-rich-annotation${this.isReference ? " cm-md-rich-footnote-reference" : ""}`;
    button.textContent = this.label;
    button.setAttribute("aria-label", `定位到${this.label}`);
    button.addEventListener("click", () => {
      view.dom.dispatchEvent(new CustomEvent("marker-rich-navigate", {
        bubbles: true,
        detail: { offset: this.target, returnOffset: this.from },
      }));
    });
    return button;
  }

  ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && !!event.target.closest(".cm-md-rich-annotation");
  }
}
