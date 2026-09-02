"use client";

// Sidebar global — navegación principal de MY STUDIO Web, ahora que
// deja de ser "una pantalla con un dashboard adentro" para pasar a ser
// una plataforma con varias secciones (Comunidad, Proyectos, Banco de
// Sonidos, Bandeja de Entrada). Vive en el layout raíz (ver
// layout.tsx), así que aparece en TODAS las rutas.
//
// Responsive: en desktop (lg+) es una columna fija de w-64, siempre
// visible. En mobile es un botón de hamburguesa (fixed, esquina
// superior izquierda) que abre un drawer superpuesto — nunca reserva
// ancho de la pantalla chica, que es toda para el contenido.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { Globe, FolderOpen, Piano, MessageSquare, Shield, Menu, X, LogOut } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";
import { ProfileModal } from "@/components/ProfileModal";
import { Tooltip } from "@/components/Tooltip";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Comunidad",
    icon: Globe,
    hint: "Explorá lo que publican otros usuarios y escuchá sus arreglos",
  },
  {
    href: "/projects",
    label: "Mis Proyectos",
    icon: FolderOpen,
    hint: "Tus canciones sincronizadas desde la app y desde el Arranger web",
  },
  {
    href: "/samples",
    label: "Banco de Sonidos",
    icon: Piano,
    hint: "Sonidos y loops listos para armar tu canción",
  },
  {
    href: "/inbox",
    label: "Bandeja de Entrada",
    icon: MessageSquare,
    hint: "Tus mensajes directos (próximamente)",
  },
] as const;

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { user, profile } = useAuth();
  // forceRefresh=false a propósito acá — este hook monta en TODAS las
  // páginas solo para decidir si mostrar el link, no vale la pena
  // forzar un refresh de token en cada carga para todo el mundo (ver
  // useAdminCheck.ts). Las pantallas de /admin en sí sí lo fuerzan.
  const adminCheck = useAdminCheck(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-6">
        <Link href="/" onClick={onNavigate} className="font-display text-lg font-bold tracking-tight text-white">
          MY <span className="text-neon-cyan">STUDIO</span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon, hint }) => {
          // "/" necesita coincidencia EXACTA (si no, siempre estaría
          // "activo" para cualquier ruta, ya que todas empiezan con
          // "/") — el resto sí puede matchear sub-rutas futuras
          // (ej. /projects/123) con startsWith.
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Tooltip key={href} text={hint} side="right" wrapperClassName="relative flex w-full">
              <Link
                href={href}
                onClick={onNavigate}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "bg-neon-cyan/10 text-neon-cyan"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} className="shrink-0" />
                {label}
              </Link>
            </Tooltip>
          );
        })}

        {/* Solo visible con el custom claim admin:true — para todos
            los demás, /admin no existe en la navegación (la ruta
            sigue protegida por firestore.rules de todas formas, esto
            es puramente para no mostrar un link que va a fallar). */}
        {adminCheck === "authorized" && (
          <Tooltip
            text="Panel de administración — samples, reportes y estadísticas"
            side="right"
            wrapperClassName="relative flex w-full"
          >
            <Link
              href="/admin"
              onClick={onNavigate}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                pathname.startsWith("/admin")
                  ? "bg-neon-cyan/10 text-neon-cyan"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Shield size={18} strokeWidth={pathname.startsWith("/admin") ? 2.25 : 1.75} className="shrink-0" />
              Admin
            </Link>
          </Tooltip>
        )}
      </nav>

      {/* Cuenta — al pie, siempre en el mismo lugar sin importar la
          página (antes "Cerrar Sesión" vivía suelto en el dashboard). */}
      {user && (
        <div className="border-t border-white/10 px-3 py-4">
          <Tooltip
            text="Tocá para editar tu nickname público — nunca mostramos tu email en la Comunidad"
            side="right"
            wrapperClassName="relative flex w-full"
          >
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors duration-200 hover:bg-white/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 font-display text-xs font-semibold text-neon-cyan">
                {(profile?.username ?? user.email ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white/80">
                  {profile?.username ?? "Elegir nickname"}
                </p>
                <p className="truncate text-[10px] text-white/30">{user.email}</p>
              </div>
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              void signOut(auth);
            }}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/50 transition-colors duration-200 hover:bg-red-400/10 hover:text-red-300"
          >
            <LogOut size={18} strokeWidth={1.75} className="shrink-0" />
            Cerrar Sesión
          </button>
          {isProfileOpen && <ProfileModal onClose={() => setIsProfileOpen(false)} />}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop — columna fija, siempre visible. */}
      <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-graphite lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile — botón de hamburguesa flotante + drawer superpuesto. */}
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        aria-label="Abrir menú"
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-graphite/90 text-white/70 backdrop-blur-sm lg:hidden"
      >
        <Menu size={20} />
      </button>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col border-r border-white/10 bg-graphite shadow-2xl">
            <button
              type="button"
              onClick={() => setIsMobileOpen(false)}
              aria-label="Cerrar menú"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:text-white"
            >
              <X size={18} />
            </button>
            <SidebarContent pathname={pathname} onNavigate={() => setIsMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
