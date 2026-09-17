"use client";

// Panel de administración — subir un sample nuevo al Banco de Sonidos.
//
// Gating: NO alcanza con "hay sesión iniciada" (cualquiera puede
// crearse una cuenta con email/contraseña vía LoginModal — ver
// createUserWithEmailAndPassword ahí). firestore.rules y storage.rules
// para /samples exigen específicamente request.auth.token.admin ==
// true, un custom claim que SOLO se puede setear server-side con el
// Admin SDK (ver scripts/set-admin-claim.mjs) — nunca alcanzable desde
// el cliente, a propósito: si el cliente pudiera auto-otorgárselo, las
// reglas de seguridad no protegerían nada. Esta pantalla verifica ese
// mismo claim (useAdminCheck, compartido con el resto del panel de
// admin) antes de mostrar el formulario, así un usuario logueado sin
// permisos ve un mensaje claro en vez de un formulario que de todas
// formas va a fallar con permission-denied al enviarlo.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { detectTempo, type TempoEstimate } from "@/lib/tempoDetect";
import { detectKey, isKnownSampleKey, type KeyEstimate } from "@/lib/keyDetect";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { deleteObject, ref, uploadBytesResumable } from "firebase/storage";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { useAdminCheck } from "@/lib/useAdminCheck";
import { updateSampleMetadata, type SampleMetadataPatch } from "@/lib/AdminService";
import {
  SAMPLE_TYPES,
  SAMPLE_INSTRUMENTS,
  SAMPLE_GENRES,
  SAMPLE_KEYS,
} from "@/lib/sampleTaxonomy";

interface SampleListItem {
  id: string;
  name: string;
  type: string;
  instrument: string;
  genre: string;
  bpm: number;
  key: string;
  audioPath: string;
}

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

// Mismas clases que inputClasses — un <select> nativo no hereda el
// placeholder/focus ring por defecto, pero sí puede reusar el resto.
const selectClasses = inputClasses;

