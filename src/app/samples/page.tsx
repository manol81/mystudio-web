"use client";

// Banco de Sonidos — catálogo público (para cuentas logueadas, ver
// firestore.rules: es una feature de cuenta, igual que la sincronía de
// proyectos, no algo abierto a invitados) de samples/loops curados por
// el equipo. Lee /samples en tiempo real, cada admin que sube un sample
// nuevo desde /admin/upload-sample aparece acá sin refrescar.
//
// A propósito NO incluye botón de descarga en esta primera versión:
// gatear FREE/PRO por sample individual necesita una Cloud Function que
// devuelva una signed URL corta validando el tier del usuario
// server-side (dejarlo abierto por Storage rules solamente sería
// bypasseable) — está documentado como pendiente en storage.rules, no
// es parte de este catálogo todavía. Por ahora es solo preview.
//
// Búsqueda/filtro/orden — TODO client-side (Fase "librería premium"):
// se trae la colección /samples COMPLETA una sola vez (onSnapshot,
// sigue en vivo) y el resto vive en useMemo, sin volver a tocar
// Firestore por cada tecla o cada click de filtro. Con el tamaño de
// catálogo esperado (cientos, no cientos de miles) esto es
// instantáneo y muchísimo más simple que reconstruir queries
// compuestas de Firestore por cada combinación de filtros.

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { LoginModal } from "@/components/LoginModal";
import { SamplePreviewControl } from "@/components/SamplePreviewControl";
import {
  SAMPLE_TYPES,
  SAMPLE_INSTRUMENTS,
  SAMPLE_GENRES,
  SAMPLE_KEYS,
} from "@/lib/sampleTaxonomy";
import { queueSamplesForArranger } from "@/lib/pendingArrangerSamples";
import {
  EMPTY_SAMPLE_FILTERS,
  applySampleFilters,
  hasActiveFilters as filtersAreActive,
  type SampleFilterState,
} from "@/lib/sampleFilters";
import type { ArrangerSample } from "@/components/SampleBrowserPanel";

interface Sample {
  id: string;
  name: string;
  type: string;
  instrument: string;
  genre: string;
  bpm: number;
  key: string;
  audioPath: string;
  sizeBytes: number;
  createdAtMillis: number;
}

