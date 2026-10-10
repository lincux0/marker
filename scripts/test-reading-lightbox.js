// U3 lightbox checks for the editable CodeMirror view; run through the configured Playwright MCP stub.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = "44444444444444444444444444444444";
  const safeUrl = `https://document.marker.example/${sessionId}/image/${"e".repeat(48)}`;
  const brokenUrl = `https://document.marker.example/${sessionId}/image/${"f".repeat(48)}`;
  const errors = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    await editor.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === "message") handlers.push(handler); },
      } };
    });
    editor.on("pageerror", error => errors.push(error.message));
    await editor.route("https://document.marker.example/**", route => route.request().url() === brokenUrl
      ? route.fulfill({ status: 404, contentType: "text/plain", body: "missing" })
      : route.fulfill({ status: 200, contentType: "image/png", path: "D:/marker/src/Marker.App/Assets/Square44x44Logo.png" }));
    await editor.goto("http://127.0.0.1:5173/index.html");
    const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    await send({ type: "initialize", text: "[![可放大](safe.png)](https://example.com/target)\n\n![加载失败](broken.png)\n\n![未映射](remote.png)" });
    const version = 0;
    await send({ type: "imageResources", version, resources: [
      { source: "safe.png", url: safeUrl }, { source: "broken.png", url: brokenUrl },
    ] });
    await editor.locator(".cm-md-image-zoom").waitFor();
    await editor.waitForFunction(() => document.querySelector(".cm-md-image-zoom") &&
      document.querySelectorAll(".cm-md-image-placeholder").length === 2);
    check(await editor.locator(".cm-md-image-zoom").count() === 1, "Only the successfully loaded controlled image should expose zoom.");

    const trigger = editor.locator(".cm-md-image-zoom");
    await editor.locator(".cm-md-image img").first().click({ modifiers: ["Control"] });
    check(await editor.evaluate(() => window.markerTest.sent.some(message => message.type === "openLink" && message.url === "https://example.com/target")),
      "Ctrl-clicking a linked image no longer opens its link through the bridge.");
    await trigger.click();
    const dialog = editor.locator("dialog.marker-lightbox");
    await editor.waitForFunction(() => document.querySelector("dialog.marker-lightbox")?.open === true);
    check(await dialog.locator("img").getAttribute("alt") === "可放大", "The lightbox did not retain the image alternative text.");
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui/u3-lightbox.png' });
    await editor.keyboard.press('Tab');
    check(await editor.getByRole('button', { name: '查看原尺寸' }).evaluate(element => document.activeElement === element), 'Tab escaped the modal controls.');
    await editor.getByRole("button", { name: "查看原尺寸" }).click();
    check(await editor.getByRole("button", { name: "适应窗口" }).count() === 1, "Original-size mode did not offer return to fit mode.");
    await editor.keyboard.press("+");
    await editor.keyboard.press("-");
    await editor.keyboard.press("Escape");
    await editor.waitForFunction(() => !document.querySelector("dialog.marker-lightbox")?.open);
    await editor.evaluate(() => {
      const trigger = document.querySelector('.cm-md-image-zoom');
      for (const url of ['https://example.com/untrusted.png', 'https://document.marker.example/' + '9'.repeat(32) + '/image/' + 'e'.repeat(48)]) {
        document.querySelector('#editor').dispatchEvent(new CustomEvent('marker-image-zoom', { detail: { url, trigger } }));
      }
    });
    check(await dialog.evaluate(element => !element.open && !element.querySelector('img').hasAttribute('src')), 'An unapproved image event reopened the viewer.');
    check(await trigger.evaluate(element => element === document.activeElement), "Closing the lightbox did not restore focus to its trigger.");

    await trigger.click();
    await editor.waitForFunction(() => document.querySelector("dialog.marker-lightbox")?.open === true);
    await send({ type: "imageResources", version, resources: [{ source: "safe.png", url: safeUrl }] });
    await editor.waitForFunction(() => !document.querySelector("dialog.marker-lightbox")?.open);
    check(errors.length === 0, `Lightbox raised browser errors: ${JSON.stringify(errors)}`);
    return { passed: true, checks: ["success-only-zoom-control", "linked-image-ctrl-click", "fit-original-and-keyboard-zoom", "modal-tab-cycle", "escape-and-focus-restore", "unapproved-image-events-rejected", "resource-update-closes-dialog"], runtimeErrors: errors };
  } finally {
    await context.close();
  }
}
