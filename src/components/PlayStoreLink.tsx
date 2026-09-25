"use client";

// El enlace a Google Play, con la medición adentro.
//
// Existe porque el click a Play es LA conversión de la web —todo lo
// demás, el SEO, las guías, el Banco de Sonidos, existe para que eso
// pase— y porque las páginas donde vive ese botón (las guías, la ficha
// de un sample, la ayuda) son Server Components, que no pueden
// registrar nada. Este componente es el pedacito de cliente que hace
// falta, y de paso deja el enlace igual en todos lados.
//
// `source` es lo que convierte "23 clicks" en algo accionable: si todos
// salen de la portada y ninguno de las guías, las guías no están
// cumpliendo su función.

import { playStoreClicked, type ClickSource } from "@/lib/analytics";
import { PLAY_STORE_URL } from "@/lib/site";

export function PlayStoreLink({
  source,
  className,
  children,
}: {
  source: ClickSource;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      // Sin preventDefault ni espera: el evento sale por el mismo
      // camino que el resto y la navegación no se retrasa. Si el envío
      // no llega a salir porque la pestaña cambia de foco, se pierde
      // ese evento — preferible a demorar lo que la persona pidió.
      onClick={() => playStoreClicked(source)}
      className={className}
    >
      {children}
    </a>
  );
}
