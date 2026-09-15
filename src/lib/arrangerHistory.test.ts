// src/lib/arrangerHistory.test.ts
//
// El reducer se prueba solo, sin React: es una función pura y es donde
// vive todo lo que puede salir mal. Lo que se fija acá son las reglas
// que no se ven usando la app hasta que fallan — que la importación no
// llene el historial de pasos intermedios, que un fader entero cuente
// como una acción, y que deshacer después de haber deshecho no invente
// una rama.

import { describe, expect, it } from "vitest";
import {
  RESET,
  SILENT,
  historyReducer,
  push,
  type ArrangementState,
} from "./arrangerHistory";
import { DEFAULT_MASTER_FX } from "./trackEffects";

function state(over: Partial<ArrangementState> = {}): ArrangementState {
  return {
    projectTitle: "Tema",
    projectTempoBpm: 120,
    projectKey: "",
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    masterFx: DEFAULT_MASTER_FX,
    tracks: [],
    ...over,
  };
}

function history(present = state()) {
  return {
    past: [] as { state: ArrangementState; label: string }[],
    present,
    future: [] as { state: ArrangementState; label: string }[],
    lastCoalesceKey: null as string | null,
    lastCommitAt: 0,
  };
}

/** Un cambio cualquiera, identificable por el título. */
function rename(title: string) {
  return (prev: ArrangementState) => ({ ...prev, projectTitle: title });
}

function commit(h: ReturnType<typeof history>, title: string, mode = push(`Renombrar a ${title}`)) {
  return historyReducer(h, { type: "commit", recipe: rename(title), mode });
}

describe("commit", () => {
  it("apila el estado anterior", () => {
    const h = commit(history(), "B");
    expect(h.present.projectTitle).toBe("B");
    expect(h.past).toHaveLength(1);
    expect(h.past[0].state.projectTitle).toBe("Tema");
  });

  it("guarda la etiqueta para poder decir QUÉ se deshace", () => {
    const h = commit(history(), "B", push("Mover clip"));
    expect(h.past[0].label).toBe("Mover clip");
  });

  it("una receta que no cambia nada no ensucia el historial", () => {
    // Arrastrar un clip y soltarlo donde estaba.
    const h = historyReducer(history(), {
      type: "commit",
      recipe: (prev) => prev,
      mode: push("Mover clip"),
    });
    expect(h.past).toHaveLength(0);
  });

  it("silent cambia el presente sin tocar el historial", () => {
    // El caso real: la importación revela las pistas de a una y los
    // picos se calculan después, en su propio tick. Si cada uno fuera
    // una entrada, deshacer caminaría hacia atrás pista por pista.
    let h = commit(history(), "B");
    h = historyReducer(h, { type: "commit", recipe: rename("C"), mode: SILENT });
    expect(h.present.projectTitle).toBe("C");
    expect(h.past).toHaveLength(1);
    expect(h.past[0].state.projectTitle).toBe("Tema");
  });

  it("reset convierte el estado en la nueva base", () => {
    // Abrir otro proyecto: deshacer ahí devolvería a un arreglo que ya
    // no existe.
    let h = commit(history(), "B");
    h = commit(h, "C");
    h = historyReducer(h, { type: "commit", recipe: rename("Otro"), mode: RESET });
    expect(h.present.projectTitle).toBe("Otro");
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });
});

describe("fusión de commits", () => {
  it("un arrastre entero de fader es UNA acción", () => {
    let h = history();
    for (const value of ["a", "b", "c", "d"]) {
      h = commit(h, value, push("Volumen", "volumen:pista1"));
    }
    expect(h.present.projectTitle).toBe("d");
    expect(h.past).toHaveLength(1);
    // Y deshacer vuelve a ANTES de que arrancara el arrastre.
    expect(h.past[0].state.projectTitle).toBe("Tema");
  });

  it("dos controles distintos no se fusionan entre sí", () => {
    let h = commit(history(), "a", push("Volumen", "volumen:pista1"));
    h = commit(h, "b", push("Volumen", "volumen:pista2"));
    expect(h.past).toHaveLength(2);
  });

  it("sin clave de fusión, cada commit es su propia acción", () => {
    let h = commit(history(), "a");
    h = commit(h, "b");
    expect(h.past).toHaveLength(2);
  });

  it("deshacer corta la fusión", () => {
    // Si no, el próximo movimiento del fader se fusionaría con lo que
    // acabamos de deshacer y el paso se perdería.
    let h = commit(history(), "a", push("Volumen", "volumen:pista1"));
    h = historyReducer(h, { type: "undo" });
    h = commit(h, "b", push("Volumen", "volumen:pista1"));
    expect(h.past).toHaveLength(1);
    expect(h.present.projectTitle).toBe("b");
  });
});

describe("undo / redo", () => {
  it("vuelve al estado anterior y permite rehacer", () => {
    let h = commit(history(), "B");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.projectTitle).toBe("Tema");
    expect(h.future).toHaveLength(1);

    h = historyReducer(h, { type: "redo" });
    expect(h.present.projectTitle).toBe("B");
    expect(h.future).toHaveLength(0);
  });

  it("aguanta varios pasos seguidos", () => {
    let h = history();
    for (const title of ["A", "B", "C"]) h = commit(h, title);
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "undo" });
    expect(h.present.projectTitle).toBe("A");
    h = historyReducer(h, { type: "redo" });
    expect(h.present.projectTitle).toBe("B");
  });

  it("editar después de deshacer descarta lo rehacible", () => {
    // El comportamiento de todos los editores: la alternativa (mantener
    // una rama) no se puede explicar en una barra de herramientas.
    let h = commit(history(), "B");
    h = historyReducer(h, { type: "undo" });
    h = commit(h, "C");
    expect(h.future).toHaveLength(0);
    expect(h.present.projectTitle).toBe("C");
  });

  it("deshacer sin nada que deshacer no rompe nada", () => {
    const h = history();
    expect(historyReducer(h, { type: "undo" })).toBe(h);
    expect(historyReducer(h, { type: "redo" })).toBe(h);
  });

  it("el estado anterior no se muta: los objetos se comparten", () => {
    // Es lo que hace barato el historial: las pistas que no cambiaron
    // son la MISMA referencia, incluidos sus AudioBuffer. Si alguna
    // operación mutara en vez de copiar, deshacer devolvería un estado
    // ya contaminado.
    const pista = { id: "t1", name: "Pista 1" } as unknown as ArrangementState["tracks"][number];
    const inicial = state({ tracks: [pista] });
    const h = historyReducer(history(inicial), {
      type: "commit",
      recipe: (prev) => ({ ...prev, projectTempoBpm: 140 }),
      mode: push("Tempo"),
    });
    expect(h.past[0].state.tracks[0]).toBe(pista);
    expect(h.present.tracks[0]).toBe(pista);
    expect(h.past[0].state.projectTempoBpm).toBe(120);
  });
});
