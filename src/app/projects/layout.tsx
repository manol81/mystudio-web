import type { Metadata } from "next";

// Pantalla de CUENTA: sin sesión no muestra contenido, así que
// indexarla solo gastaría rastreo y le daría a Google una página vacía
// con nuestro nombre. `follow` sí queda activo: los links internos que
// haya acá adentro se siguen valiendo.
//
// Nota para el día que el Banco de Sonidos se abra a visitantes (ver el
// plan de SEO): ese día esta ruta vuelve a ser indexable y hay que
// devolverla al sitemap.
export const metadata: Metadata = {
  title: "Mis Proyectos",
  description: "Tus canciones sincronizadas desde la app y desde el Arranger web.",
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
