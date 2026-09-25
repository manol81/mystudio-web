import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import {
  fetchSampleFromServer,
  fetchSamplesFromServer,
  sampleAudioUrl,
  type PublicSample,
} from "@/lib/serverSamples";
import { camelotLabel, keyLabel } from "@/lib/sampleAffinity";
import { PlayStoreLink } from "@/components/PlayStoreLink";
import { SampleAudio } from "@/components/SampleAudio";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Ficha pública de un sample del Banco de Sonidos.
//
// Por qué existe (plan de SEO, 2026-09-24): el catálogo entero vivía en
// UNA pantalla que se arma con JavaScript, así que para un buscador el
// Banco de Sonidos no existía. Cada sample, en cambio, es exactamente
// lo que alguien escribe en Google — "loop de batería 120 bpm en A
// minor" — y son páginas que se multiplican solas: cada sample que
// subas al panel de admin aparece acá y en el sitemap sin tocar código.
//
// Se renderiza en el SERVIDOR con la API REST (ver serverSamples.ts).
// Las reglas ya permitían leer /samples y los audios sin sesión, así
// que esto no abre nada nuevo: solo lo vuelve legible.

export const revalidate = 3600;

interface Props {
  params: Promise<{ id: string }>;
}

/// Las partes que describen al sample, en el orden en que una persona
/// las diría. Se usa para el título, la descripción y la ficha visible,
/// para que las tres digan lo mismo.
function descriptorOf(sample: PublicSample): string[] {
  const parts: string[] = [];
  if (sample.instrument) parts.push(sample.instrument);
  if (sample.type) parts.push(sample.type);
  if (sample.bpm > 0) parts.push(`${Math.round(sample.bpm)} BPM`);
  const label = keyLabel(sample.key);
  if (label) parts.push(label);
  return parts;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sample = await fetchSampleFromServer(id).catch(() => null);
  if (!sample) return { title: "Sample no encontrado", robots: { index: false, follow: true } };

  const descriptor = descriptorOf(sample);
  const title = descriptor.length
    ? `${sample.name} — ${descriptor.join(" · ")}`
    : sample.name;
  const description = `${sample.name}: sample gratis${
    descriptor.length ? ` (${descriptor.join(", ")})` : ""
  } del Banco de Sonidos de ${SITE_NAME}. Escuchalo y usalo en tus canciones, con el tempo y la tonalidad ajustados solos a los de tu proyecto.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/samples/${sample.id}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/samples/${sample.id}`,
      type: "music.song",
    },
  };
}