export default function UploadSamplePage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();

  const [name, setName] = useState("");
  const [type, setType] = useState<string>(SAMPLE_TYPES[0]);
  const [instrument, setInstrument] = useState<string>(SAMPLE_INSTRUMENTS[0]);
  const [genre, setGenre] = useState<string>(SAMPLE_GENRES[0]);
  const [bpm, setBpm] = useState("");
  const [key, setKey] = useState<string>(SAMPLE_KEYS[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Análisis automático del archivo elegido: tempo y tonalidad, medidos
  // sobre el audio. El objetivo es que cargar un sample deje de
  // depender de abrir otra aplicación para medir a mano — que es lento
  // y se equivoca, y un sample con el BPM o la tonalidad mal cargados
  // no rompe nada: simplemente aparece donde no corresponde y
  // desaparece donde sí.
  const [analysis, setAnalysis] = useState<{
    fileName: string;
    durationSeconds: number;
    tempo: TempoEstimate | null;
    key: KeyEstimate | null;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [samples, setSamples] = useState<SampleListItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Edición en el lugar de un sample ya publicado. `editing` es el
  // borrador; mientras haya uno abierto, la lista de arriba se sigue
  // actualizando sola por el onSnapshot y no lo pisa — el borrador vive
  // en su propio estado, no en `samples`.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SampleMetadataPatch | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function startEditing(sample: SampleListItem) {
    setError(null);
    setSuccessMessage(null);
    setEditingId(sample.id);
    setEditing({
      name: sample.name,
      type: sample.type,
      instrument: sample.instrument,
      genre: sample.genre,
      bpm: sample.bpm,
      key: sample.key,
    });
  }

  function cancelEditing() {
    setEditingId(null);
    setEditing(null);
  }

  async function handleSaveEdit(sampleId: string) {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    if (!Number.isFinite(editing.bpm) || editing.bpm < 0) {
      setError("El BPM tiene que ser un número, o 0 si el sample no tiene tempo.");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setSavingId(sampleId);
    try {
      // Solo metadata: el audio no se toca. Por eso editar no pide
      // volver a subir el archivo, que era justamente lo que antes
      // obligaba a borrar el sample entero para corregir un BPM.
      await updateSampleMetadata(sampleId, { ...editing, name: editing.name.trim() });
      setSuccessMessage(`"${editing.name.trim()}" se actualizó.`);
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
    } finally {
      setSavingId(null);
    }
  }

  // Lista de samples ya publicados, para poder borrarlos — solo se
  // suscribe una vez confirmado el claim admin (mismo criterio de
  // gating que el resto de la pantalla).
  useEffect(() => {
    if (adminCheck !== "authorized") return;

    const q = query(collection(db, "samples"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSamples(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) ?? "",
            type: (data.type as string) ?? SAMPLE_TYPES[0],
            instrument: (data.instrument as string) ?? SAMPLE_INSTRUMENTS[0],
            genre: (data.genre as string) ?? SAMPLE_GENRES[0],
            bpm: (data.bpm as number) ?? 0,
            key: (data.key as string) ?? SAMPLE_KEYS[0],
            audioPath: (data.audioPath as string) ?? "",
          };
        }),
      );
    });

    return unsubscribe;
  }, [adminCheck]);

  async function handleDeleteSample(sample: SampleListItem) {
    const confirmed = window.confirm(
      `¿Borrar "${sample.name}" del Banco de Sonidos? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    setError(null);
    setSuccessMessage(null);
    setDeletingId(sample.id);
    try {
      try {
        await deleteObject(ref(storage, sample.audioPath));
      } catch (storageErr) {
        // Si el archivo ya no estaba en Storage (o nunca llegó a subirse
        // del todo), no bloqueamos el borrado del documento — ya no
        // queda nada más que limpiar.
        const code = (storageErr as { code?: string })?.code;
        if (code !== "storage/object-not-found") throw storageErr;
      }
      await deleteDoc(doc(db, "samples", sample.id));
      setSuccessMessage(`"${sample.name}" se borró correctamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el sample.");
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * Analiza el archivo apenas se elige y COMPLETA los campos.
   *
   * Completa en vez de solo sugerir porque el flujo real es cargar
   * muchos samples seguidos: si cada uno pide confirmar dos valores que
   * ya están bien, la función no ahorra tiempo, que era el punto. Lo
   * detectado queda visible arriba del formulario y los campos son
   * editables como siempre.
   *
   * ⚠️ Lo que NO se toca es el tipo, el instrumento ni el género: eso
   * no se puede medir en el audio y adivinarlo sería peor que dejarlo
   * en blanco, porque un valor puesto por el sistema se revisa menos
   * que uno vacío.
   */
  async function handleFileChosen() {
    const file = fileInputRef.current?.files?.[0];
    setAnalysis(null);
    if (!file) return;

    setError(null);
    setIsAnalyzing(true);
    try {
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      void context.close();

      // Mono: quedarse con el canal izquierdo perdería un bombo paneado
      // a la derecha, que es justo lo que más aporta al pulso.
      let mono: Float32Array;
      if (buffer.numberOfChannels === 1) {
        mono = buffer.getChannelData(0);
      } else {
        mono = new Float32Array(buffer.length);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
        }
      }

      const tempo = detectTempo(mono, buffer.sampleRate);
      const detectedKey = detectKey(mono, buffer.sampleRate);
      setAnalysis({
        fileName: file.name,
        durationSeconds: buffer.duration,
        tempo,
        key: detectedKey,
      });

      if (!name.trim()) setName(file.name.replace(/\.(mp3|wav)$/i, ""));
      if (tempo) setBpm(String(Math.round(tempo.bpm * 10) / 10));
      if (detectedKey && isKnownSampleKey(detectedKey.key)) setKey(detectedKey.key);
    } catch (err) {
      // Que el análisis falle no puede impedir subir el sample: los
      // campos siguen estando y se completan a mano, como antes.
      setAnalysis(null);
      setError(
        `No se pudo analizar el archivo${err instanceof Error ? `: ${err.message}` : ""}. ` +
          `Podés cargar el BPM y la tonalidad a mano.`,
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Elegí un archivo de audio (.wav o .mp3).");
      return;
    }
    const lowerName = file.name.toLowerCase();
    const ext = lowerName.endsWith(".mp3") ? "mp3" : lowerName.endsWith(".wav") ? "wav" : null;
    if (!ext) {
      setError("Solo se aceptan archivos .wav o .mp3.");
      return;
    }
    // BPM vacío = sin tempo, igual que en scripts/samples.mjs. Se guarda
    // 0, el valor que el Arranger ya lee como "no estirar".
    const bpmValue = bpm.trim() === "" ? 0 : Number(bpm);
    if (!name.trim() || !Number.isFinite(bpmValue) || bpmValue < 0) {
      setError("Completá el nombre. El BPM dejalo vacío si el sample no tiene tempo.");
      return;
    }

    setIsUploading(true);
    setProgress(0);
    try {
      const docRef = doc(collection(db, "samples"));
      const audioPath = `samples/${docRef.id}/audio.${ext}`;
      const task = uploadBytesResumable(ref(storage, audioPath), file);

      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (snapshot) => setProgress(snapshot.bytesTransferred / snapshot.totalBytes),
          reject,
          resolve,
        );
      });

      await setDoc(docRef, {
        name: name.trim(),
        type,
        instrument,
        genre,
        bpm: bpmValue,
        key,
        audioPath,
        sizeBytes: file.size,
        createdAt: serverTimestamp(),
      });

      setSuccessMessage(`"${name}" se subió correctamente.`);
      setName("");
      setType(SAMPLE_TYPES[0]);
      setInstrument(SAMPLE_INSTRUMENTS[0]);
      setGenre(SAMPLE_GENRES[0]);
      setBpm("");
      setKey(SAMPLE_KEYS[0]);
      setAnalysis(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el sample.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <Link
          href="/admin"
          className="text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          ← Panel de Admin
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Subir <span className="text-neon-cyan">Sample</span>
        </h1>
      </div>

      {adminCheck === "checking" && (
        <p className="text-xs text-white/40">Verificando permisos...</p>
      )}

      {adminCheck === "signed-out" && (
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión desde la página principal para continuar.
        </p>
      )}

      {adminCheck === "unauthorized" && (
        <p className="max-w-sm text-sm text-red-400">
          Tu cuenta ({user?.email}) no tiene permisos de administrador para
          publicar en el Banco de Sonidos.
        </p>
      )}

      {adminCheck === "authorized" && (
        <>
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-8 text-left"
        >
          <div>
            <label className="mb-1.5 block text-xs text-white/60">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
              placeholder="Trap Hi-Hat Loop 01"
              disabled={isUploading}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-white/60">Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={selectClasses}
                disabled={isUploading}
              >
                {SAMPLE_TYPES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-white/60">
                BPM <span className="text-white/30">(vacío si no tiene)</span>
              </label>
              <input
                type="number"
                min={0}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                className={inputClasses}
                placeholder="120"
                disabled={isUploading}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-white/60">
                Instrumento
              </label>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                className={selectClasses}
                disabled={isUploading}
              >
                {SAMPLE_INSTRUMENTS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-white/60">Género</label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className={selectClasses}
                disabled={isUploading}
              >
                {SAMPLE_GENRES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-white/60">Tonalidad</label>
            <select
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={selectClasses}
              disabled={isUploading}
            >
              {SAMPLE_KEYS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-white/60">
              Archivo de audio (.wav / .mp3)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              disabled={isUploading}
              onChange={handleFileChosen}
              className="w-full text-xs text-white/60 file:mr-3 file:rounded-full file:border file:border-neon-cyan/40 file:bg-onyx-black file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-neon-cyan"
            />
          </div>

          {isAnalyzing && (
            <p className="text-xs text-white/50">Analizando el audio...</p>
          )}

          {analysis && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-neon-cyan/25 bg-onyx-black/60 p-3 text-xs">
              <p className="font-semibold text-neon-cyan">
                Detectado en {analysis.durationSeconds.toFixed(2)} s
              </p>

              <p className="text-white/60">
                <span className="text-white/40">Tempo: </span>
                {analysis.tempo ? (
                  <>
                    {Math.round(analysis.tempo.bpm * 10) / 10} BPM
                    {analysis.tempo.bars != null && (
                      <span className="text-white/40">
                        {" "}
                        ({analysis.tempo.bars}{" "}
                        {analysis.tempo.bars === 1 ? "compás" : "compases"} justos)
                      </span>
                    )}
                    {analysis.tempo.confidence < 0.55 && (
                      <span className="text-amber-300/80"> · lectura poco clara</span>
                    )}
                  </>
                ) : (
                  <span className="text-white/40">
                    sin pulso claro — dejá el BPM vacío si no tiene tempo
                  </span>
                )}
              </p>

              <p className="text-white/60">
                <span className="text-white/40">Tonalidad: </span>
                {analysis.key ? (
                  <>
                    {analysis.key.key}
                    {/* La confusión estructural es la relativa: C Major
                        y A Minor tienen las mismas notas y solo las
                        separa el peso de cada una. Ofrecer la segunda a
                        un click es más honesto que afirmar una sola. */}
                    <button
                      type="button"
                      onClick={() => setKey(analysis.key!.alternative)}
                      className="ml-1 text-white/40 underline-offset-2 hover:text-white hover:underline"
                    >
                      (¿{analysis.key.alternative}?)
                    </button>
                    {analysis.key.confidence < 0.15 && (
                      <span className="text-amber-300/80"> · muy parejas</span>
                    )}
                  </>
                ) : (
                  <span className="text-white/40">sin tonalidad definida (percusión o ruido)</span>
                )}
              </p>

              <p className="text-[10px] text-white/30">
                Ya quedaron cargados abajo. Corregilos si hace falta.
              </p>
            </div>
          )}

          {isUploading && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-neon-cyan transition-[width] duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          {successMessage && (
            <p className="text-xs text-neon-cyan">{successMessage}</p>
          )}

          <button
            type="submit"
            disabled={isUploading}
            className="mt-2 rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2.5 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50"
          >
            {isUploading ? `Subiendo... ${Math.round(progress * 100)}%` : "Subir Sample"}
          </button>
        </form>

        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-graphite p-6 text-left">
          <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-white/50">
            Samples publicados ({samples.length})
          </h2>

          {samples.length === 0 ? (
            <p className="mt-3 text-xs text-white/30">
              Todavía no subiste ningún sample.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {samples.map((sample) =>
                editingId === sample.id && editing ? (
                  <li
                    key={sample.id}
                    className="flex flex-col gap-3 rounded-lg border border-neon-cyan/30 bg-onyx-black px-4 py-4"
                  >
                    <div>
                      <label className="mb-1.5 block text-xs text-white/60">Nombre</label>
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className={inputClasses}
                        disabled={savingId === sample.id}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-xs text-white/60">Tipo</label>
                        <select
                          value={editing.type}
                          onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                          className={selectClasses}
                          disabled={savingId === sample.id}
                        >
                          {SAMPLE_TYPES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs text-white/60">
                          BPM <span className="text-white/30">(0 = sin tempo)</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editing.bpm}
                          onChange={(e) =>
                            setEditing({ ...editing, bpm: Number(e.target.value) })
                          }
                          className={inputClasses}
                          disabled={savingId === sample.id}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-xs text-white/60">Instrumento</label>
                        <select
                          value={editing.instrument}
                          onChange={(e) =>
                            setEditing({ ...editing, instrument: e.target.value })
                          }
                          className={selectClasses}
                          disabled={savingId === sample.id}
                        >
                          {SAMPLE_INSTRUMENTS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs text-white/60">Género</label>
                        <select
                          value={editing.genre}
                          onChange={(e) => setEditing({ ...editing, genre: e.target.value })}
                          className={selectClasses}
                          disabled={savingId === sample.id}
                        >
                          {SAMPLE_GENRES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs text-white/60">Tonalidad</label>
                      <select
                        value={editing.key}
                        onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                        className={selectClasses}
                        disabled={savingId === sample.id}
                      >
                        {SAMPLE_KEYS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="text-[11px] text-white/30">
                      El archivo de audio no se toca — solo cambia cómo se lo encuentra.
                    </p>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(sample.id)}
                        disabled={savingId === sample.id}
                        className="rounded-full border border-neon-cyan/40 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan disabled:opacity-50"
                      >
                        {savingId === sample.id ? "Guardando..." : "Guardar"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={savingId === sample.id}
                        className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </li>
                ) : (
                  <li
                    key={sample.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-onyx-black px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{sample.name}</p>
                      <p className="truncate text-xs text-white/40">
                        {[
                          sample.type,
                          sample.instrument,
                          sample.genre,
                          sample.bpm > 0 ? `${Math.round(sample.bpm)} BPM` : null,
                          sample.key && sample.key !== "N/A" ? sample.key : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEditing(sample)}
                        disabled={deletingId === sample.id || editingId !== null}
                        className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70 transition-colors duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan disabled:opacity-40"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSample(sample)}
                        disabled={deletingId === sample.id || editingId !== null}
                        className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 transition-colors duration-200 hover:border-red-400 hover:bg-red-400/10 disabled:opacity-40"
                      >
                        {deletingId === sample.id ? "..." : "Borrar"}
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
        </>
      )}
    </div>
  );
}
