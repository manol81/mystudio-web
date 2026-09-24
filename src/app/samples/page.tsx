import type { Metadata } from "next";
import Link from "next/link";
import { SamplesCatalog } from "@/components/SamplesCatalog";
import { fetchSamplesFromServer, type PublicSample } from "@/lib/serverSamples";
import { keyLabel } from "@/lib/sampleAffinity";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// El catálogo se sigue armando en el navegador (filtros, pre-escucha
// con time-stretch y arrastre al Arranger son todos client), pero la
// PÁGINA pasó a ser un Server Component por dos motivos que no se
// podían resolver desde un "use client":
//   1. metadata propia — antes heredaba el título genérico del sitio;
//   2. un índice renderizado en el servidor, con un link real a la
//      ficha de cada sonido. Sin eso, el catálogo era una pantalla que
//      un buscador veía vacía y las fichas quedaban alcanzables solo
//      desde el sitemap, sin una sola ruta interna que las enlazara.
export const revalidate = 3600;

const DESCRIPTION = `Loops y samples gratis con BPM y tonalidad declarados, listos para usar en el Arranger de ${SITE_NAME}: al soltarlos se ajustan solos al tempo y a la tonalidad de tu canción.`;

export const metadata: Metadata = {
  title: "Banco de Sonidos",
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/samples` },
  openGraph: {
    title: `Banco de Sonidos · ${SITE_NAME}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/samples`,
  },
};

export default async function SamplesPage() {
  const samples = await fetchSamplesFromServer().catch(() => [] as PublicSample[]);

  return (
    <>
      <SamplesCatalog />
      <SampleIndex samples={samples} />
    </>
  );
}

/// El índice de texto, al pie del catálogo. Para una persona es la
/// forma rápida de ver todo lo que hay de un vistazo; para un buscador
/// es el camino a cada ficha.
function SampleIndex({ samples }: { samples: PublicSample[] }) {
  if (samples.length === 0) return null;

  const porInstrumento = new Map<string, PublicSample[]>();
  for (const sample of samples) {
    const clave = sample.instrument || "Otros";
    const lista = porInstrumento.get(clave) ?? [];
    lista.push(sample);
    porInstrumento.set(clave, lista);
  }

  return (
    <section className="mx-auto w-full max-w-5xl border-t border-white/10 px-6 py-10">
      <h2 className="font-display text-lg font-bold text-white">
        Todos los sonidos del banco ({samples.length})
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-white/45">{DESCRIPTION}</p>

      <div className="mt-6 flex flex-col gap-6">
        {[...porInstrumento.entries()].map(([instrumento, lista]) => (
          <div key={instrumento} className="flex flex-col gap-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-white/40">
              {instrumento}
            </h3>
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {lista.map((sample) => (
                <li key={sample.id}>
                  <Link
                    href={`/samples/${sample.id}`}
                    className="text-xs text-white/60 transition-colors hover:text-neon-cyan"
                  >
                    {sample.name}
                    <span className="text-white/30">
                      {sample.bpm > 0 ? ` · ${Math.round(sample.bpm)} BPM` : ""}
                      {sample.key ? ` · ${keyLabel(sample.key)}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
