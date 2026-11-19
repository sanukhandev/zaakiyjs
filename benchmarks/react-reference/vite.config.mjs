import {fileURLToPath, URL} from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export default {
  root,
  mode: "production",
  build: {outDir: "dist", emptyOutDir: true, target: "es2022", minify: "esbuild"},
  resolve: {dedupe: ["react", "react-dom"]}
};
