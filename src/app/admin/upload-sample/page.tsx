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
import {
  SAMPLE_TYPES,
  SAMPLE_INSTRUMENTS,
  SAMPLE_GENRES,
  SAMPLE_KEYS,
} from "@/lib/sampleTaxonomy";

interface SampleListItem {
  id: string;
  name: string;
  instrument: string;
  genre: string;
  bpm: number;
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

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [samples, setSamples] = useState<SampleListItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
            instrument: (data.instrument as string) ?? "",
            genre: (data.genre as string) ?? "",
            bpm: (data.bpm as number) ?? 0,
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
    const bpmValue = Number(bpm);
    if (!name.trim() || !bpmValue) {
      setError("Completá nombre y BPM.");
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
              <label className="mb-1.5 block text-xs text-white/60">BPM</label>
              <input
                type="number"
                min={1}
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
              className="w-full text-xs text-white/60 file:mr-3 file:rounded-full file:border file:border-neon-cyan/40 file:bg-onyx-black file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-neon-cyan"
            />
          </div>

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

        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-6 text-left">
          <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-white/50">
            Samples publicados ({samples.length})
          </h2>

          {samples.length === 0 ? (
            <p className="mt-3 text-xs text-white/30">
              Todavía no subiste ningún sample.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {samples.map((sample) => (
                <li
                  key={sample.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-onyx-black px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{sample.name}</p>
                    <p className="truncate text-xs text-white/40">
                      {[
                        sample.instrument,
                        sample.genre,
                        `${Math.round(sample.bpm)} BPM`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSample(sample)}
                    disabled={deletingId === sample.id}
                    className="shrink-0 rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 transition-colors duration-200 hover:border-red-400 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    {deletingId === sample.id ? "..." : "Borrar"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
      )}
    </div>
  );
}
