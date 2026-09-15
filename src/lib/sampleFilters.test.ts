// src/lib/sampleFilters.test.ts
//
// Lo que se fija acá no es "el filtro filtra", sino las decisiones que
// NO se ven mirando la pantalla: que un One-Shot sin tempo no
// desaparezca al acotar el BPM, que el orden por afinidad ponga
// primero lo que de verdad entra, y que "solo compatibles" no esconda
// la percusión.

import { describe, expect, it } from "vitest";
import {
  EMPTY_SAMPLE_FILTERS,
  applySampleFilters,
  hasActiveFilters,
  type FilterableSample,
  type SampleFilterState,
} from "./sampleFilters";

function sample(over: Partial<FilterableSample> & { id: string }): FilterableSample {
  return {
    name: over.id,
    type: "Loop",
    instrument: "Drums",
    genre: "Hip-Hop",
    bpm: 120,
    key: "N/A",
    ...over,
  };
}

const CATALOG: FilterableSample[] = [
  sample({ id: "bombo", type: "One-Shot", bpm: 0, key: "N/A", instrument: "Drums" }),
  sample({ id: "groove90", bpm: 90, key: "A Minor", instrument: "Drums" }),
  sample({ id: "bajo120", bpm: 120, key: "A Minor", instrument: "Bass" }),
  sample({ id: "teclas120", bpm: 120, key: "Eb Major", instrument: "Keys" }),
  sample({ id: "guitarra118", bpm: 118, key: "C Major", instrument: "Guitar" }),
];

const PROJECT = { bpm: 120, key: "A Minor" };

function filters(over: Partial<SampleFilterState> = {}): SampleFilterState {
  return { ...EMPTY_SAMPLE_FILTERS, ...over };
}

function ids(result: FilterableSample[]): string[] {
  return result.map((s) => s.id);
}

describe("applySampleFilters — filtrado", () => {
  it("sin filtros devuelve todo", () => {
    expect(applySampleFilters(CATALOG, filters(), PROJECT)).toHaveLength(5);
  });

  it("busca también por instrumento y género, no solo por nombre", () => {
    // Escribir "bass" y no encontrar nada porque los samples se llaman
    // "Groove 03" es lo que hace pensar que el catálogo está vacío.
    expect(ids(applySampleFilters(CATALOG, filters({ search: "bass" }), PROJECT))).toEqual([
      "bajo120",
    ]);
    expect(applySampleFilters(CATALOG, filters({ search: "hip-hop" }), PROJECT)).toHaveLength(5);
  });

  it("filtra por tipo — lo que al panel del Arranger le faltaba", () => {
    expect(ids(applySampleFilters(CATALOG, filters({ type: "One-Shot" }), PROJECT))).toEqual([
      "bombo",
    ]);
  });

  it("un sample sin tempo sobrevive a un rango de BPM", () => {
    // No está "a 0 BPM": no tiene tempo. Descartarlo dejaría a los
    // One-Shots afuera justo cuando más se los busca.
    const result = applySampleFilters(CATALOG, filters({ bpmMin: "100", bpmMax: "130" }), PROJECT);
    expect(ids(result)).toContain("bombo");
    expect(ids(result)).not.toContain("groove90");
  });

  it("'solo compatibles' descarta lo que pelea y conserva la percusión", () => {
    const result = applySampleFilters(CATALOG, filters({ compatibleOnly: true }), PROJECT);
    expect(ids(result)).toContain("bombo"); // sin tonalidad: entra en cualquier lado
    expect(ids(result)).toContain("guitarra118"); // C Major es la relativa de A Minor
    expect(ids(result)).not.toContain("teclas120"); // Eb Major está al otro lado de la rueda
  });

  it("'solo compatibles' no hace nada si el proyecto no tiene tonalidad", () => {
    const result = applySampleFilters(CATALOG, filters({ compatibleOnly: true }), {
      bpm: 120,
      key: null,
    });
    expect(result).toHaveLength(5);
  });
});

describe("applySampleFilters — orden", () => {
  it("por afinidad, primero lo que entra", () => {
    const result = ids(applySampleFilters(CATALOG, filters({ sort: "affinity" }), PROJECT));
    // El bajo está en tono y en tempo: primero.
    expect(result[0]).toBe("bajo120");
    // Las teclas pelean con la tonalidad: últimas, aunque el tempo sea exacto.
    expect(result[result.length - 1]).toBe("teclas120");
  });

  it("el orden por afinidad depende del proyecto, no del catálogo", () => {
    const enEbMajor = ids(
      applySampleFilters(CATALOG, filters({ sort: "affinity" }), { bpm: 120, key: "Eb Major" }),
    );
    expect(enEbMajor[0]).toBe("teclas120");
  });

  it("por BPM ignora la tonalidad", () => {
    expect(ids(applySampleFilters(CATALOG, filters({ sort: "bpmAsc" }), PROJECT))[0]).toBe("bombo");
  });

  it("'recientes' respeta el orden de entrada cuando no hay fechas", () => {
    // Es el caso del panel del Arranger: la lista ya viene ordenada por
    // createdAt desde Firestore, así que reordenarla sería romperla.
    expect(ids(applySampleFilters(CATALOG, filters({ sort: "recent" }), PROJECT))).toEqual(
      ids(CATALOG),
    );
  });

  it("'recientes' usa las fechas cuando las hay", () => {
    const conFechas = [
      sample({ id: "viejo", createdAtMillis: 1 }),
      sample({ id: "nuevo", createdAtMillis: 99 }),
    ];
    expect(ids(applySampleFilters(conFechas, filters({ sort: "recent" }), PROJECT))).toEqual([
      "nuevo",
      "viejo",
    ]);
  });

  it("no muta la lista original", () => {
    const original = ids(CATALOG);
    applySampleFilters(CATALOG, filters({ sort: "bpmDesc" }), PROJECT);
    expect(ids(CATALOG)).toEqual(original);
  });
});

describe("hasActiveFilters", () => {
  it("distingue el estado limpio", () => {
    expect(hasActiveFilters(filters())).toBe(false);
    expect(hasActiveFilters(filters({ sort: "affinity" }))).toBe(false); // ordenar no es filtrar
    expect(hasActiveFilters(filters({ compatibleOnly: true }))).toBe(true);
    expect(hasActiveFilters(filters({ search: "  " }))).toBe(false);
    expect(hasActiveFilters(filters({ search: "bajo" }))).toBe(true);
  });
});
