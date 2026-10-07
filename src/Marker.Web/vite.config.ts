import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        editor: "index.html",
        preview: "preview.html",
      },
    },
  },
});
