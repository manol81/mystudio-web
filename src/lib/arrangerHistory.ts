"use client";

// El estado del arreglo, con historial de deshacer/rehacer.
//
// Hasta acá esto vivía como siete `useState` sueltos adentro de un
// componente de 3000 líneas, y cada edición los pisaba sin dejar
// rastro: borrar un clip, recortarlo de más o arrastrarlo sin querer no
// se podía volver atrás de ninguna forma. En una herramienta cuyo flujo
// entero es probar y descartar, eso es lo que más frena.
//
// ─── Por qué esto es barato, y no una copia del arreglo entero ────────
//
// Podría parecer que guardar N versiones del arreglo significa guardar
// N veces el audio. No: `ArrangerClip.buffer` es una REFERENCIA a un
// AudioBuffer compartido, y todas las operaciones de arrangerOperations
// son inmutables (devuelven objetos nuevos reusando los que no
// cambiaron). Una entrada de historial cuesta unos pocos objetos, no
// megabytes de PCM. Por eso se puede permitir un historial profundo.
//
// ─── Los tres modos de commit, y por qué hacen falta los tres ─────────
//
// · **push** — lo normal: una acción del usuario que tiene que poder
//   deshacerse, con su etiqueta ("Mover clip", "Cortar clip") para que
//   el botón diga qué va a deshacer.
// · **silent** — cambia el presente SIN tocar el historial. Es para lo
//   que no hizo el usuario: la importación revela las pistas de a una
//   para que se vean aparecer, y los picos de cada clip se calculan
//   después en su propio tick. Sin esto, deshacer caminaría hacia atrás
//   pista por pista y forma de onda por forma de onda.
// · **reset** — este estado pasa a ser la nueva base y el historial se
//   vacía. Para cuando se carga OTRO arreglo (abrir un .mystudio,
//   recuperar un borrador, crear un proyecto nuevo): deshacer ahí
//   debería devolver al arreglo anterior, que ya no existe.
//
// ─── Fusión de commits ────────────────────────────────────────────────
//
// Un fader de volumen dispara un cambio por cada píxel que se mueve. Si
// cada uno fuera una entrada, deshacer una vez retrocedería un píxel y
// el historial se llenaría de basura. Los commits consecutivos con la
// misma `coalesceKey` dentro de una ventana corta REEMPLAZAN al
// anterior en vez de apilarse, así todo el arrastre queda como una sola
// acción — que es como el usuario lo vivió.

import { useCallback, useMemo, useReducer } from "react";
import type { MasterFx } from "@/lib/trackEffects";
import type { ArrangerTrack } from "@/lib/arrangerTypes";

/// Todo lo que el usuario puede cambiar y querría poder deshacer.
///
/// A propósito NO incluye `cloudProjectId`, `cloudBaseVersion` ni
/// `isDirty`: describen la relación con la nube, no el contenido del
/// arreglo. Deshacer no tiene por qué desvincular un proyecto de su
/// documento en Firestore. Es el mismo corte que ya hacía
/// `arrangementSignature`.
export interface ArrangementState {
  projectTitle: string;
  projectTempoBpm: number;
  projectKey: string;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  masterFx: MasterFx;
  tracks: ArrangerTrack[];
}

export type CommitMode =
  | { kind: "push"; label: string; coalesceKey?: string }
  | { kind: "silent" }
  | { kind: "reset" };

/** Azúcar para el caso normal. */
export function push(label: string, coalesceKey?: string): CommitMode {
  return { kind: "push", label, coalesceKey };
}

export const SILENT: CommitMode = { kind: "silent" };
export const RESET: CommitMode = { kind: "reset" };

/// Cuánto dura la ventana de fusión. 700 ms es más que la pausa entre
/// dos movimientos de un fader y menos que la pausa entre dos acciones
/// distintas de una persona.
const COALESCE_WINDOW_MS = 700;

/// Tope del historial. Con entradas tan baratas (ver el encabezado) el
/// límite existe para que una sesión de horas no crezca sin fin, no
/// porque duela guardarlas.
const MAX_HISTORY = 200;

interface HistoryState {
  past: { state: ArrangementState; label: string }[];
  present: ArrangementState;
  future: { state: ArrangementState; label: string }[];
  /// Para fusionar: qué se commiteó último y cuándo.
  lastCoalesceKey: string | null;
  lastCommitAt: number;
}

type HistoryAction =
  | { type: "commit"; recipe: (prev: ArrangementState) => ArrangementState; mode: CommitMode }
  | { type: "undo" }
  | { type: "redo" };

function initialHistory(present: ArrangementState): HistoryState {
  return { past: [], present, future: [], lastCoalesceKey: null, lastCommitAt: 0 };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit": {
      const next = action.recipe(state.present);
      // Una receta que no cambió nada (arrastrar un clip y soltarlo
      // donde estaba) no tiene por qué ensuciar el historial.
      if (next === state.present) return state;

      if (action.mode.kind === "silent") {
        return { ...state, present: next };
      }
      if (action.mode.kind === "reset") {
        return initialHistory(next);
      }

      const now = Date.now();
      const coalesces =
        action.mode.coalesceKey !== undefined &&
        action.mode.coalesceKey === state.lastCoalesceKey &&
        now - state.lastCommitAt < COALESCE_WINDOW_MS &&
        state.past.length > 0;

      if (coalesces) {
        // Se reemplaza el presente y se deja el pasado intacto: el
        // punto al que va a volver "deshacer" sigue siendo el de antes
        // de que arrancara el arrastre.
        return { ...state, present: next, lastCommitAt: now };
      }

      const past = [...state.past, { state: state.present, label: action.mode.label }];
      return {
        past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
        present: next,
        // Cualquier edición nueva invalida lo que se había deshecho: es
        // el comportamiento de todos los editores, y la alternativa
        // (mantener una rama) no se puede explicar en una barra de
        // herramientas.
        future: [],
        lastCoalesceKey: action.mode.coalesceKey ?? null,
        lastCommitAt: now,
      };
    }

    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous.state,
        future: [{ state: state.present, label: previous.label }, ...state.future],
        // Se corta la fusión: si no, el próximo movimiento de un fader
        // se fusionaría con lo que acabamos de deshacer.
        lastCoalesceKey: null,
        lastCommitAt: 0,
      };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, { state: state.present, label: next.label }],
        present: next.state,
        future: state.future.slice(1),
        lastCoalesceKey: null,
        lastCommitAt: 0,
      };
    }
  }
}

export interface ArrangementHistory {
  state: ArrangementState;
  commit: (recipe: (prev: ArrangementState) => ArrangementState, mode?: CommitMode) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Qué va a deshacer, para el tooltip del botón. */
  undoLabel: string | null;
  redoLabel: string | null;
}

export function useArrangementHistory(initial: ArrangementState): ArrangementHistory {
  const [history, dispatch] = useReducer(historyReducer, initial, initialHistory);

  const commit = useCallback(
    (recipe: (prev: ArrangementState) => ArrangementState, mode: CommitMode = push("Editar")) => {
      dispatch({ type: "commit", recipe, mode });
    },
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return useMemo(
    () => ({
      state: history.present,
      commit,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undoLabel: history.past[history.past.length - 1]?.label ?? null,
      redoLabel: history.future[0]?.label ?? null,
    }),
    [history, commit, undo, redo],
  );
}
