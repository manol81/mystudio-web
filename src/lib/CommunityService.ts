// src/lib/CommunityService.ts
//
// Servicio de la colección `community_posts` — el feed PÚBLICO de la
// Comunidad (ver firestore.rules: lectura sin sesión, escritura solo
// del propio autor). Distinto del espacio /users/{uid}/projects que
// consume ProjectsDashboard: ese es privado y de sync; este es la
// vidriera pública donde un usuario elige publicar un proyecto ya
// sincronizado.
//
// Paginación por CURSOR, no por número de página: cada lote pide
// startAfter(cursor) sobre el ÚLTIMO doc del lote anterior. El costo de
// traer el lote N es siempre O(pageSize), nunca crece con cuántos
// lotes ya se cargaron, y no se rompe si se publican posts nuevos
// mientras alguien está scrolleando (a diferencia de un offset
// numérico, que se desalinea en ese caso).

import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const COLLECTION_NAME = "community_posts";
const PAGE_SIZE = 8;

export interface CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  projectId: string;
  title: string;
  audioUrl: string;
  genre: string;
  description: string;
  likesCount: number;
  createdAt: Timestamp | null;
}

export interface CommunityPostsPage {
  posts: CommunityPost[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

function toCommunityPost(doc: QueryDocumentSnapshot<DocumentData>): CommunityPost {
  const data = doc.data();
  return {
    id: doc.id,
    authorId: (data.authorId as string) ?? "",
    authorName: (data.authorName as string) ?? "Usuario",
    projectId: (data.projectId as string) ?? "",
    title: (data.title as string) ?? "Sin título",
    audioUrl: (data.audioUrl as string) ?? "",
    genre: (data.genre as string) ?? "",
    description: (data.description as string) ?? "",
    likesCount: (data.likesCount as number) ?? 0,
    createdAt: (data.createdAt as Timestamp) ?? null,
  };
}

/// Trae un lote de `PAGE_SIZE` posts ordenados por fecha descendente.
/// `cursor` null = primer lote; si no, arranca después de ese doc
/// (típicamente el último `.cursor` devuelto por la llamada anterior).
export async function fetchCommunityPostsPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<CommunityPostsPage> {
  const q = cursor
    ? query(
        collection(db, COLLECTION_NAME),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(PAGE_SIZE),
      )
    : query(collection(db, COLLECTION_NAME), orderBy("createdAt", "desc"), limit(PAGE_SIZE));

  const snapshot = await getDocs(q);
  const posts = snapshot.docs.map(toCommunityPost);
  const lastDoc = snapshot.docs.at(-1) ?? null;

  return {
    posts,
    cursor: lastDoc,
    // Heurística estándar de paginación por cursor: si el lote vino
    // completo (== PAGE_SIZE), asumimos que puede haber más y lo
    // confirmamos recién en el próximo pedido; un lote incompleto
    // significa que no queda nada más.
    hasMore: snapshot.docs.length === PAGE_SIZE,
  };
}

export async function publishProjectToCommunity(params: {
  authorId: string;
  authorName: string;
  projectId: string;
  title: string;
  audioUrl: string;
  genre: string;
  description: string;
}): Promise<void> {
  await addDoc(collection(db, COLLECTION_NAME), {
    authorId: params.authorId,
    authorName: params.authorName,
    projectId: params.projectId,
    title: params.title,
    audioUrl: params.audioUrl,
    genre: params.genre,
    description: params.description,
    likesCount: 0,
    createdAt: serverTimestamp(),
  });
}

export function formatRelativeTime(timestamp: Timestamp | null): string {
  if (!timestamp) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp.toDate().getTime()) / 1000));
  if (diffSeconds < 60) return "hace instantes";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `hace ${diffDays} d`;
  return timestamp.toDate().toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
