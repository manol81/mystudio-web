// src/components/AdRail.tsx
//
// Riel lateral derecho — el espacio reservado para publicidad/banners
// (ver CLAUDE.md sección 9: decidido en su momento, nunca implementado).
//
// OJO — nota importante para cuando se conecte un proveedor real:
// AdMob es para apps MÓVILES (Android/iOS), no sirve acá. El producto
// de Google para publicidad en WEB es Google AdSense — una integración
// distinta (un script + unidades <ins class="adsbygoogle">). Mientras
// no haya una cuenta de AdSense (o el proveedor que se elija) armada,
// este espacio muestra auto-promoción propia en vez de un cartel vacío
// de "Publicidad" — se ve más prolijo mientras tanto. El día que se
// conecte un proveedor real, PROMO_CARDS es lo que se reemplaza por el
// snippet correspondiente, en esta misma columna.
//
// Responsive: oculto por debajo de xl (1280px) — reservar 288px fijos
// en una pantalla más chica dejaría muy poco espacio real para el
// contenido principal. Nunca se muestra en el Arranger (ver
// AppShell.tsx), que necesita todo el ancho para el editor multipista.

import Link from "next/link";
import { Globe, Piano, Share2 } from "lucide-react";

const PROMO_CARDS = [
  {
    icon: Piano,
    title: "Descubrí el Banco de Sonidos",
    description: "Loops y one-shots listos para tu próxima canción.",
    href: "/samples",
  },
  {
    icon: Globe,
    title: "Explorá la Comunidad",
    description: "Escuchá lo que están armando otros usuarios.",
    href: "/",
  },
  {
    icon: Share2,
    title: "Compartí tu música",
    description: "Publicá un proyecto y sumate al feed público.",
    href: "/projects",
  },
] as const;

export function AdRail() {
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-white/10 bg-graphite px-5 py-6 xl:block">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        Espacio publicitario
      </p>
      <div className="flex flex-col gap-3">
        {PROMO_CARDS.map(({ icon: Icon, title, description, href }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-2 rounded-xl border border-white/10 bg-onyx-black p-4 transition-colors duration-200 hover:border-neon-cyan/30"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan">
              <Icon size={16} />
            </span>
            <p className="font-display text-xs font-semibold text-white">{title}</p>
            <p className="text-[11px] text-white/50">{description}</p>
          </Link>
        ))}
      </div>

      {/* Acá va el snippet real de AdSense (o el proveedor elegido)
          cuando exista la cuenta — este comentario marca dónde
          insertarlo. Sin cargar ningún script de terceros todavía. */}
    </aside>
  );
}
