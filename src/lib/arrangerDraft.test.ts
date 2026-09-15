// Pruebas del borrador del Arranger.
//
// Lo que se está protegiendo acá es el trabajo del usuario: hasta que
// existió este módulo, armar un arreglo y cambiar de sección en el menú
// lo borraba entero, sin aviso. Las dos cosas que tienen que seguir
// siendo ciertas, y que no se notan mirando la pantalla:
//
//   · lo que se guarda se puede volver a leer COMPLETO, salvo el audio
//     (que no es serializable y se recupera por `audioPath`);
//   · la firma de contenido cambia cuando cambia el arreglo y NO cambia
//     cuando solo pasa el tiempo — de eso depende que el aviso de "sin
//     sincronizar" signifique algo.
//
// El entorno de Vitest es node, sin DOM (ver vitest.config.ts), así que
// `window.localStorage` se stubea acá abajo. No es una limitación:
// justamente prueba que el módulo no toca nada más del navegador.

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MASTER_FX, NO_TRACK_FX } from "@/lib/trackEffects";
import type { ArrangerClip, ArrangerTrack } from "@/lib/arrangerTypes";
import {
  arrangementSignature,
  clearArrangerDraft,
  peekLiveArrangerDraft,
  readStoredArrangerDraft,
  rememberArrangerDraft,
  type ArrangerDraft,
} from "@/lib/arrangerDraft";

// ─── Stub mínimo de localStorage ────────────────────────────────────────

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as unknown as { window: unknown }).window = { localStorage: localStorageStub };

// Un AudioBuffer de mentira: el módulo nunca lo mira, solo tiene que
// NO llegar a JSON.stringify (un AudioBuffer real ahí serializa a `{}`,
// que es peor que fallar porque pasa desapercibido).
const fakeBuffer = { duration: 2, length: 88200 } as unknown as AudioBuffer;

function clip(overrides: Partial<ArrangerClip> = {}): ArrangerClip {
  return {
    id: "clip-1",
    sampleId: "sample-1",
    sampleName: "Kick",
    audioPath: "samples/kick.wav",
    originalBpm: 90,
    sampleType: "Loop",
    startSeconds: 4,
    sourceOffsetSeconds: 0,
    sourceDurationSeconds: 2,
    gain: 1,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    pitchShift: 0,
    buffer: fakeBuffer,
    peaks: new Float32Array([0.1, -0.1]),
    ...overrides,
  };
}

function track(overrides: Partial<ArrangerTrack> = {}): ArrangerTrack {
  return {
    id: "track-1",
    name: "Pista 1",
    volume: 0.8,
    pan: 0,
    isMuted: false,
    isSolo: false,
    clips: [clip()],
    color: "#66FCF1",
    fx: NO_TRACK_FX,
    ...overrides,
  };
}

function draft(overrides: Partial<ArrangerDraft> = {}): ArrangerDraft {
  return {
    projectTitle: "Mi tema",
    projectTempoBpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    tracks: [track()],
    masterFx: DEFAULT_MASTER_FX,
    projectKey: "",
    cloudProjectId: null,
    cloudBaseVersion: null,
    isDirty: true,
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  clearArrangerDraft("u1");
});

describe("firma de contenido", () => {
  it("no cambia porque pase el tiempo ni por el estado de guardado", () => {
    // Si estas dos cosas entraran en la firma, un arreglo intacto
    // figuraría como modificado y el aviso de "sin sincronizar" no
    // significaría nada.
    const a = arrangementSignature(draft({ savedAt: 1, isDirty: true }));
    const b = arrangementSignature(draft({ savedAt: 999_999, isDirty: false }));
    expect(a).toBe(b);
  });

  it("cambia si se mueve un clip", () => {
    const before = arrangementSignature(draft());
    const after = arrangementSignature(
      draft({ tracks: [track({ clips: [clip({ startSeconds: 8 })] })] }),
    );
    expect(after).not.toBe(before);
  });

  it("cambia si se agrega una pista vacía", () => {
    // El caso que motivó todo: pistas sin clips son trabajo igual, y
    // tienen que contar como algo que hay que guardar.
    const before = arrangementSignature(draft());
    const after = arrangementSignature(
      draft({ tracks: [track(), track({ id: "track-2", clips: [] })] }),
    );
    expect(after).not.toBe(before);
  });

  it("NO cambia porque la nube avance de versión", () => {
    // cloudBaseVersion describe qué sabemos de la nube, no lo que el
    // usuario escribió. Si contara, guardar en la nube marcaría el
    // arreglo como modificado justo después de dejarlo a salvo.
    const a = arrangementSignature(draft({ cloudBaseVersion: 1 }));
    const b = arrangementSignature(draft({ cloudBaseVersion: 9 }));
    expect(a).toBe(b);
  });

  it("cambia si se renombra el proyecto o se mueve el tempo", () => {
    const base = arrangementSignature(draft());
    expect(arrangementSignature(draft({ projectTitle: "Otro" }))).not.toBe(base);
    expect(arrangementSignature(draft({ projectTempoBpm: 140 }))).not.toBe(base);
  });
});

