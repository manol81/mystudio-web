// /ayuda — la guía de MY STUDIO, app y web en un solo lugar.
//
// Server Component a propósito: no hay nada interactivo, carga sin
// JavaScript, y así Google la indexa entera (la app enlaza acá desde su
// pantalla de Ayuda, y la ficha de Play puede hacerlo también). El
// contenido vive en helpContent.ts; esta página solo lo dibuja.
//
// Va organizada por TAREA y no por pantalla, y cada sección dice dónde
// se hace: varias cosas cruzan las dos puntas (colaborar, sincronizar) y
// ese recorrido era justo lo que nadie explicaba.

import type { Metadata } from "next";
import Link from "next/link";
import { HELP_SECTIONS, parseHelpText, type HelpWhere } from "@/lib/helpContent";
import { PLAY_STORE_URL, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Ayuda",
  description: `Qué podés hacer con ${SITE_NAME}: grabar, mezclar, exportar, sincronizar con la web, el Banco de Sonidos, el Arranger y cómo colaborar con otros músicos.`,
  alternates: { canonical: `${SITE_URL}/ayuda` },
};

function RichText({ text }: { text: string }) {
  return (
    <>
      {parseHelpText(text).map((span, i) =>
        span.bold ? (
          <strong key={i} className="font-semibold text-white/90">
            {span.text}
          </strong>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}

const WHERE_STYLE: Record<HelpWhere, string> = {
  App: "bg-emerald-400/10 text-emerald-300",
  Web: "bg-violet-400/10 text-violet-300",
  "App + Web": "bg-neon-cyan/10 text-neon-cyan",
};

function WhereChip({ where }: { where: HelpWhere }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${WHERE_STYLE[where]}`}>
      {where}
    </span>
  );
}

export default function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <p className="font-display text-xs uppercase tracking-[0.2em] text-white/40">{SITE_NAME}</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-white">
        Cómo <span className="text-neon-cyan">funciona</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-white/60">
        Todo lo que podés hacer, en corto. Cada parte dice si se hace en la{" "}
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-cyan hover:underline"
        >
          app Android
        </a>
        , acá en la web, o en las dos.
      </p>

      <nav aria-label="Secciones" className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {HELP_SECTIONS.map((section, i) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-neon-cyan"
              >
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-white/30">
                  {i + 1}
                </span>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {HELP_SECTIONS.map((section, i) => (
        // scroll-mt: que el título no quede tapado por el botón flotante
        // del menú en el celular al llegar por un ancla.
        <section key={section.id} id={section.id} className="mt-10 scroll-mt-20">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-white">
              <span className="mr-2 text-white/30">{i + 1}.</span>
              {section.title}
            </h2>
            <WhereChip where={section.where} />
          </div>
          {section.intro && (
            <p className="mt-2 text-sm text-white/60">
              <RichText text={section.intro} />
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-2.5">
            {section.items.map((item, j) =>
              typeof item === "string" ? (
                <li key={j} className="flex gap-2.5 text-sm leading-relaxed text-white/60">
                  <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-neon-cyan/60" />
                  <span>
                    <RichText text={item} />
                  </span>
                </li>
              ) : (
                <li key={j}>
                  <ol className="ml-4 flex list-decimal flex-col gap-1.5 pl-4 text-sm leading-relaxed text-white/60 marker:text-neon-cyan/70">
                    {item.steps.map((step, k) => (
                      <li key={k}>
                        <RichText text={step} />
                      </li>
                    ))}
                  </ol>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      <p className="mt-12 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/40">
        ¿Algo no funciona como dice acá, o te falta algo? Escribinos a{" "}
        <a href="mailto:manolocenter@gmail.com" className="text-white/60 hover:underline">
          manolocenter@gmail.com
        </a>
        . Y si querés borrar tu cuenta, está en{" "}
        <Link href="/cuenta/eliminar" className="text-white/60 hover:underline">
          Eliminar cuenta
        </Link>
        .
      </p>
    </div>
  );
}