/// Sin `generateStaticParams`: el catálogo cambia cuando un admin sube
/// un sample, y `revalidate` ya deja las fichas cacheadas una hora. Con
/// params estáticos, un sample nuevo no tendría página hasta el próximo
/// deploy.
export default async function SamplePage({ params }: Props) {
  const { id } = await params;
  const sample = await fetchSampleFromServer(id).catch(() => null);
  if (!sample) notFound();

  const descriptor = descriptorOf(sample);
  // ⚠️ camelotLabel, NO camelotFor: el segundo devuelve el código
  // PARTIDO en {number, letter}, y meterlo en un template string
  // imprime "[object Object]" sin que TypeScript diga nada. Apareció
  // mirando la página renderizada, no en el chequeo de tipos.
  // Las dos devuelven null cuando la tonalidad no se puede leer
  // (percusión, vacío, "N/A"), así que el dato solo sale si es real.
  const camelot = camelotLabel(sample.key);
  const keyText = keyLabel(sample.key);
  const audioUrl = sample.audioPath ? sampleAudioUrl(sample.audioPath) : null;

  // Datos estructurados: le dicen al buscador que esto es una pieza de
  // audio y no un artículo, con su tempo y su tonalidad en los campos
  // que el esquema ya define para música.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AudioObject",
    name: sample.name,
    description: descriptor.join(", "),
    url: `${SITE_URL}/samples/${sample.id}`,
    ...(audioUrl ? { contentUrl: audioUrl } : {}),
    inLanguage: "es",
    isAccessibleForFree: true,
    ...(sample.genre ? { genre: sample.genre } : {}),
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href="/samples"
        className="inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
      >
        <ArrowLeft size={14} />
        Banco de Sonidos
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {sample.name}
        </h1>
        {descriptor.length > 0 && (
          <p className="flex flex-wrap gap-2">
            {descriptor.map((part) => (
              <span
                key={part}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70"
              >
                {part}
              </span>
            ))}
          </p>
        )}
      </header>

      {audioUrl && (
        <section className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-graphite p-5">
          <h2 className="font-display text-sm font-semibold text-white">Escuchar</h2>
          {/* <audio> nativo a propósito: la pre-escucha con
              time-stretch del Arranger necesita el contexto del
              proyecto (tempo y tonalidad), y acá no hay proyecto. Esto
              suena a su velocidad original, que es lo honesto para una
              ficha. Va envuelto para poder medir la escucha (la página
              es un Server Component). */}
          <SampleAudio sampleId={sample.id} src={audioUrl} />
          <a
            href={audioUrl}
            download
            className="inline-flex w-fit items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
          >
            <Download size={13} />
            Descargar el archivo
          </a>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold text-white">Sobre este sonido</h2>
        <p className="text-sm leading-relaxed text-white/60">
          <strong className="font-semibold text-white/80">{sample.name}</strong> es un sample
          gratuito del Banco de Sonidos de {SITE_NAME}
          {sample.instrument ? `, de la categoría ${sample.instrument}` : ""}
          {sample.genre ? ` y estilo ${sample.genre}` : ""}.{" "}
          {sample.bpm > 0
            ? `Está grabado a ${Math.round(sample.bpm)} BPM`
            : "No tiene un tempo fijo, así que entra en cualquier proyecto sin estirarse"}
          {keyText ? ` y en ${keyText}${camelot ? ` (Camelot ${camelot})` : ""}.` : "."}
        </p>
        <p className="text-sm leading-relaxed text-white/60">
          Al soltarlo en el Arranger web, MY STUDIO le ajusta el tempo al de tu canción y —si hace
          falta— lo transpone a una tonalidad que entre con la tuya, con el desplazamiento más
          chico posible. O sea que no tenés que calcular nada: lo escuchás ya adaptado a tu tema
          antes de decidir si lo usás.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-graphite p-5">
        <h2 className="font-display text-sm font-semibold text-white">Usalo en tu canción</h2>
        <p className="text-xs leading-relaxed text-white/55">
          Abrí el Arranger en el navegador y arrastralo a la línea de tiempo, o grabá tus propias
          pistas encima desde la app Android.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/arranger"
            className="rounded-full border border-neon-cyan/40 px-4 py-2 font-display text-xs font-semibold text-neon-cyan transition-colors hover:border-neon-cyan"
          >
            Abrir el Arranger
          </Link>
          <PlayStoreLink
            source="sample"
            className="rounded-full border border-white/20 px-4 py-2 font-display text-xs font-semibold text-white/75 transition-colors hover:border-white/50 hover:text-white"
          >
            Descargar la app
          </PlayStoreLink>
        </div>
      </section>

      <RelatedSamples current={sample} />
    </main>
  );
}

/// Otros sonidos del mismo instrumento. Son links internos reales: sin
/// esto cada ficha sería una hoja suelta, alcanzable solo desde el
/// sitemap, y quien llega de una búsqueda no tendría a dónde seguir.
async function RelatedSamples({ current }: { current: PublicSample }) {
  const all = await fetchSamplesFromServer().catch(() => [] as PublicSample[]);
  const related = all
    .filter((s) => s.id !== current.id)
    .filter((s) => !current.instrument || s.instrument === current.instrument)
    .slice(0, 8);
  if (related.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-white/10 pt-8">
      <h2 className="font-display text-lg font-bold text-white">
        Más sonidos {current.instrument ? `de ${current.instrument}` : "del banco"}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {related.map((s) => (
          <li key={s.id}>
            <Link
              href={`/samples/${s.id}`}
              className="flex flex-col gap-0.5 rounded-xl border border-white/10 p-3 transition-colors hover:border-white/30"
            >
              <span className="text-sm text-white/85">{s.name}</span>
              <span className="text-xs text-white/40">
                {descriptorOf(s).join(" · ") || "Sample"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
