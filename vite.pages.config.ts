import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function publishPolicyData(): Plugin {
  return {
    name: "publish-policy-data",
    apply: "build",
    async generateBundle() {
      const source = await readFile(resolve(__dirname, "static-site/data/policy-data.json"));
      this.emitFile({
        type: "asset",
        fileName: "data/policy-data.json",
        source,
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "static-site"),
  base: "./",
  publicDir: resolve(__dirname, "public"),
  plugins: [react(), publishPolicyData()],
  build: {
    outDir: resolve(__dirname, "pages-dist"),
    emptyOutDir: true,
  },
});
