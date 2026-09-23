"use client";

// Editor de efectos del Arranger — por pista y del máster.
//
// ⚠️ Los rangos son los MISMOS que los sliders de la app (ver el diálogo
// de FX en mixer_screen.dart): EQ ±12 dB, umbral -60..0, relación
// 1..20, ganancia 0..+24, envíos y máster 0..1. No son una decisión de
// esta pantalla: un valor que acá se pueda poner y el motor nativo no
// acepte sonaría distinto en el teléfono, que es donde se termina
// escuchando. Si algún día cambia un rango, cambia en los dos lados.
//
// Hasta ahora el Arranger TRANSPORTABA los efectos —los leía del
// .mystudio y los devolvía intactos— pero no los editaba: se podía
// armar un tema entero en la computadora y no se podía mezclar ahí.

import { X } from "lucide-react";
import { DEFAULT_MASTER_FX, NO_TRACK_FX, type MasterFx, type TrackFx } from "@/lib/trackEffects";

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0 text-white/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-neon-cyan"
      />
      <span className="w-16 shrink-0 text-right tabular-nums text-white/70">{display}</span>
    </label>
  );
}

function db(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function TrackFxPanel({
  trackName,
  fx,
  onChange,
  onClose,
}: {
  trackName: string;
  fx: TrackFx;
  onChange: (fx: TrackFx) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<TrackFx>) => onChange({ ...fx, ...patch });

  return (
    <Sheet title={`Efectos — ${trackName || "Pista"}`} onClose={onClose}>
      <Section title="Ecualizador">
        <Slider
          label="Graves"
          value={fx.eqLowDb}
          min={-12}
          max={12}
          step={0.5}
          display={db(fx.eqLowDb)}
          onChange={(v) => set({ eqLowDb: v })}
        />
        <Slider
          label="Medios"
          value={fx.eqMidDb}
          min={-12}
          max={12}
          step={0.5}
          display={db(fx.eqMidDb)}
          onChange={(v) => set({ eqMidDb: v })}
        />
        <Slider
          label="Agudos"
          value={fx.eqHighDb}
          min={-12}
          max={12}
          step={0.5}
          display={db(fx.eqHighDb)}
          onChange={(v) => set({ eqHighDb: v })}
        />
      </Section>

      <Section title="Compresor">
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={fx.compEnabled}
            onChange={(e) => set({ compEnabled: e.target.checked })}
            className="accent-neon-cyan"
          />
          Activado
        </label>
        <Slider
          label="Umbral"
          value={fx.compThresholdDb}
          min={-60}
          max={0}
          step={1}
          display={`${fx.compThresholdDb.toFixed(0)} dB`}
          onChange={(v) => set({ compThresholdDb: v })}
        />
        <Slider
          label="Relación"
          value={fx.compRatio}
          min={1}
          max={20}
          step={0.5}
          display={`${fx.compRatio.toFixed(1)}:1`}
          onChange={(v) => set({ compRatio: v })}
        />
        <Slider
          label="Ganancia"
          value={fx.compMakeupDb}
          min={0}
          max={24}
          step={0.5}
          display={db(fx.compMakeupDb)}
          onChange={(v) => set({ compMakeupDb: v })}
        />
      </Section>

      <Section title="Reverb">
        <Slider
          label="Envío"
          value={fx.reverbSend}
          min={0}
          max={1}
          step={0.01}
          display={percent(fx.reverbSend)}
          onChange={(v) => set({ reverbSend: v })}
        />
        <p className="text-[11px] leading-relaxed text-white/35">
          La reverb es UNA sola, compartida en el máster: cada pista elige cuánto le manda. Su
          tamaño y su nivel se ajustan en Máster.
        </p>
      </Section>

      <button
        type="button"
        onClick={() => onChange({ ...NO_TRACK_FX })}
        className="mt-5 self-start rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
      >
        Restablecer
      </button>
    </Sheet>
  );
}

export function MasterFxPanel({
  fx,
  onChange,
  onClose,
}: {
  fx: MasterFx;
  onChange: (fx: MasterFx) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<MasterFx>) => onChange({ ...fx, ...patch });

  return (
    <Sheet title="Máster" onClose={onClose}>
      <Section title="Reverb">
        <Slider
          label="Tamaño de sala"
          value={fx.reverbRoomSize}
          min={0}
          max={1}
          step={0.01}
          display={percent(fx.reverbRoomSize)}
          onChange={(v) => set({ reverbRoomSize: v })}
        />
        <Slider
          label="Amortiguación"
          value={fx.reverbDamping}
          min={0}
          max={1}
          step={0.01}
          display={percent(fx.reverbDamping)}
          onChange={(v) => set({ reverbDamping: v })}
        />
        <Slider
          label="Nivel de retorno"
          value={fx.reverbWet}
          min={0}
          max={1}
          step={0.01}
          display={percent(fx.reverbWet)}
          onChange={(v) => set({ reverbWet: v })}
        />
        <p className="text-[11px] leading-relaxed text-white/35">
          Solo se escucha si alguna pista le manda algo con su &ldquo;Envío&rdquo; (botón FX de la
          pista).
        </p>
      </Section>

      <Section title="Limitador">
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={fx.limiterEnabled}
            onChange={(e) => set({ limiterEnabled: e.target.checked })}
            className="accent-neon-cyan"
          />
          Activado (techo −1 dB)
        </label>
        <p className="text-[11px] leading-relaxed text-white/35">
          Evita que la mezcla distorsione al pasarse de 0 dB. Conviene dejarlo activo.
        </p>
      </Section>

      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_MASTER_FX })}
        className="mt-5 self-start rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
      >
        Restablecer
      </button>
    </Sheet>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-white/10 bg-graphite p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1 text-white/40 transition-colors hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Los efectos viajan con el proyecto: suenan al exportar y en la app. Para escucharlos acá,
          usá &ldquo;Escuchar con efectos&rdquo;.
        </p>
        {children}
      </div>
    </div>
  );
}
