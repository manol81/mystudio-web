"use client";

// Panel lateral del Banco de Sonidos para el Web Sample Arranger.
//
// Antes era una copia recortada de /samples/page.tsx, con una nota que
// justificaba la duplicación mientras la lógica fuera chica y estable.
// Dejó de serlo: la compatibilidad de tonalidad y el orden por afinidad
// son reglas musicales que las dos pantallas tienen que responder
// igual. Ahora ambas llaman a `applySampleFilters` (sampleFilters.ts) y
// dibujan la pre-escucha con `SamplePreviewControl`; lo único propio de
// cada una es la forma de la tarjeta.
//
// La duplicación ya había cobrado su precio, además: este panel nunca
// tuvo el filtro por TIPO que sí tenía el catálogo, así que desde el
// Arranger no había forma de pedir "solo loops".
//
// Arrastre: HTML5 Drag and Drop nativo — cada tarjeta es draggable=true
// y mete el sample completo (JSON) en dataTransfer con un MIME type
// propio ("application/x-mystudio-sample"), que el timeline del
// Arranger lee en su onDrop. Sin librería de terceros: el navegador ya
// trae todo lo necesario para arrastrar UNA tarjeta a UNA zona.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SAMPLE_INSTRUMENTS, SAMPLE_GENRES, SAMPLE_KEYS, SAMPLE_TYPES } from "@/lib/sampleTaxonomy";
import { warmBufferCache } from "@/lib/sampleBufferCache";
import {
  EMPTY_SAMPLE_FILTERS,
  applySampleFilters,
  hasActiveFilters,
  type SampleFilterState,
} from "@/lib/sampleFilters";
import { SamplePreviewControl } from "@/components/SamplePreviewControl";

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

// MIME type propio para identificar nuestros propios drags (y no, por
// ejemplo, un archivo arrastrado desde el escritorio) al leer
// dataTransfer en el drop.
export const SAMPLE_DRAG_MIME = "application/x-mystudio-sample";

const inputClasses =
  "rounded-lg border border-white/15 bg-onyx-black px-2 py-1.5 text-[10px] text-white placeholder:text-white/30 outline-none focus:border-neon-cyan";

