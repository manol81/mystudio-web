"use client";

// Encabezado de presentación para VISITANTES (sin sesión) en la raíz —
// Fase 0 del informe "Radiografía MY STUDIO": hasta ahora la web no
// tenía ninguna página que explicara qué es el producto; quien llegaba
// sin cuenta veía un botón de login y nada más. Deliberadamente corto
// (no es una landing de marketing con scroll infinito): qué es, para
// quién, dos botones, y debajo el feed real ya sonando.

import { Mic2, Share2, Cloud } from "lucide-react";
import { PLAY_STORE_URL } from "@/lib/site";

const VALUE_PROPS = [
  {
    icon: Mic2,
    title: "Grabá con instrumentos reales",
    text: "Motor de audio nativo de baja latencia, calibración y punch-in. Pensado para guitarra, voz, bajo y percusión.",
  },
  {
    icon: Cloud,
    title: "Tus proyectos, en el celular y en la web",
    text: "Sincronizá desde la app y seguí editando en el Arranger web. Banco de sonidos con ajuste de tempo.",
  },
  {
    icon: Share2,
    title: "Feedback en el segundo exacto",
    text: "Publicá un arreglo y recibí comentarios anclados al momento preciso de la canción.",
  },
] as const;

export function VisitorHero({ onCreateAccount }: { onCreateAccount: () => void }) {
  return (
    <section className="flex flex-col gap-8 rounded-3xl border border-white/10 bg-graphite p-8 sm:p-10">
      <div className="flex flex-col gap-4">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-neon-cyan">
          Estudio multipista para músicos, en español
        </p>
        <h2 className="max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          Grabá, mezclá y compartí tu música desde el bolsillo.
        </h2>
        <p className="max-w-xl text-sm text-white/60 sm:text-base">
          MY STUDIO es una app Android gratuita para grabar varias pistas con tu instrumento de
          verdad, mezclarlas y publicarlas en una comunidad de músicos que escucha y comenta.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2.5 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
        >
          Descargar en Google Play
        </a>
        <button
          type="button"
          onClick={onCreateAccount}
          className="rounded-full border border-white/20 px-6 py-2.5 font-display text-sm font-semibold text-white/80 transition-colors duration-200 hover:border-white/50 hover:text-white"
        >
          Crear cuenta gratis
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex flex-col gap-2 rounded-2xl bg-onyx-black/60 p-4">
            <Icon size={20} className="text-neon-cyan" />
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs leading-relaxed text-white/50">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
