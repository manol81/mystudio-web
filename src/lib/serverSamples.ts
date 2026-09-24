// src/lib/serverSamples.ts
//
// Lectura del Banco de Sonidos DESDE EL SERVIDOR (fichas públicas,
// sitemap), por la API REST de Firestore — mismo criterio y mismos
// motivos que serverCommunity.ts: el SDK de cliente arrastra estado de
// Auth que no tiene sentido en un Server Component, y el Admin SDK
// pediría una service account en Vercel.
//
// `/samples` es de lectura pública en firestore.rules y los audios lo
// son en storage.rules, así que acá no se expone nada que no estuviera
// ya abierto: lo que cambia es que ahora hay HTML que un buscador puede
// leer, en vez de una pantalla que se arma entera con JavaScript.

import { FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, STORAGE_BUCKET } from "@/lib/site";

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export interface PublicSample {
  id: string;
  name: string;
  type: string;
  instrument: string;
  genre: string;
  /// 0 = sin tempo (un One-Shot o un golpe de FX no están en ningún
  /// BPM — ver la carga masiva en CLAUDE.md).
  bpm: number;
  key: string;
  audioPath: string;
  sizeBytes: number;
}

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

function str(fields: Record<string, FirestoreValue> | undefined, key: string): string {
  return fields?.[key]?.stringValue ?? "";
}

function num(fields: Record<string, FirestoreValue> | undefined, key: string): number {
  const value = fields?.[key];
  if (!value) return 0;
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (value.integerValue) return Number(value.integerValue);
  return 0;
}

function toSample(docu: FirestoreDocument): PublicSample {
  return {
    id: docu.name.split("/").at(-1) ?? "",
    name: str(docu.fields, "name") || "Sample",
    type: str(docu.fields, "type"),
    instrument: str(docu.fields, "instrument"),
    genre: str(docu.fields, "genre"),
    bpm: num(docu.fields, "bpm"),
    key: str(docu.fields, "key"),
    audioPath: str(docu.fields, "audioPath"),
    sizeBytes: num(docu.fields, "sizeBytes"),
  };
}

/// La URL de descarga pública del audio. Storage la sirve sin token
/// porque el prefijo `samples/` es de lectura abierta; `alt=media`
/// devuelve los bytes en vez del JSON de metadata.
export function sampleAudioUrl(audioPath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
    audioPath,
  )}?alt=media`;
}

export async function fetchSampleFromServer(sampleId: string): Promise<PublicSample | null> {
  // El id se deriva del nombre del archivo al subirlo (ver
  // scripts/samples.mjs), así que es acotado; igual se valida, porque
  // entra crudo desde la URL.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sampleId)) return null;
  const res = await fetch(`${BASE}/samples/${sampleId}?key=${FIREBASE_WEB_API_KEY}`, {
    next: { revalidate: 3600 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  return toSample((await res.json()) as FirestoreDocument);
}

/// El catálogo completo. Sin `orderBy`: `createdAt` falta en los
/// documentos más viejos, y una consulta ordenada por un campo ausente
/// devuelve MENOS documentos, no más — justo lo contrario de lo que
/// necesita un índice que tiene que listarlos todos.
export async function fetchSamplesFromServer(max = 300): Promise<PublicSample[]> {
  const res = await fetch(`${BASE}/samples?pageSize=${max}&key=${FIREBASE_WEB_API_KEY}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  const body = (await res.json()) as { documents?: FirestoreDocument[] };
  return (body.documents ?? []).map(toSample).filter((s) => s.id.length > 0);
}
