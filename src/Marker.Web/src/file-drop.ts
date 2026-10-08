type FileDropBridge = {
  postMessageWithAdditionalObjects?: (message: object, objects: File[]) => void;
};

const maxDroppedFiles = 64;
const sessionPattern = /^[0-9a-f]{32}$/;

export function enableFileDrop(bridge: FileDropBridge | undefined, getSessionId: () => string | undefined): void {
  const root = document.documentElement;
  const hasFiles = (transfer: DataTransfer | null): boolean =>
    !!transfer && Array.from(transfer.types).includes("Files");

  document.addEventListener("dragover", (event: DragEvent) => {
    const transfer = event.dataTransfer;
    if (!transfer || !hasFiles(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    transfer.dropEffect = "copy";
    root.dataset.fileDrag = "true";
  }, true);

  document.addEventListener("dragleave", (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer) || event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
    delete root.dataset.fileDrag;
  });

  document.addEventListener("drop", (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!hasFiles(event.dataTransfer) && files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    delete root.dataset.fileDrag;

    const sessionId = getSessionId();
    if (files.length < 1 || files.length > maxDroppedFiles || !sessionId || !sessionPattern.test(sessionId) ||
      !bridge?.postMessageWithAdditionalObjects) return;

    bridge.postMessageWithAdditionalObjects(
      { protocolVersion: 1, type: "filesDropped", sessionId, count: files.length },
      files,
    );
  }, true);
}
