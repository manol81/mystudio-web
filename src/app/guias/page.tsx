import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { GUIDES } from "@/lib/guides";
import { PLAY_STORE_URL, SITE_NAME, SITE_URL } from "@/lib/site";

const DESCRIPTION = `Guías de grabación para músicos: latencia, cómo grabar varias pistas con el celular, BPM y tonalidad. Escritas alrededor de ${SITE_NAME}, pero sirven con cualquier programa.`;

export const metadata: Metadata = {
  title: "Guías",
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/guias` },
  openGraph: {
    title: `Guías · ${SITE_NAME}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/guias`,
  },
};

export default function GuidesIndexPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Guías de grabación
        </h1>
        <p className="text-sm leading-relaxed text-white/60 sm:text-base">
          Un problema por guía, explicado desde el principio: por qué pasa y cómo se resuelve.
          Están escritas alrededor de MY STUDIO —los botones que se nombran son los suyos— pero lo
          de fondo vale para cualquier programa de grabación.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link
              href={`/guias/${guide.slug}`}
              className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-graphite p-5 transition-colors hover:border-white/30"
            >
              <h2 className="font-display text-lg font-semibold text-white">{guide.title}</h2>
              <p className="text-sm leading-relaxed text-white/55">{guide.description}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/35">
                <Clock size={12} />
                {guide.minutes} min
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3 border-t border-white/10 pt-8">
        <h2 className="font-display text-lg font-bold text-white">¿Buscabas otra cosa?</h2>
        <p className="text-sm leading-relaxed text-white/55">
          La{" "}
          <Link href="/ayuda" className="text-neon-cyan hover:underline">
            guía de uso
          </Link>{" "}
          explica cada pantalla de la app y de la web, paso a paso. Y el{" "}
          <Link href="/samples" className="text-neon-cyan hover:underline">
            Banco de Sonidos
          </Link>{" "}
          tiene loops y samples gratis, con su BPM y su tonalidad, listos para usar.
        </p>
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit rounded-full border border-neon-cyan/40 px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-colors hover:border-neon-cyan"
        >
          Descargar MY STUDIO en Google Play
        </a>
      </section>
    </main>
  );
}