function Toggle({
  active,
  onClick,
  children,
  title,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors duration-200 disabled:opacity-30 ${
        active
          ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
          : "border-white/15 text-white/50 hover:border-white/30"
      }`}
    >
      {children}
    </button>
  );
}

export function SampleBrowserPanel({
  onAddSample,
  projectTempoBpm,
  projectKey,
  matchProject,
  onMatchProjectChange,
  getAudioContext,
  getSyncContextTime,
}: {
  /** Click directo en una tarjeta — alternativa al arrastre (agrega al final de la primera pista, o donde decida el llamador). */
  onAddSample: (sample: ArrangerSample) => void;
  projectTempoBpm: number;
  /** "" = el proyecto todavía no declaró tonalidad. */
  projectKey: string;
  /** Pre-escuchar (y soltar) los samples adaptados al proyecto. Vive en la página porque también decide el pitch inicial del clip. */
  matchProject: boolean;
  onMatchProjectChange: (value: boolean) => void;
  /** El AudioContext del Arranger — el MISMO, o no se puede sincronizar con lo que suena. Función y no valor: en el primer render todavía no existe (ver resolveContext). */
  getAudioContext: () => AudioContext | null;
  getSyncContextTime: () => number | null;
}) {
  const [samples, setSamples] = useState<ArrangerSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<SampleFilterState>({
    ...EMPTY_SAMPLE_FILTERS,
    // En el Arranger el orden útil por defecto es el que contesta "qué
    // me sirve para ESTO", no "qué subieron último".
    sort: "affinity",
  });

  function patch(next: Partial<SampleFilterState>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

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

  const filtered = useMemo(
    () =>
      applySampleFilters(samples, filters, {
        bpm: projectTempoBpm,
        key: projectKey || null,
      }),
    [samples, filters, projectTempoBpm, projectKey],
  );

  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden">
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
        value={filters.search}
        onChange={(e) => patch({ search: e.target.value })}
        placeholder="Buscar por nombre, instrumento o género..."
        className={`${inputClasses} text-xs`}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle
          active={matchProject}
          onClick={() => onMatchProjectChange(!matchProject)}
          title={`Escuchar y soltar los samples adaptados a ${Math.round(projectTempoBpm)} BPM${
            projectKey ? ` y ${projectKey}` : ""
          }. Apagado, suenan tal cual se subieron.`}
        >
          {matchProject ? "Al tempo del proyecto" : "Original"}
        </Toggle>
        <Toggle
          active={filters.compatibleOnly}
          onClick={() => patch({ compatibleOnly: !filters.compatibleOnly })}
          disabled={!projectKey}
          title={
            projectKey
              ? `Solo lo que entra en ${projectKey} (incluye la relativa, las quintas vecinas y todo lo que no tiene tonalidad).`
              : "Elegí la tonalidad del proyecto en la barra de arriba para poder filtrar por compatibilidad."
          }
        >
          Compatibles
        </Toggle>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          value={filters.sort}
          onChange={(e) => patch({ sort: e.target.value as SampleFilterState["sort"] })}
          className={`${inputClasses} min-w-0 flex-1`}
        >
          <option value="affinity">Orden: afinidad</option>
          <option value="recent">Orden: recientes</option>
          <option value="name">Orden: nombre</option>
          <option value="bpmAsc">Orden: BPM ↑</option>
          <option value="bpmDesc">Orden: BPM ↓</option>
        </select>
        <Toggle active={showFilters} onClick={() => setShowFilters(!showFilters)}>
          Filtros{filtersActive ? " •" : ""}
        </Toggle>
      </div>

      {showFilters && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-onyx-black/50 p-2">
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_TYPES.map((opt) => (
              <Toggle
                key={opt}
                active={filters.type === opt}
                onClick={() => patch({ type: filters.type === opt ? null : opt })}
              >
                {opt}
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_INSTRUMENTS.map((opt) => (
              <Toggle
                key={opt}
                active={filters.instrument === opt}
                onClick={() => patch({ instrument: filters.instrument === opt ? null : opt })}
              >
                {opt}
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_GENRES.map((opt) => (
              <Toggle
                key={opt}
                active={filters.genre === opt}
                onClick={() => patch({ genre: filters.genre === opt ? null : opt })}
              >
                {opt}
              </Toggle>
            ))}
          </div>
          <select
            value={filters.key}
            onChange={(e) => patch({ key: e.target.value })}
            className={inputClasses}
          >
            <option value="">Tonalidad: todas</option>
            {SAMPLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-white/40">BPM</span>
            <input
              type="number"
              min={1}
              value={filters.bpmMin}
              onChange={(e) => patch({ bpmMin: e.target.value })}
              placeholder="Min"
              className={`${inputClasses} w-0 min-w-0 flex-1`}
            />
            <span className="shrink-0 text-white/30">–</span>
            <input
              type="number"
              min={1}
              value={filters.bpmMax}
              onChange={(e) => patch({ bpmMax: e.target.value })}
              placeholder="Max"
              className={`${inputClasses} w-0 min-w-0 flex-1`}
            />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={() => setFilters({ ...EMPTY_SAMPLE_FILTERS, sort: filters.sort })}
              className="self-start text-[10px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-white/30">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-white/30">
            {filtersActive
              ? "Ningún sample pasa estos filtros."
              : "Todavía no hay sonidos publicados."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((sample) => (
              <SampleBrowserCard
                key={sample.id}
                sample={sample}
                projectTempoBpm={projectTempoBpm}
                projectKey={projectKey}
                matchProject={matchProject}
                isPlaying={playingId === sample.id}
                onRequestPlay={() => setPlayingId(sample.id)}
                onStopped={() => setPlayingId((cur) => (cur === sample.id ? null : cur))}
                onAddSample={onAddSample}
                getAudioContext={getAudioContext}
                getSyncContextTime={getSyncContextTime}
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
  projectTempoBpm,
  projectKey,
  matchProject,
  isPlaying,
  onRequestPlay,
  onStopped,
  onAddSample,
  getAudioContext,
  getSyncContextTime,
}: {
  sample: ArrangerSample;
  projectTempoBpm: number;
  projectKey: string;
  matchProject: boolean;
  isPlaying: boolean;
  onRequestPlay: () => void;
  onStopped: () => void;
  onAddSample: (sample: ArrangerSample) => void;
  getAudioContext: () => AudioContext | null;
  getSyncContextTime: () => number | null;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SAMPLE_DRAG_MIME, JSON.stringify(sample));
        e.dataTransfer.effectAllowed = "copy";
        // Apenas arranca el arrastre se dispara la descarga+decode en
        // segundo plano: para cuando el usuario suelta el clip, en
        // general ya está listo. (Si la tarjeta estuvo visible, la
        // forma de onda ya lo bajó y esto no hace nada.)
        warmBufferCache(sample.id, sample.audioPath);
      }}
      onClick={() => onAddSample(sample)}
      className="cursor-grab rounded-lg border border-white/10 bg-graphite p-2.5 text-left transition-colors duration-200 hover:border-neon-cyan/40 active:cursor-grabbing"
    >
      <p className="truncate text-xs font-semibold text-white">{sample.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-white/40">
        {[sample.instrument, sample.type].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
        <SamplePreviewControl
          sample={{
            sampleId: sample.id,
            name: sample.name,
            audioPath: sample.audioPath,
            sampleType: sample.type,
            originalBpm: sample.bpm,
            sampleKey: sample.key,
          }}
          projectBpm={projectTempoBpm}
          projectKey={projectKey || null}
          matchProject={matchProject}
          isPlaying={isPlaying}
          onRequestPlay={onRequestPlay}
          onStopped={onStopped}
          getAudioContext={getAudioContext}
          getSyncContextTime={getSyncContextTime}
        />
      </div>
    </div>
  );
}
