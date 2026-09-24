// src/lib/serverCommunity.ts
//
// Lectura de community_posts DESDE EL SERVIDOR (generateMetadata,
// sitemap) usando la API REST de Firestore, no el SDK de cliente: el
// SDK arrastra estado de Auth/IndexedDB que no tiene sentido en un
// Server Component, y el Admin SDK necesitaría una service account en
// Vercel. La REST respeta exactamente las mismas reglas de seguridad —
// community_posts es de lectura pública (ver firestore.rules), así que
// alcanza con la API key pública.
//
// Solo lectura, solo campos de texto: nunca se devuelven URLs de audio
// desde acá (eso lo resuelve el cliente con el SDK, como siempre).

import { FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY } from "@/lib/site";

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export interface PublicPostSummary {
  id: string;
  title: string;
  authorName: string;
  genre: string;
  description: string;
  createdAt: Date | null;
}

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  timestampValue?: string;
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

function str(fields: Record<string, FirestoreValue> | undefined, key: string): string {
  return fields?.[key]?.stringValue ?? "";
}

function toSummary(docu: FirestoreDocument): PublicPostSummary {
  const id = docu.name.split("/").at(-1) ?? "";
  const ts = docu.fields?.createdAt?.timestampValue;
  return {
    id,
    title: str(docu.fields, "title") || "Sin título",
    authorName: str(docu.fields, "authorName") || "Usuario",
    genre: str(docu.fields, "genre"),
    description: str(docu.fields, "description"),
    createdAt: ts ? new Date(ts) : null,
  };
}

/// null si el post no existe (404) o el id es inválido.
export async function fetchPostSummaryFromServer(postId: string): Promise<PublicPostSummary | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(postId)) return null;
  const res = await fetch(`${BASE}/community_posts/${postId}?key=${FIREBASE_WEB_API_KEY}`, {
    next: { revalidate: 300 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  return toSummary((await res.json()) as FirestoreDocument);
}

export interface PublicProfileSummary {
  username: string;
  bio: string;
}

/// Perfil público para la metadata de /u/{uid}. public_profiles es de
/// lectura pública igual que community_posts, así que alcanza con la
/// API key. Nunca toca /users/{uid}, que es privado y tiene el email.
export async function fetchPublicProfileFromServer(
  uid: string,
): Promise<PublicProfileSummary | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return null;
  const res = await fetch(`${BASE}/public_profiles/${uid}?key=${FIREBASE_WEB_API_KEY}`, {
    next: { revalidate: 300 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  const docu = (await res.json()) as FirestoreDocument;
  return {
    username: str(docu.fields, "username"),
    bio: str(docu.fields, "bio"),
  };
}

export async function fetchRecentPostIdsFromServer(max: number): Promise<PublicPostSummary[]> {
  const res = await fetch(`${BASE}:runQuery?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "community_posts" }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: max,
      },
    }),
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  const rows = (await res.json()) as Array<{ document?: FirestoreDocument }>;
  return rows.filter((r) => r.document).map((r) => toSummary(r.document!));
}

/// Los uid de los perfiles públicos, para el sitemap: cada `/u/{uid}`
/// es una página indexable (apodo, presentación, publicaciones y
/// colaboraciones de esa persona) y hasta el 2026-09-24 ninguna estaba
/// declarada, así que Google solo las podía descubrir por los links del
/// feed. Sin `orderBy`: la colección no tiene un campo de fecha
/// garantizado en los perfiles viejos, y una consulta que ordena por un
/// campo ausente devuelve MENOS documentos, no más.
export async function fetchPublicProfileIdsFromServer(max: number): Promise<string[]> {
  const res = await fetch(`${BASE}/public_profiles?pageSize=${max}&key=${FIREBASE_WEB_API_KEY}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  const body = (await res.json()) as { documents?: FirestoreDocument[] };
  return (body.documents ?? [])
    .map((docu) => docu.name.split("/").at(-1) ?? "")
    .filter((uid) => uid.length > 0);
}
