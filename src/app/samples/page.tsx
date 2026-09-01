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
import { ref, getDownloadURL } from "firebase/storage";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { LoginModal } from "@/components/LoginModal";
import { SamplePlayer } from "@/components/SamplePlayer";
import {
  SAMPLE_TYPES,
  SAMPLE_INSTRUMENTS,
  SAMPLE_GENRES,
  SAMPLE_KEYS,
} from "@/lib/sampleTaxonomy";
import { queueSamplesForArranger } from "@/lib/pendingArrangerSamples";
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

type SortOption = "recent" | "bpmAsc" | "bpmDesc";

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
  isSelected,
  onToggleSelect,
}: {
  sample: Sample;
  isActive: boolean;
  onRequestPlay: () => void;
  isSelected: boolean;
  onToggleSelect: () => void;
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
            `${Math.round(sample.bpm)} BPM`,
            sample.key && sample.key !== "N/A" ? sample.key : null,
            formatSize(sample.sizeBytes),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {url ? (
        <SamplePlayer src={url} isActive={isActive} onRequestPlay={onRequestPlay} />
      ) : (
        <div className="h-8 animate-pulse rounded-full bg-white/5" />
      )}
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────

export default function SamplesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [nowPlayingId, setNowPlayingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectOptions, setProjectOptions] = useState<{ cloudId: string; title: string }[] | null>(null);
  const [loadingProjectOptions, setLoadingProjectOptions] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [bpmMin, setBpmMin] = useState("");
  const [bpmMax, setBpmMax] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  useEffect(() => {
    if (!user) return;

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
  }, [user]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    selectedType !== null ||
    selectedInstrument !== null ||
    selectedGenre !== null ||
    selectedKey !== "" ||
    bpmMin !== "" ||
    bpmMax !== "";

  function clearFilters() {
    setSearchQuery("");
    setSelectedType(null);
    setSelectedInstrument(null);
    setSelectedGenre(null);
    setSelectedKey("");
    setBpmMin("");
    setBpmMax("");
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
    setShowProjectPicker(true);
    if (projectOptions !== null) return; // ya se trajo antes en esta visita a la página
    if (!user) return;
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

  const filteredSamples = useMemo(() => {
    let result = samples;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (selectedType) result = result.filter((s) => s.type === selectedType);
    if (selectedInstrument) {
      result = result.filter((s) => s.instrument === selectedInstrument);
    }
    if (selectedGenre) result = result.filter((s) => s.genre === selectedGenre);
    if (selectedKey) result = result.filter((s) => s.key === selectedKey);

    const min = bpmMin.trim() ? Number(bpmMin) : null;
    if (min !== null && !Number.isNaN(min)) {
      result = result.filter((s) => s.bpm >= min);
    }
    const max = bpmMax.trim() ? Number(bpmMax) : null;
    if (max !== null && !Number.isNaN(max)) {
      result = result.filter((s) => s.bpm <= max);
    }

    const sorted = [...result];
    if (sortBy === "bpmAsc") {
      sorted.sort((a, b) => a.bpm - b.bpm);
    } else if (sortBy === "bpmDesc") {
      sorted.sort((a, b) => b.bpm - a.bpm);
    } else {
      sorted.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
    }
    return sorted;
  }, [
    samples,
    searchQuery,
    selectedType,
    selectedInstrument,
    selectedGenre,
    selectedKey,
    bpmMin,
    bpmMax,
    sortBy,
  ]);

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

      {loading ? null : !user ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-graphite p-8">
          <p className="text-sm text-white/60">
            Iniciá sesión para acceder al catálogo.
          </p>
          <button
            type="button"
            onClick={() => setIsLoginOpen(true)}
            className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
          >
            Iniciar Sesión
          </button>
        </div>
      ) : loadingSamples ? (
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre..."
                className="flex-1 rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className={selectClasses}
              >
                <option value="recent">Más recientes</option>
                <option value="bpmAsc">BPM ascendente</option>
                <option value="bpmDesc">BPM descendente</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FilterChipGroup
                label="Tipo"
                options={SAMPLE_TYPES}
                selected={selectedType}
                onSelect={setSelectedType}
              />
              <FilterChipGroup
                label="Instrumento"
                options={SAMPLE_INSTRUMENTS}
                selected={selectedInstrument}
                onSelect={setSelectedInstrument}
              />
              <FilterChipGroup
                label="Género"
                options={SAMPLE_GENRES}
                selected={selectedGenre}
                onSelect={setSelectedGenre}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Tonalidad
                </label>
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
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
                    value={bpmMin}
                    onChange={(e) => setBpmMin(e.target.value)}
                    placeholder="Min"
                    className="w-20 rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
                  />
                  <span className="text-white/30">–</span>
                  <input
                    type="number"
                    min={1}
                    value={bpmMax}
                    onChange={(e) => setBpmMax(e.target.value)}
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
