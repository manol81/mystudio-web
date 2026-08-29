import type { Config } from "tailwindcss";

// Identidad "Midnight Studio" — paleta de alta gama para My Studio Cloud.
//
// Tailwind v4 (la versión que instaló create-next-app acá) configura el
// tema por defecto directo en CSS (@theme, ver globals.css), sin
// tailwind.config.ts. Este archivo sigue siendo un mecanismo real y
// soportado: globals.css lo carga explícitamente con la directiva
// `@config`, así que estos tokens SÍ terminan generando utilidades de
// Tailwind (bg-onyx-black, text-neon-cyan, font-display, etc.) — no es
// un archivo decorativo sin efecto.
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Fondo principal.
        "onyx-black": "#0B0C10",
        // Superficies elevadas (cards, paneles, inputs).
        graphite: "#1F2833",
        // Acentos interactivos — CTAs, focus states, glow.
        "neon-cyan": "#66FCF1",
      },
      fontFamily: {
        // Títulos / UI destacada.
        display: ["var(--font-display)", "sans-serif"],
        // Texto de lectura.
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
};

export default config;