function formatSize(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Barra de filtros ───────────────────────────────────────────────────

function FilterChipGroup({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isActive = selected === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onSelect(isActive ? null : opt)}
              className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 ${
                isActive
                  ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan shadow-[0_0_10px_rgba(102,252,241,0.3)]"
                  : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const selectClasses =
  "rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white outline-none transition-colors duration-200 focus:border-neon-cyan";

// ─── Tarjeta de sample ──────────────────────────────────────────────────

function SampleCard({
  sample,
  isActive,
  onRequestPlay,
  onStopped,
  isSelected,
  onToggleSelect,
  referenceBpm,
  referenceKey,
  matchReference,
}: {
  sample: Sample;
  isActive: boolean;
  onRequestPlay: () => void;
  onStopped: () => void;
  isSelected: boolean;
  onToggleSelect: () => void;
  /** Tempo contra el que se compara y al que se adapta la pre-escucha. */
  referenceBpm: number | null;
  referenceKey: string | null;
  matchReference: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col gap-3 rounded-2xl border p-5 text-left transition-colors duration-200 ${
        isSelected ? "border-neon-cyan bg-neon-cyan/5" : "border-white/10 bg-graphite hover:border-neon-cyan/30"
      }`}
    >
      {/* Selección para "Enviar al Arranger" — deliberadamente un
          checkbox aparte, no toda la tarjeta clickeable: el resto de
          la tarjeta ya tiene su propio click (el reproductor). */}
      <button
        type="button"
        onClick={onToggleSelect}
        aria-label={isSelected ? "Quitar de la selección" : "Agregar a la selección"}
        aria-pressed={isSelected}
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md border text-[11px] transition-colors duration-200 ${
          isSelected
            ? "border-neon-cyan bg-neon-cyan text-onyx-black"
            : "border-white/25 text-transparent hover:border-white/50"
        }`}
      >
        ✓
      </button>
      <div className="min-w-0 pr-6">
        <p className="truncate font-display text-base font-semibold text-white">
          {sample.name}
        </p>
        <p className="mt-1 truncate text-xs text-white/40">
          {[sample.instrument, sample.type, sample.genre].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 truncate text-xs text-white/40">
          {[
            sample.bpm > 0 ? `${Math.round(sample.bpm)} BPM` : null,
            formatSize(sample.sizeBytes),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <SamplePreviewControl
        sample={{
          sampleId: sample.id,
          name: sample.name,
          audioPath: sample.audioPath,
          sampleType: sample.type,
          originalBpm: sample.bpm,
          sampleKey: sample.key,
        }}
        projectBpm={referenceBpm}
        projectKey={referenceKey}
        matchProject={matchReference}
        isPlaying={isActive}
        onRequestPlay={onRequestPlay}
        onStopped={onStopped}
        waveformHeight={34}
      />
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────

export default function SamplesPage() {
  // `loading` ya no se usa: el catálogo no espera al estado de sesión
  // para mostrarse, solo las acciones que necesitan cuenta lo consultan.
  const { user } = useAuth();
  const router = useRouter();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [nowPlayingId, setNowPlayingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectOptions, setProjectOptions] = useState<{ cloudId: string; title: string }[] | null>(null);
  const [loadingProjectOptions, setLoadingProjectOptions] = useState(false);

  const [filters, setFilters] = useState<SampleFilterState>(EMPTY_SAMPLE_FILTERS);

  function patchFilters(next: Partial<SampleFilterState>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  // El catálogo no vive adentro de ningún proyecto, así que la
  // referencia contra la que comparar la pone el usuario acá. Es lo que
  // convierte una lista de archivos en algo que contesta "¿esto me
  // sirve para lo que estoy haciendo?" — y la pre-escucha suena
  // directamente adaptada a eso, igual que en el Arranger.
  const [referenceBpmText, setReferenceBpmText] = useState("");
  const [referenceKey, setReferenceKey] = useState("");
  const [matchReference, setMatchReference] = useState(true);

  const referenceBpm = (() => {
    const value = Number(referenceBpmText.trim());
    return referenceBpmText.trim() && Number.isFinite(value) && value > 0 ? value : null;
  })();

  // Catálogo PÚBLICO (2026-09): las reglas de Firestore ya permiten
  // leer /samples sin sesión, igual que en la app — es una vidriera,
  // no contenido de nadie. Sin dependencia de `user`: los samples son
  // los mismos para todos, iniciar sesión no cambia la lista.
  useEffect(() => {
    const q = query(collection(db, "samples"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setSamples(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            const createdAt = data.createdAt as Timestamp | undefined;
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
              createdAtMillis: createdAt?.toMillis() ?? 0,
            };
          }),
        );
        setLoadingSamples(false);
      },
      () => setLoadingSamples(false),
    );

    return unsubscribe;
  }, []);

  const hasActiveFilters = filtersAreActive(filters);

  function clearFilters() {
    // Conserva el orden elegido: limpiar QUÉ se ve no es lo mismo que
    // volver a ordenar la lista.
    setFilters({ ...EMPTY_SAMPLE_FILTERS, sort: filters.sort });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * "Enviar al Arranger": arma la lista de samples elegidos en el
   * formato que espera el Arranger (ver ArrangerSample) y los deja
   * encolados (pendingArrangerSamples.ts) — el Arranger los consume al
   * montar, uno por pista nueva.
   */
  function collectChosenSamples(): ArrangerSample[] {
    return samples
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        instrument: s.instrument,
        genre: s.genre,
        bpm: s.bpm,
        key: s.key,
        audioPath: s.audioPath,
        sizeBytes: s.sizeBytes,
      }));
  }

  /** target: "new" (proyecto nuevo) o el cloudId de un proyecto ya sincronizado. */
  function sendSelectionToProject(target: "new" | string) {
    const chosen = collectChosenSamples();
    if (chosen.length === 0) return;
    queueSamplesForArranger(chosen);
    setShowProjectPicker(false);
    setSelectedIds(new Set());
    router.push(target === "new" ? "/arranger?new=1" : `/arranger?open=${encodeURIComponent(target)}`);
  }

  /**
   * Se dispara al abrir el selector de proyecto destino — trae la
   * lista de proyectos ya sincronizados del usuario UNA sola vez (no
   * un listener en vivo: esto es solo para elegir un destino, no hace
   * falta que se actualice sola mientras el diálogo está abierto) — la
   * MISMA colección que lee ProjectsDashboard.
   */
  async function openProjectPicker() {
    // Escuchar el catálogo no pide cuenta, pero mandar samples a un
    // proyecto sí: hay que saber a QUIÉN pertenece. Sin sesión se
    // ofrece iniciarla en vez de abrir un selector vacío.
    if (!user) {
      setIsLoginOpen(true);
      return;
    }
    setShowProjectPicker(true);
    if (projectOptions !== null) return; // ya se trajo antes en esta visita a la página
    setLoadingProjectOptions(true);
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "projects"));
      setProjectOptions(
        snap.docs.map((d) => ({
          cloudId: d.id,
          title: (d.data().title as string) || "Sin título",
        })),
      );
    } finally {
      setLoadingProjectOptions(false);
    }
  }

  const filteredSamples = useMemo(
    () => applySampleFilters(samples, filters, { bpm: referenceBpm, key: referenceKey || null }),
    [samples, filters, referenceBpm, referenceKey],
  );

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <Link
          href="/projects"
          className="text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          ← Mis Proyectos
        </Link>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Banco de <span className="text-neon-cyan">Sonidos</span>
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/50">
          Loops y samples listos para importar a tu proyecto.
        </p>
      </div>

      {loadingSamples ? (
        <p className="text-xs text-white/40">Cargando catálogo...</p>
      ) : samples.length === 0 ? (
        <p className="text-xs text-white/30">
          Todavía no hay sonidos publicados.
        </p>
      ) : (
        <>
          {/* ─── Barra de filtros ─── */}
          <div className="flex w-full max-w-4xl flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-5 text-left">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={filters.search}
                onChange={(e) => patchFilters({ search: e.target.value })}
                placeholder="Buscar por nombre, instrumento o género..."
                className="flex-1 rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
              />
              <select
                value={filters.sort}
                onChange={(e) => patchFilters({ sort: e.target.value as SampleFilterState["sort"] })}
                className={selectClasses}
              >
                <option value="recent">Más recientes</option>
                <option value="affinity">Afinidad con mi tema</option>
                <option value="name">Nombre</option>
                <option value="bpmAsc">BPM ascendente</option>
                <option value="bpmDesc">BPM descendente</option>
              </select>
            </div>

            {/* Contra qué comparar. Sin esto, "afinidad" y
                "compatibles" no tienen contra qué medirse, y la
                pre-escucha solo puede sonar como el original. */}
            <div className="flex flex-wrap items-end gap-4 rounded-xl border border-white/10 bg-onyx-black/40 p-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Tempo de mi tema
                </label>
                <input
                  type="number"
                  min={20}
                  max={300}
                  value={referenceBpmText}
                  onChange={(e) => setReferenceBpmText(e.target.value)}
                  placeholder="120"
                  className="w-24 rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Tonalidad de mi tema
                </label>
                <select
                  value={referenceKey}
                  onChange={(e) => setReferenceKey(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">—</option>
                  {SAMPLE_KEYS.filter((k) => k !== "N/A").map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => patchFilters({ compatibleOnly: !filters.compatibleOnly })}
                disabled={!referenceKey}
                title={
                  referenceKey
                    ? `Solo lo que entra en ${referenceKey}: la relativa, las quintas vecinas y todo lo que no tiene tonalidad.`
                    : "Elegí la tonalidad de tu tema para poder filtrar por compatibilidad."
                }
                className={`self-end rounded-full border px-4 py-2 text-xs transition-colors duration-200 disabled:opacity-30 ${
                  filters.compatibleOnly
                    ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                    : "border-white/15 text-white/60 hover:border-white/40"
                }`}
              >
                Solo compatibles
              </button>
              <button
                type="button"
                onClick={() => setMatchReference(!matchReference)}
                disabled={referenceBpm === null && !referenceKey}
                title="Escuchar los samples ya adaptados al tempo y la tonalidad de tu tema, en vez de como se subieron."
                className={`self-end rounded-full border px-4 py-2 text-xs transition-colors duration-200 disabled:opacity-30 ${
                  matchReference
                    ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                    : "border-white/15 text-white/60 hover:border-white/40"
                }`}
              >
                {matchReference ? "Escuchar adaptado" : "Escuchar original"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FilterChipGroup
                label="Tipo"
                options={SAMPLE_TYPES}
                selected={filters.type}
                onSelect={(value) => patchFilters({ type: value })}
              />
              <FilterChipGroup
                label="Instrumento"
                options={SAMPLE_INSTRUMENTS}
                selected={filters.instrument}
                onSelect={(value) => patchFilters({ instrument: value })}
              />
              <FilterChipGroup
                label="Género"
                options={SAMPLE_GENRES}
                selected={filters.genre}
                onSelect={(value) => patchFilters({ genre: value })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Tonalidad
                </label>
                <select
                  value={filters.key}
                  onChange={(e) => patchFilters({ key: e.target.value })}
                  className={selectClasses}
                >
                  <option value="">Todas</option>
                  {SAMPLE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  BPM
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={filters.bpmMin}
                    onChange={(e) => patchFilters({ bpmMin: e.target.value })}
                    placeholder="Min"
                    className="w-20 rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
                  />
                  <span className="text-white/30">–</span>
                  <input
                    type="number"
                    min={1}
                    value={filters.bpmMax}
                    onChange={(e) => patchFilters({ bpmMax: e.target.value })}
                    placeholder="Max"
                    className="w-20 rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
                  />
                </div>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="self-end rounded-full border border-white/15 px-4 py-2 text-xs text-white/60 transition-colors duration-200 hover:border-red-400/50 hover:text-red-300"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          {/* ─── Resultados ─── */}
          {filteredSamples.length === 0 ? (
            <p className="text-xs text-white/30">
              Ningún sample coincide con estos filtros.
            </p>
          ) : (
            <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSamples.map((sample) => (
                <SampleCard
                  key={sample.id}
                  sample={sample}
                  isActive={nowPlayingId === sample.id}
                  onRequestPlay={() => setNowPlayingId(sample.id)}
                  onStopped={() =>
                    setNowPlayingId((cur) => (cur === sample.id ? null : cur))
                  }
                  referenceBpm={referenceBpm}
                  referenceKey={referenceKey || null}
                  matchReference={matchReference}
                  isSelected={selectedIds.has(sample.id)}
                  onToggleSelect={() => toggleSelected(sample.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Paso 2 — barra flotante: aparece con la selección activa, sin
          desplazar el resto del layout (fixed, no reserva espacio). */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-neon-cyan/30 bg-graphite px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
            <span className="text-xs text-white/70">
              {selectedIds.size} {selectedIds.size === 1 ? "sample seleccionado" : "samples seleccionados"}
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void openProjectPicker()}
              className="rounded-full bg-neon-cyan px-4 py-1.5 font-display text-xs font-semibold text-onyx-black transition-all duration-200 hover:shadow-[0_0_16px_rgba(102,252,241,0.5)]"
            >
              Enviar al Arranger
            </button>
          </div>
        </div>
      )}

      {/* Selector de proyecto destino — "proyecto nuevo" siempre
          primero, seguido de los ya sincronizados (mismos datos que
          ProjectsDashboard, traídos una sola vez al abrir esto). */}
      {showProjectPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
          onClick={() => setShowProjectPicker(false)}
        >
          <div
            className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-white/10 bg-graphite p-6 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-sm font-semibold text-white">¿A qué proyecto enviar?</h3>
            <p className="text-xs text-white/40">
              {selectedIds.size} {selectedIds.size === 1 ? "sample" : "samples"} — cada uno va a su propia pista nueva.
            </p>

            <button
              type="button"
              onClick={() => sendSelectionToProject("new")}
              className="flex items-center justify-between rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-4 py-2.5 text-left text-sm font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan"
            >
              + Proyecto nuevo
            </button>

            <div className="max-h-56 overflow-y-auto">
              {loadingProjectOptions ? (
                <p className="px-1 py-2 text-xs text-white/40">Cargando tus proyectos...</p>
              ) : !projectOptions || projectOptions.length === 0 ? (
                <p className="px-1 py-2 text-xs text-white/30">
                  Todavía no sincronizaste ningún proyecto desde el Arranger.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {projectOptions.map((p) => (
                    <button
                      key={p.cloudId}
                      type="button"
                      onClick={() => sendSelectionToProject(p.cloudId)}
                      className="truncate rounded-lg border border-white/15 px-4 py-2 text-left text-sm text-white/80 transition-colors duration-200 hover:border-white/40 hover:text-white"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowProjectPicker(false)}
              className="mt-1 self-end text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
    </div>
  );
}
