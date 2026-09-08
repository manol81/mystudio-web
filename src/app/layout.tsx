import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShell } from "@/components/AppShell";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// Identidad "Midnight Studio": Space Grotesk para títulos/UI destacada
// (var --font-display), Inter para texto de lectura (var --font-body).
// Ambas quedan disponibles como variables CSS en <html> y mapeadas a
// utilidades de Tailwind (font-display / font-body) en globals.css.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

// Metadata global (Fase 0): un solo nombre (ver src/lib/site.ts),
// OpenGraph/Twitter para que los links compartidos muestren título e
// imagen, y metadataBase para que las rutas relativas (opengraph-image)
// resuelvan a la URL pública. Cada página puede sobreescribir title/
// description; el template agrega " · MY STUDIO".
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "es_AR",
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${spaceGrotesk.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="h-full bg-onyx-black text-white font-body">
        <AuthProvider>
          {/* Layout de dos columnas — Sidebar fijo + área principal con
              su PROPIO scroll (overflow-y-auto), independiente del
              sidebar. h-screen en el contenedor (no min-h-screen):
              necesitamos que ambas columnas midan EXACTAMENTE el alto
              del viewport, no "al menos" — si no, una página con poco
              contenido dejaría un sidebar más alto que el área
              principal, o viceversa. */}
          <div className="flex h-screen overflow-hidden">
            <AppSidebar />
            <AppShell>{children}</AppShell>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
