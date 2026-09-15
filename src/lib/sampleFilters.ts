// src/lib/sampleFilters.ts
//
// Filtrado y orden del Banco de Sonidos, en un solo lugar.
//
// Hasta ahora esta lógica estaba DUPLICADA entre /samples/page.tsx y
// SampleBrowserPanel.tsx, con una nota que decía que duplicar algo
// chico y estable era más seguro que abstraerlo bajo presión. Era
// cierto mientras fueran cuatro `filter` seguidos — y de hecho ya se
// habían separado: el panel del Arranger nunca tuvo el filtro por
// TIPO que sí tenía el catálogo, así que desde el Arranger no había
// forma de pedir "solo loops".
//
// Con la compatibilidad de tonalidad y el orden por afinidad, esto deja
// de ser chico: son reglas musicales que las dos pantallas tienen que
// responder IGUAL, o el mismo sample aparece en una y no en la otra.
//
// Sigue siendo todo del lado del cliente sobre la colección completa,
// por el mismo motivo de siempre (ver el encabezado de /samples): con
// un catálogo de cientos esto es instantáneo y muchísimo más simple
// que reconstruir queries compuestas de Firestore por cada combinación.

import { affinityFor, keysAreCompatible } from "./sampleAffinity";

export interface FilterableSample {
  id: string;
  name: string;
  type: string;
  instrument: string;
  genre: string;
  bpm: number;
  key: string;
  /** Opcional: el panel del Arranger recibe la lista ya ordenada por Firestore y no lo necesita. */
  createdAtMillis?: number;
}

export type SampleSort = "affinity" | "recent" | "bpmAsc" | "bpmDesc" | "name";

export interface SampleFilterState {
  search: string;
  type: string | null;
  instrument: string | null;
  genre: string | null;
  /** Tonalidad EXACTA. Convive con compatibleOnly: uno es preciso, el otro amplio. */
  key: string;
  /** Solo lo que entra en la tonalidad del proyecto (ver keysAreCompatible). */
  compatibleOnly: boolean;
  bpmMin: string;
  bpmMax: string;
  sort: SampleSort;
}

export interface ProjectContext {
  bpm: number | null;
  key: string | null;
}

export const EMPTY_SAMPLE_FILTERS: SampleFilterState = {
  search: "",
  type: null,
  instrument: null,
  genre: null,
  key: "",
  compatibleOnly: false,
  bpmMin: "",
  bpmMax: "",
  sort: "recent",
};

/** ¿Hay algún filtro puesto? Para poder ofrecer "limpiar" solo cuando sirve de algo. */
export function hasActiveFilters(state: SampleFilterState): boolean {
  return (
    state.search.trim() !== "" ||
    state.type !== null ||
    state.instrument !== null ||
    state.genre !== null ||
    state.key !== "" ||
    state.compatibleOnly ||
    state.bpmMin.trim() !== "" ||
    state.bpmMax.trim() !== ""
  );
}

function parseBound(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function applySampleFilters<T extends FilterableSample>(
  samples: readonly T[],
  state: SampleFilterState,
  project: ProjectContext,
): T[] {
  let result = samples.slice();

  const query = state.search.trim().toLowerCase();
  if (query) {
    // Por nombre y por instrumento: escribir "bass" y que no aparezca
    // nada porque los samples se llaman "Groove 03" es exactamente el
    // tipo de búsqueda que hace pensar que el catálogo está vacío.
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.instrument.toLowerCase().includes(query) ||
        s.genre.toLowerCase().includes(query),
    );
  }
  if (state.type) result = result.filter((s) => s.type === state.type);
  if (state.instrument) result = result.filter((s) => s.instrument === state.instrument);
  if (state.genre) result = result.filter((s) => s.genre === state.genre);
  if (state.key) result = result.filter((s) => s.key === state.key);
  if (state.compatibleOnly) {
    result = result.filter((s) => keysAreCompatible(project.key, s.key));
  }

  const min = parseBound(state.bpmMin);
  // Un sample sin tempo (bpm 0) NO se descarta por un rango de BPM: no
  // está "a 0 BPM", no tiene tempo. Filtrarlo dejaría a los One-Shots
  // fuera de cualquier búsqueda que acote el tempo, que es justo cuando
  // más se los necesita.
  if (min !== null) result = result.filter((s) => s.bpm === 0 || s.bpm >= min);
  const max = parseBound(state.bpmMax);
  if (max !== null) result = result.filter((s) => s.bpm === 0 || s.bpm <= max);

  // Array.prototype.sort es estable desde ES2019, así que los empates
  // conservan el orden de entrada — que para el panel del Arranger ya
  // viene por fecha desde Firestore.
  switch (state.sort) {
    case "affinity":
      result.sort(
        (a, b) =>
          affinityFor(a, project.bpm, project.key).rank -
          affinityFor(b, project.bpm, project.key).rank,
      );
      break;
    case "bpmAsc":
      result.sort((a, b) => a.bpm - b.bpm);
      break;
    case "bpmDesc":
      result.sort((a, b) => b.bpm - a.bpm);
      break;
    case "name":
      result.sort((a, b) => a.name.localeCompare(b.name, "es"));
      break;
    case "recent":
      if (result.some((s) => s.createdAtMillis !== undefined)) {
        result.sort((a, b) => (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0));
      }
      break;
  }

  return result;
}
