"use client";

// "Tono" del clip seleccionado (o de VARIOS) — 2026-10-14.
//
// Reemplaza a dos controles que se pisaban: "Pitch" (semitonos sueltos)
// y "Tono" (que cambiaba la tonalidad DECLARADA del sample, o sea en
// qué tono está grabado, no en cuál suena). Para armar una progresión
// con un mismo loop —C, F, G— había que saber que F son +5 semitonos y
// que el selector de "Tono" no transponía nada. Ahora:
//
//  · "Suena en" elige la tonalidad directamente; la cuenta de
//    semitonos la hace shiftToSoundIn (siempre el camino más corto).
//  · Los botones de ACORDES del tema (I · IV · V) la hacen con un toque,
//    y marcan cuál está sonando.
//  · Con varios clips seleccionados se aplica a TODOS a la vez, cada uno
//    contando desde su propia tonalidad original, en un solo Deshacer.
//  · "Original" queda, más chico y con su nombre: corrige la ficha de un
//    sample (o un audio propio) cuya tonalidad está mal cargada.
//
// Transponer es POR CLIP: el resto de las copias del mismo sample no se
// tocan. Es exactamente lo que hace falta para una progresión.

import type { ArrangerClip } from "@/lib/arrangerTypes";
import {
  chordsForSample,
  shiftToSoundIn,
  soundingKeyOf,
  soundingKeyOptions,
} from "@/lib/clipTransposition";
import {
  keyLabel,
  keysAreCompatible,
  parseSampleKey,
  transposeSemitonesFor,
} from "@/lib/sampleAffinity";
import { SAMPLE_KEYS } from "@/lib/sampleTaxonomy";

const MIN_PITCH = -12;
const MAX_PITCH = 12;

export interface ClipToneUpdate {
  id: string;
  patch: Partial<ArrangerClip>;
}

interface Props {
  clips: ArrangerClip[];
  projectKey: string;
  /** Aplica todos los cambios como UNA acción de deshacer. */
  onApply: (updates: ClipToneUpdate[], label: string) => void;
}

function clampPitch(n: number): number {
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(n)));
}

