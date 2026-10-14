"use client";

// Pestaña angosta que queda a la izquierda cuando un panel lateral está
// plegado (2026-10-14): el menú y el Banco de Sonidos del Arranger. Se
// ve siempre, con su nombre en vertical, y al tocarla trae el panel de
// vuelta. Pedido: poder sacar los paneles de la izquierda para ganar
// ancho de trabajo, sin perder la forma de volver a cada uno.

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

export function SideTab({
  icon: Icon,
  label,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Mostrar ${label.toLowerCase()}`}
      aria-label={`Mostrar ${label.toLowerCase()}`}
      className="flex w-9 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-graphite py-4 text-white/55 transition-colors hover:bg-white/5 hover:text-neon-cyan"
    >
      <Icon size={18} strokeWidth={1.75} />
      <span
        className="font-display text-[11px] font-semibold tracking-wider"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Si un panel está plegado, recordado en este navegador. Arranca
 * desplegado y lee lo guardado DESPUÉS de montar: leer localStorage en
 * el primer render haría que el HTML del servidor y el del navegador no
 * coincidan.
 */
export function useCollapsedPanel(storageKey: string): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // En una microtarea, como el resto de las restauraciones desde el
      // navegador (ver arranger/page.tsx): no es un setState en cascada.
      if (window.localStorage.getItem(storageKey) === "1") queueMicrotask(() => setCollapsed(true));
    } catch {
      // modo privado o almacenamiento bloqueado: queda desplegado
    }
  }, [storageKey]);
  const set = (value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem(storageKey, value ? "1" : "0");
    } catch {}
  };
  return [collapsed, set];
}
