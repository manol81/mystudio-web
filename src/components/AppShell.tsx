"use client";

// Envoltorio del área principal — decide si mostrar el riel
// publicitario (AdRail) según la ruta actual. Vive en un componente
// aparte de layout.tsx (que es un Server Component, sin acceso a
// hooks) porque necesita usePathname(), que exige "use client".

import { usePathname } from "next/navigation";
import { AdRail } from "@/components/AdRail";
import { EmailVerificationGate } from "@/components/EmailVerificationGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // El Arranger necesita TODO el ancho disponible para el editor
  // multipista — ningún otro caso amerita sacrificar espacio de
  // contenido por publicidad.
  const showAdRail = !pathname.startsWith("/arranger");

  return (
    <main className="flex h-full flex-1 overflow-hidden">
      <div className="h-full flex-1 overflow-y-auto">
        <EmailVerificationGate>{children}</EmailVerificationGate>
      </div>
      {showAdRail && <AdRail />}
    </main>
  );
}
