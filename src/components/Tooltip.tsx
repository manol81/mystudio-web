"use client";

// Tooltip liviano y accesible — a propósito NO se apoya en el
// `title` nativo del navegador para los mensajes instructivos: tiene
// un delay largo y variable entre navegadores, no se puede estilar
// (rompe la identidad Midnight Studio), y sobre todo no funciona en
// touch/mobile (no hay "hover" en un celular) — justo el caso de uso
// real de este proyecto, que se usa activamente desde el teléfono vía
// Remote Control.
//
// Se muestra con hover Y foco de teclado (accesibilidad — quien
// navega con Tab también necesita ver la ayuda), y con un TAP en
// touch (toggle) como alternativa al hover que no existe ahí.

import { useState, type ReactNode } from "react";

export function Tooltip({
  text,
  children,
  side = "bottom",
  wrapperClassName = "relative inline-flex",
}: {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Por defecto envuelve el hijo sin forzar su ancho (inline-flex,
   * pensado para botones/íconos sueltos). Pasar "relative flex w-full"
   * (o similar) cuando el hijo es un elemento que ya ocupa todo el
   * ancho de su contenedor (ej. un link de navegación en una lista
   * vertical) — si no, el wrapper por defecto lo encogería al ancho
   * de su contenido. */
  wrapperClassName?: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  const sideClasses: Record<typeof side, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className={wrapperClassName}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      onClick={() => setIsVisible((prev) => !prev)}
    >
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[200px] rounded-lg border border-white/10 bg-onyx-black px-2.5 py-1.5 text-center text-[11px] leading-snug text-white/80 shadow-xl transition-opacity duration-150 ${sideClasses[side]} ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
