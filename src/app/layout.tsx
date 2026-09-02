import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShell } from "@/components/AppShell";

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

export const metadata: Metadata = {
  title: "My Studio Cloud",
  description:
    "Sincronización en la nube, banco de sonidos y cuenta de usuario para My Studio.",
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
