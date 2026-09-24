import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { GUIDES, guideBySlug, relatedGuides, type GuideBlock } from "@/lib/guides";
import { parseHelpText } from "@/lib/helpContent";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Una guía. Server Component sin nada interactivo: carga sin
// JavaScript y se indexa entera, igual que /ayuda.

interface Props {
  params: Promise<{ slug: string }>;
}

/// El contenido es fijo y está en el repo, así que las páginas se
/// generan en el build: no hay motivo para resolverlas por pedido.
export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return { title: "Guía no encontrada", robots: { index: false, follow: true } };

  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `${SITE_URL}/guias/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
      url: `${SITE_URL}/guias/${guide.slug}`,
      publishedTime: guide.published,
      modifiedTime: guide.updated ?? guide.published,
    },
  };
}

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

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2
          id={block.id}
          className="mt-4 scroll-mt-8 font-display text-xl font-bold text-white sm:text-2xl"
        >
          {block.text}
        </h2>
      );
    case "p":
      return (
        <p className="text-sm leading-relaxed text-white/65 sm:text-base">
          <RichText text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-white/65">
          {block.items.map((item, i) => (
            <li key={i}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-white/65">
          {block.items.map((item, i) => (
            <li key={i}>
              <RichText text={item} />
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <p className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4 text-sm leading-relaxed text-white/70">
          <RichText text={block.text} />
        </p>
      );
  }
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const related = relatedGuides(guide);
  const headings = guide.blocks.filter((b) => b.kind === "h2");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.updated ?? guide.published,
    inLanguage: "es",
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: { "@type": "Organization", name: SITE_NAME },
    mainEntityOfPage: `${SITE_URL}/guias/${guide.slug}`,
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href="/guias"
        className="inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
      >
        <ArrowLeft size={14} />
        Guías
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
          {guide.title}
        </h1>
        <p className="text-sm leading-relaxed text-white/55 sm:text-base">{guide.description}</p>
        <p className="flex items-center gap-1.5 text-xs text-white/35">
          <Clock size={13} />
          {guide.minutes} min de lectura
        </p>
      </header>

      {/* Índice de la nota: en una guía de varias secciones sirve para
          ir al punto, y le da a cada sección un enlace propio que se
          puede compartir. */}
      {headings.length > 2 && (
        <nav className="rounded-2xl border border-white/10 bg-graphite p-4">
          <p className="font-display text-xs font-semibold uppercase tracking-wider text-white/35">
            En esta guía
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="text-xs text-white/60 hover:text-neon-cyan">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <article className="flex flex-col gap-4">
        {guide.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </article>

      <footer className="flex flex-col gap-6 border-t border-white/10 pt-8">
        <p className="text-sm leading-relaxed text-white/55">
          ¿Buscabas cómo hacer algo puntual? La{" "}
          <Link href="/ayuda" className="text-neon-cyan hover:underline">
            guía de uso
          </Link>{" "}
          tiene el paso a paso de cada pantalla, en la app y en la web.
        </p>

        {related.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-white">Seguí leyendo</h2>
            <ul className="flex flex-col gap-2">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/guias/${other.slug}`}
                    className="flex flex-col gap-0.5 rounded-xl border border-white/10 p-3 transition-colors hover:border-white/30"
                  >
                    <span className="text-sm text-white/85">{other.title}</span>
                    <span className="text-xs leading-relaxed text-white/45">
                      {other.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </footer>
    </main>
  );
}
