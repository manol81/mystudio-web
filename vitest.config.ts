import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests de lógica pura (DSP de audio, parseo de manifests). Corren en
// Node, sin DOM ni Next: todo lo que se prueba acá son funciones sobre
// Float32Array. Los AudioBuffer que necesita projectMixdown se simulan
// en el propio test — no hace falta jsdom ni un entorno de navegador.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
