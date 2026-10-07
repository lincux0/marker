const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("找不到应用入口元素。");
}

app.textContent = "Marker Web 工程已初始化。";