export default function ClipTonePanel({ clips, projectKey, onApply }: Props) {
  if (clips.length === 0) return null;
  const single = clips.length === 1 ? clips[0] : null;
  const withKey = clips.filter((c) => parseSampleKey(c.sampleKey));
  const reference = withKey[0] ?? null;

  const soundingKeys = clips.map((c) => soundingKeyOf(c.sampleKey, c.pitchShift));
  const commonSounding =
    soundingKeys[0] && soundingKeys.every((k) => k === soundingKeys[0]) ? soundingKeys[0] : "";
  const commonShift = clips.every((c) => c.pitchShift === clips[0].pitchShift)
    ? clips[0].pitchShift
    : null;

  /** Lleva cada clip (con tonalidad conocida) a la raíz [targetPc]. */
  function soundIn(targetPc: number, label: string) {
    const updates = clips.flatMap((c) => {
      const shift = shiftToSoundIn(c.sampleKey, targetPc);
      return shift === null || shift === c.pitchShift ? [] : [{ id: c.id, patch: { pitchShift: shift } }];
    });
    if (updates.length > 0) onApply(updates, label);
  }

  function nudge(delta: number) {
    const updates = clips.flatMap((c) => {
      const next = clampPitch(c.pitchShift + delta);
      return next === c.pitchShift ? [] : [{ id: c.id, patch: { pitchShift: next } }];
    });
    if (updates.length > 0) {
      onApply(updates, delta > 0 ? "Subir un semitono" : "Bajar un semitono");
    }
  }

  const chords = reference ? chordsForSample(projectKey || null, reference.sampleKey) : [];
  // Todos los clips con tonalidad tienen que compartir el MODO para que
  // los acordes ofrecidos signifiquen lo mismo para todos.
  const sameMode = withKey.every(
    (c) => parseSampleKey(c.sampleKey)!.mode === parseSampleKey(reference?.sampleKey)?.mode,
  );
  const options = reference ? soundingKeyOptions(reference.sampleKey) : [];

  // Veredicto "entra / no entra" del modo de antes, solo con UN clip.
  const singleSounding = single ? soundingKeyOf(single.sampleKey, single.pitchShift) : null;
  const canCompare = Boolean(single && projectKey && singleSounding);
  const fits = canCompare && keysAreCompatible(projectKey, singleSounding);
  const missing = canCompare ? transposeSemitonesFor(projectKey, singleSounding) : 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/15 px-3 py-1.5">
      <span
        className="text-[10px] text-white/40"
        title="En qué tonalidad suena el clip. Cambiarlo transpone SOLO los clips seleccionados."
      >
        {clips.length > 1 ? `Tono (${clips.length} clips)` : "Tono"}
      </span>

      {/* Suena en: la tonalidad directa, sin pensar en semitonos. */}
      <select
        aria-label="Suena en"
        title={reference ? "Elegí en qué tono querés que suene" : "Primero indicá el tono original del clip"}
        disabled={!reference || !sameMode}
        value={commonSounding}
        onChange={(e) => {
          const parsed = parseSampleKey(e.target.value);
          if (parsed) soundIn(parsed.pitchClass, `Llevar a ${keyLabel(e.target.value)}`);
        }}
        className="rounded-lg border border-neon-cyan/40 bg-onyx-black px-1.5 py-1 text-[11px] font-semibold text-neon-cyan outline-none focus:border-neon-cyan disabled:border-white/15 disabled:text-white/40"
      >
        {!commonSounding && <option value="">{reference ? "varios" : "—"}</option>}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {keyLabel(o.key)} ({o.shift > 0 ? "+" : ""}
            {o.shift} st)
          </option>
        ))}
      </select>

      {/* Ajuste fino en semitonos, para lo que no es "un tono". */}
      <button
        type="button"
        onClick={() => nudge(-1)}
        title="Bajar un semitono"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] leading-none text-white/70 hover:bg-white/20"
      >
        −
      </button>
      <span className="w-9 text-center text-[10px] tabular-nums text-white/50">
        {commonShift === null ? "±" : `${commonShift > 0 ? "+" : ""}${commonShift} st`}
      </span>
      <button
        type="button"
        onClick={() => nudge(1)}
        title="Subir un semitono"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] leading-none text-white/70 hover:bg-white/20"
      >
        +
      </button>

      {/* Acordes del tema que este sample puede tocar. */}
      {chords.length > 0 && sameMode && (
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          <span
            className="text-[10px] text-white/40"
            title={`Acordes de ${keyLabel(projectKey)} que este sample puede tocar sin cambiar su carácter (mayor o menor)`}
          >
            Acordes de {keyLabel(projectKey)}
          </span>
          {chords.map((chord) => {
            const active = commonSounding !== "" && parseSampleKey(commonSounding)?.pitchClass === chord.pitchClass;
            return (
              <button
                key={chord.degree}
                type="button"
                onClick={() => soundIn(chord.pitchClass, `Acorde ${chord.degree} (${keyLabel(chord.key)})`)}
                title={`Que suene en ${keyLabel(chord.key)}`}
                className={
                  active
                    ? "rounded-full border border-neon-cyan bg-neon-cyan/15 px-2 py-0.5 text-[10px] font-semibold text-neon-cyan"
                    : "rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/70 hover:border-neon-cyan/60 hover:text-neon-cyan"
                }
              >
                {chord.degree} · {keyLabel(chord.key)?.replace(" maj", "").replace(" min", "m")}
              </button>
            );
          })}
        </div>
      )}
      {!projectKey && reference && (
        <span className="text-[10px] text-white/30">elegí el tono del tema arriba para ver sus acordes</span>
      )}

      {/* La tonalidad ORIGINAL: corrige la ficha, no transpone. */}
      {single && (
        <label className="flex items-center gap-1 border-l border-white/10 pl-2">
          <span
            className="text-[10px] text-white/30"
            title="En qué tono está GRABADO el sample. Cambiarlo no transpone: corrige el dato si estaba mal."
          >
            Original
          </span>
          <select
            value={single.sampleKey}
            onChange={(e) => onApply([{ id: single.id, patch: { sampleKey: e.target.value } }], "Corregir el tono original")}
            className="rounded-lg border border-white/15 bg-onyx-black px-1 py-0.5 text-[10px] text-white/70 outline-none focus:border-neon-cyan"
          >
            <option value="">—</option>
            {SAMPLE_KEYS.filter((k) => k !== "N/A").map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </label>
      )}

      {canCompare &&
        (fits ? (
          <span className="text-[10px] font-semibold text-emerald-400">entra en {keyLabel(projectKey)}</span>
        ) : (
          <>
            <span className="text-[10px] font-semibold text-amber-300">no entra en {keyLabel(projectKey)}</span>
            {missing !== 0 && single && (
              <button
                type="button"
                onClick={() =>
                  onApply(
                    [{ id: single.id, patch: { pitchShift: clampPitch(single.pitchShift + missing) } }],
                    "Adaptar al tono del tema",
                  )
                }
                title="El desplazamiento más chico que lo vuelve compatible"
                className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] text-amber-200 hover:border-amber-300"
              >
                Adaptar {missing > 0 ? "+" : ""}
                {missing} st
              </button>
            )}
          </>
        ))}
    </div>
  );
}
