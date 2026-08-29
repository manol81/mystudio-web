import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

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
      <body className="min-h-full flex flex-col bg-onyx-black text-white font-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
