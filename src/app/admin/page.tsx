"use client";

// Panel de administrador — landing con acceso a cada sección. Nueva
// (antes /admin/upload-sample era una URL suelta, sin ningún menú que
// la agrupara). Mismo criterio de gating (useAdminCheck) que el resto
// del panel — ver AdminService.ts / firestore.rules.

import Link from "next/link";
import { Flag, Piano } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";

const SECTIONS = [
  {
    href: "/admin/upload-sample",
    icon: Piano,
    title: "Banco de Sonidos",
    description: "Subir y borrar samples del catálogo.",
  },
  {
    href: "/admin/reports",
    icon: Flag,
    title: "Reportes",
    description: "Revisar publicaciones reportadas por la comunidad.",
  },
] as const;

export default function AdminHomePage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Panel de <span className="text-neon-cyan">Administrador</span>
      </h1>

      {adminCheck === "checking" && (
        <p className="text-xs text-white/40">Verificando permisos...</p>
      )}

      {adminCheck === "signed-out" && (
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión desde la página principal para continuar.
        </p>
      )}

      {adminCheck === "unauthorized" && (
        <p className="max-w-sm text-sm text-red-400">
          Tu cuenta ({user?.email}) no tiene permisos de administrador.
        </p>
      )}

      {adminCheck === "authorized" && (
        <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTIONS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-graphite p-6 text-left transition-colors duration-200 hover:border-neon-cyan/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan">
                <Icon size={20} />
              </span>
              <div>
                <p className="font-display text-base font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-xs text-white/50">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
