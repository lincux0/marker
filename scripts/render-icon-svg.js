// Run with the project's Playwright MCP browser_run_code_unsafe filename tool.
async (page) => {
  await page.setViewportSize({ width: 512, height: 512 });
  await page.goto('file:///D:/marker/asserts/icon.svg');
  const svg = page.locator('svg');
  const bounds = await svg.boundingBox();
  if (!bounds || bounds.x !== 0 || bounds.y !== 0 || bounds.width !== 512 || bounds.height !== 512 ||
      await svg.getAttribute('viewBox') !== '0 0 512 512') throw new Error('Unexpected SVG icon canvas.');
  await page.screenshot({ path: 'D:/marker/asserts/icon.png', omitBackground: true });
  return { passed: true, width: bounds.width, height: bounds.height, transparentBackground: true };
}