describe("capa de localStorage", () => {
  it("vuelve a leer el arreglo sin el audio, pero con todo lo demás", () => {
    rememberArrangerDraft("u1", draft());
    const stored = readStoredArrangerDraft("u1");

    expect(stored).not.toBeNull();
    expect(stored!.projectTitle).toBe("Mi tema");
    expect(stored!.tracks).toHaveLength(1);

    const restored = stored!.tracks[0].clips[0];
    // Lo que no se puede serializar no está...
    expect("buffer" in restored).toBe(false);
    expect("peaks" in restored).toBe(false);
    // ...y lo que permite recuperarlo, sí.
    expect(restored.audioPath).toBe("samples/kick.wav");
    expect(restored.sampleId).toBe("sample-1");
    expect(restored.startSeconds).toBe(4);
    expect(restored.pitchShift).toBe(0);
    expect(restored.gain).toBe(1);
  });

  it("conserva las pistas vacías", () => {
    // Guardar solo las pistas con audio dejaría al usuario exactamente
    // donde estaba: agregó pistas, se fue, no había nada.
    rememberArrangerDraft("u1", draft({ tracks: [track({ clips: [] })] }));
    const stored = readStoredArrangerDraft("u1");
    expect(stored!.tracks).toHaveLength(1);
    expect(stored!.tracks[0].clips).toHaveLength(0);
  });

  it("recuerda qué proyecto de la nube se estaba editando, y en qué versión", () => {
    // El id evita crear un duplicado al guardar; la versión es lo que
    // permite darse cuenta de que la app cambió el proyecto mientras
    // tanto, en vez de pisarlo sin avisar.
    rememberArrangerDraft(
      "u1",
      draft({ cloudProjectId: "proj-abc", cloudBaseVersion: 7 }),
    );
    const stored = readStoredArrangerDraft("u1")!;
    expect(stored.cloudProjectId).toBe("proj-abc");
    expect(stored.cloudBaseVersion).toBe(7);
  });

  it("no ofrece un borrador sin pistas", () => {
    rememberArrangerDraft("u1", draft({ tracks: [] }));
    expect(readStoredArrangerDraft("u1")).toBeNull();
  });

  it("no cruza el borrador entre usuarios", () => {
    rememberArrangerDraft("u1", draft());
    expect(readStoredArrangerDraft("u2")).toBeNull();
  });

  it("sobrevive a un JSON corrupto sin explotar", () => {
    store.set("mystudio.arranger.draft.u1", "{ esto no es json");
    expect(readStoredArrangerDraft("u1")).toBeNull();
  });
});

describe("capa viva", () => {
  it("conserva los AudioBuffer, que es lo que localStorage no puede", () => {
    rememberArrangerDraft("u1", draft());
    const live = peekLiveArrangerDraft();
    expect(live!.tracks[0].clips[0].buffer).toBe(fakeBuffer);
  });

  it("no se consume al leerla", () => {
    // Entrar y salir del Arranger varias veces tiene que seguir
    // encontrando el arreglo.
    rememberArrangerDraft("u1", draft());
    expect(peekLiveArrangerDraft()).not.toBeNull();
    expect(peekLiveArrangerDraft()).not.toBeNull();
  });

  it("descartar limpia las dos capas a la vez", () => {
    rememberArrangerDraft("u1", draft());
    clearArrangerDraft("u1");
    expect(peekLiveArrangerDraft()).toBeNull();
    expect(readStoredArrangerDraft("u1")).toBeNull();
  });
});
