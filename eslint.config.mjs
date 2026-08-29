import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendorizado tal cual (sin transformar por el bundler a propósito
    // — ver la nota en src/lib/pitchShift.ts) — no es código propio,
    // no tiene sentido lintearlo.
    "public/signalsmith-stretch.mjs",
  ]),
]);

export default eslintConfig;
