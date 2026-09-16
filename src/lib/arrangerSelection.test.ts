// src/lib/arrangerSelection.test.ts

import { describe, expect, it } from "vitest";
import {
  buildClipboard,
  clipsInRect,
  placeClipboard,
  selectionSpan,
  toggleSelection,
  type SelectableTrack,
} from "./arrangerSelection";

function clip(id: string, startSeconds: number, displayDuration: number) {
  return { id, startSeconds, displayDuration };
}

const tracks: SelectableTrack[] = [
  { id: "t1", clips: [clip("a", 0, 2), clip("b", 4, 2)] },
  { id: "t2", clips: [clip("c", 1, 2), clip("d", 8, 2)] },
  { id: "t3", clips: [clip("e", 4, 4)] },
];

describe("toggleSelection", () => {
  it("agrega y saca", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("conserva el orden en que se eligieron", () => {
    // El primero es el ancla del pegado: tiene que ser el que la
    // persona tocó primero, no el que esté más a la izquierda.
    expect(toggleSelection(["c"], "a")).toEqual(["c", "a"]);
  });
});

describe("rectángulo de goma", () => {
  it("toma cualquier clip que TOQUE el rectángulo, aunque no entre entero", () => {
    // 1 → 1,5 corta el clip "a" (0→2) y el "c" (1→3) por el medio.
    expect(clipsInRect(tracks, 0, 1, 1, 1.5).sort()).toEqual(["a", "c"]);
  });

  it("no toma lo que queda fuera del rango de pistas", () => {
    expect(clipsInRect(tracks, 0, 0, 0, 20).sort()).toEqual(["a", "b"]);
  });

  it("funciona dibujado al revés, de abajo a la derecha hacia arriba a la izquierda", () => {
    expect(clipsInRect(tracks, 2, 0, 10, 4).sort()).toEqual(["b", "d", "e"]);
  });

  it("un borde que se toca justo no cuenta", () => {
    // El clip "b" arranca en 4: un rectángulo que termina exactamente
    // en 4 no lo incluye. Si contara, encerrar los primeros cuatro
    // segundos arrastraría el clip del compás siguiente.
    expect(clipsInRect(tracks, 0, 0, 0, 4)).toEqual(["a"]);
  });

  it("un rectángulo vacío no selecciona nada", () => {
    expect(clipsInRect(tracks, 0, 2, 20, 25)).toEqual([]);
  });
});

describe("selectionSpan", () => {
  it("va del principio del más temprano al final del más tardío", () => {
    expect(selectionSpan([clip("a", 0, 2), clip("e", 4, 4)])).toEqual({
      startSeconds: 0,
      endSeconds: 8,
    });
  });

  it("de un solo clip da su propia duración", () => {
    // Así duplicar UN clip sigue corriendo lo mismo que antes de que
    // existiera la selección múltiple.
    expect(selectionSpan([clip("a", 3, 2)])).toEqual({ startSeconds: 3, endSeconds: 5 });
  });

  it("sin clips no hay tramo", () => {
    expect(selectionSpan([])).toBeNull();
  });
});

describe("copiar y pegar un bloque", () => {
  const placements = [
    { clip: "a", trackIndex: 1, startSeconds: 10 },
    { clip: "b", trackIndex: 2, startSeconds: 11.5 },
    { clip: "c", trackIndex: 1, startSeconds: 14 },
  ];

  it("guarda posiciones relativas, no absolutas", () => {
    const entries = buildClipboard(placements);
    expect(entries).toEqual([
      { clip: "a", trackOffset: 0, timeOffset: 0 },
      { clip: "b", trackOffset: 1, timeOffset: 1.5 },
      { clip: "c", trackOffset: 0, timeOffset: 4 },
    ]);
  });

  it("pegar en otro lado conserva la forma del bloque", () => {
    const entries = buildClipboard(placements);
    const { placed, droppedCount } = placeClipboard(entries, 0, 32, 3);
    expect(droppedCount).toBe(0);
    expect(placed).toEqual([
      { clip: "a", trackIndex: 0, startSeconds: 32 },
      { clip: "b", trackIndex: 1, startSeconds: 33.5 },
      { clip: "c", trackIndex: 0, startSeconds: 36 },
    ]);
  });

  it("DESCARTA lo que no tiene pista de destino, en vez de apilarlo", () => {
    // Aplastar dos pistas en una dejaría clips superpuestos sonando a
    // la vez, que hay que separar a mano. Peor que no pegar ese clip.
    const entries = buildClipboard(placements);
    const { placed, droppedCount } = placeClipboard(entries, 2, 0, 3);
    expect(droppedCount).toBe(1);
    expect(placed.map((p) => p.clip)).toEqual(["a", "c"]);
  });

  it("el caso normal —varios clips de UNA pista— nunca pierde nada", () => {
    const entries = buildClipboard([
      { clip: "a", trackIndex: 4, startSeconds: 0 },
      { clip: "b", trackIndex: 4, startSeconds: 2 },
    ]);
    const { placed, droppedCount } = placeClipboard(entries, 0, 7, 1);
    expect(droppedCount).toBe(0);
    expect(placed).toEqual([
      { clip: "a", trackIndex: 0, startSeconds: 7 },
      { clip: "b", trackIndex: 0, startSeconds: 9 },
    ]);
  });

  it("nunca pega en tiempo negativo", () => {
    const entries = buildClipboard([{ clip: "a", trackIndex: 0, startSeconds: 5 }]);
    const { placed } = placeClipboard(entries, 0, -3, 1);
    expect(placed[0].startSeconds).toBe(0);
  });
});
