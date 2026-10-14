import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps the build relocatable: works at a domain root or in a sub-path.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
