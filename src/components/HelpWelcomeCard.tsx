"use client";

// Tarjeta de bienvenida hacia la guía, para quien YA tiene sesión.
//
// Los visitantes tienen VisitorHero, que ya presenta el producto y
// enlaza a /ayuda. Pero quien crea la cuenta desde la app y entra a la
// web por primera vez no ve ese encabezado (es solo para quien no tiene
// sesión) y cae directo en el feed, sin ninguna pista de que la web y la
// app se reparten las funciones.
//
// Se muestra hasta que se cierra, UNA vez por navegador. La marca lleva
// versión: si la guía crece con algo que valga la pena anunciar, subir a
// v2 la vuelve a mostrar a todos. Es una comodidad, no un dato: si
// localStorage no está disponible (modo privado, bloqueado) la tarjeta
// aparece, y cerrarla igual la oculta durante la visita.

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";

const DISMISSED_KEY = "mystudio_help_welcome_dismissed_v1";

export function HelpWelcomeCard() {
  // Arranca oculta: en el servidor no hay localStorage, y mostrarla para
  // después esconderla sería un parpadeo en cada carga para todo el que
  // ya la cerró.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Sin almacenamiento: se muestra.
    }
    if (!dismissed) queueMicrotask(() => setVisible(true));
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Se oculta igual por esta visita.
    }
  }

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/[0.06] p-4">
      <BookOpen size={20} className="mt-0.5 shrink-0 text-neon-cyan" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">¿Primera vez por acá?</p>
        <p className="mt-1 text-xs leading-relaxed text-white/60">
          La app y la web se reparten el trabajo: en el teléfono grabás y mezclás; acá publicás,
          armás en el Arranger y encontrás con quién tocar.
        </p>
        <Link
          href="/ayuda"
          onClick={dismiss}
          className="mt-2 inline-block text-xs font-semibold text-neon-cyan hover:underline"
        >
          Mirá la guía rápida →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar"
        className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
