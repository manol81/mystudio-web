"use client";

// Panel lateral del Banco de Sonidos para el Web Sample Arranger —
// versión compacta y ARRASTRABLE de /samples/page.tsx. A propósito NO
// comparte código con esa página (que ya está en producción y
// funcionando): duplicar esta lógica, chica y estable, es más seguro
// que forzar una abstracción compartida bajo presión de tiempo. Sí
// reusa sampleTaxonomy.ts (las opciones de filtro) y SamplePlayer
// (el preview) para no divergir en esas dos cosas puntuales.
//
// Arrastre: HTML5 Drag and Drop nativo — cada tarjeta es draggable=true
// y mete el sample completo (JSON) en dataTransfer con un MIME type
// propio ("application/x-mystudio-sample"), que el timeline del
// Arranger lee en su onDrop. Sin librería de terceros: el navegador ya
// trae todo lo necesario para este caso de uso simple (arrastrar UNA
// tarjeta a UNA zona de destino).

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { SamplePlayer } from "@/components/SamplePlayer";
import { SAMPLE_INSTRUMENTS, SAMPLE_GENRES } from "@/lib/sampleTaxonomy";
import { warmBufferCache } from "@/lib/sampleBufferCache";

export interface ArrangerSample {
  id: string;
  name: string;
  type: string;
  instrument: string;
  genre: string;
  bpm: number;
  key: string;
  audioPath: string;
  sizeBytes: number;
}

// MIME type propio para identificar nuestros propios drags (y no,
// por ejemplo, un archivo arrastrado desde el escritorio) al leer
// dataTransfer en el drop.
export const SAMPLE_DRAG_MIME = "application/x-mystudio-sample";

export function SampleBrowserPanel({
  onAddSample,
}: {
  /** Click directo en una tarjeta — alternativa al arrastre (agrega al final de la primera pista, o donde decida el llamador). */
  onAddSample: (sample: ArrangerSample) => void;
}) {
  const [samples, setSamples] = useState<ArrangerSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "samples"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setSamples(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              name: (data.name as string) ?? "",
              type: (data.type as string) ?? "",
              instrument: (data.instrument as string) ?? "",
              genre: (data.genre as string) ?? "",
              bpm: (data.bpm as number) ?? 0,
              key: (data.key as string) ?? "",
              audioPath: (data.audioPath as string) ?? "",
              sizeBytes: (data.sizeBytes as number) ?? 0,
            };
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, []);

  const filtered = useMemo(() => {
    let result = samples;
    const q = searchQuery.trim().toLowerCase();
    if (q) result = result.filter((s) => s.name.toLowerCase().includes(q));
    if (selectedInstrument) {
      result = result.filter((s) => s.instrument === selectedInstrument);
    }
    if (selectedGenre) result = result.filter((s) => s.genre === selectedGenre);
    return result;
  }, [samples, searchQuery, selectedInstrument, selectedGenre]);

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden">
      <div>
        <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-white/50">
          Banco de Sonidos
        </h2>
        <p className="mt-1 text-[11px] text-white/30">
          Arrastrá un sample a una pista, o tocalo para agregarlo.
        </p>
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Buscar..."
        className="rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-neon-cyan"
      />

      <div className="flex flex-wrap gap-1.5">
        {SAMPLE_INSTRUMENTS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() =>
              setSelectedInstrument(selectedInstrument === opt ? null : opt)
            }
            className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-200 ${
              selectedInstrument === opt
                ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                : "border-white/15 text-white/50 hover:border-white/30"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SAMPLE_GENRES.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setSelectedGenre(selectedGenre === opt ? null : opt)}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-200 ${
              selectedGenre === opt
                ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                : "border-white/15 text-white/50 hover:border-white/30"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-white/30">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-white/30">Sin resultados.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((sample) => (
              <SampleBrowserCard
                key={sample.id}
                sample={sample}
                isPlaying={playingId === sample.id}
                onRequestPlay={() => setPlayingId(sample.id)}
                onAddSample={onAddSample}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SampleBrowserCard({
  sample,
  isPlaying,
  onRequestPlay,
  onAddSample,
}: {
  sample: ArrangerSample;
  isPlaying: boolean;
  onRequestPlay: () => void;
  onAddSample: (sample: ArrangerSample) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDownloadURL(ref(storage, sample.audioPath))
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sample.audioPath]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SAMPLE_DRAG_MIME, JSON.stringify(sample));
        e.dataTransfer.effectAllowed = "copy";
        // Caché global (Paso 1 de la optimización de rendimiento): apenas
        // arranca el arrastre, ya se dispara la descarga+decode en
        // segundo plano — para cuando el usuario suelta el clip en una
        // pista, en general ya está listo o casi.
        warmBufferCache(sample.id, sample.audioPath);
      }}
      onClick={() => onAddSample(sample)}
      className="cursor-grab rounded-lg border border-white/10 bg-graphite p-2.5 text-left transition-colors duration-200 hover:border-neon-cyan/40 active:cursor-grabbing"
    >
      <p className="truncate text-xs font-semibold text-white">{sample.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-white/40">
        {[sample.instrument, `${Math.round(sample.bpm)} BPM`, sample.key]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {url && (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <SamplePlayer
            src={url}
            isActive={isPlaying}
            onRequestPlay={() => {
              // Misma idea: la pre-escucha es la otra señal fuerte de
              // que este sample se va a usar — se aprovecha para
              // calentar la misma caché global.
              warmBufferCache(sample.id, sample.audioPath);
              onRequestPlay();
            }}
          />
        </div>
      )}
    </div>
  );
}
