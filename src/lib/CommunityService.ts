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
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
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
  // Preview liviano (MP3, ver audioPreviewExport.ts) — null hasta que
  // termine de generarse/subirse tras publicar (ver PublishModal.tsx).
  // El feed cae de vuelta al .mystudio completo (audioUrl, vía
  // ProjectViewer) mientras tanto o si el preview nunca llegó a
  // generarse por algún error.
  audioPreviewUrl: string | null;
  previewDurationSeconds: number | null;
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
    audioPreviewUrl: (data.audioPreviewUrl as string) ?? null,
    previewDurationSeconds: (data.previewDurationSeconds as number) ?? null,
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

/// Devuelve el id del post recién creado — hace falta para poder subir
/// el preview DESPUÉS (el path de Storage y la regla que lo protege
/// dependen de que el doc ya exista, ver storage.rules), no antes.
export async function publishProjectToCommunity(params: {
  authorId: string;
  authorName: string;
  projectId: string;
  title: string;
  audioUrl: string;
  genre: string;
  description: string;
}): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    authorId: params.authorId,
    authorName: params.authorName,
    projectId: params.projectId,
    title: params.title,
    audioUrl: params.audioUrl,
    audioPreviewUrl: null,
    previewDurationSeconds: null,
    genre: params.genre,
    description: params.description,
    likesCount: 0,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/// Adjunta el preview liviano a un post ya publicado — paso separado
/// porque la generación (descargar + mezclar + codificar) puede tardar
/// unos segundos y, si falla, el post ya publicado sigue funcionando
/// igual (cae de vuelta al .mystudio completo, ver CommunityPost).
export async function attachCommunityPreview(
  postId: string,
  audioPreviewUrl: string,
  previewDurationSeconds: number,
): Promise<void> {
  await updateDoc(doc(db, COLLECTION_NAME, postId), { audioPreviewUrl, previewDurationSeconds });
}

// ─── Moderación — reportar publicaciones y bloquear autores ─────────────
//
// Dos mecanismos DISTINTOS a propósito: reportar (colección global
// `reports`, de solo-escritura para el cliente — la revisión es manual)
// avisa al equipo sin ocultar nada; bloquear (subcolección PRIVADA
// `users/{uid}/blockedUsers`) es una preferencia personal e inmediata
// del que bloquea, no depende de que nadie revise nada. Ver
// firestore.rules para las reglas de cada una.

export const REPORT_REASONS = [
  { value: "copyright", label: "Derechos de autor" },
  { value: "spam", label: "Spam" },
  { value: "abuse", label: "Contenido ofensivo o abusivo" },
  { value: "other", label: "Otro motivo" },
] as const;

export async function reportPost(params: {
  postId: string;
  reportedAuthorId: string;
  reporterId: string;
  reason: string;
  details: string;
}): Promise<void> {
  await addDoc(collection(db, "reports"), {
    postId: params.postId,
    reportedAuthorId: params.reportedAuthorId,
    reporterId: params.reporterId,
    reason: params.reason,
    details: params.details,
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

export async function blockUser(uid: string, blockedUid: string): Promise<void> {
  await setDoc(doc(db, "users", uid, "blockedUsers", blockedUid), {
    blockedAt: serverTimestamp(),
  });
}

/// Se lee UNA vez al cargar el feed (ver page.tsx) — no hace falta
/// tiempo real acá, un bloqueo hecho en OTRA pestaña/sesión recién se
/// refleja la próxima vez que se entra a la Comunidad.
export async function fetchBlockedAuthorIds(uid: string): Promise<Set<string>> {
  const snapshot = await getDocs(collection(db, "users", uid, "blockedUsers"));
  return new Set(snapshot.docs.map((d) => d.id));
}

// ─── Me gusta ─────────────────────────────────────────────────────────
//
// Un doc por usuario en community_posts/{postId}/likes/{uid} — su
// existencia ES el like. La transacción crea/borra ese doc y ajusta
// likesCount en el mismo paso atómico (ver firestore.rules: la regla
// de `update` exige que ambos writes queden en sincronía exacta, así
// que si esta transacción no incluyera el doc de like, el ajuste de
// likesCount sería directamente rechazado por el servidor).
export async function toggleLike(postId: string, uid: string): Promise<boolean> {
  const postRef = doc(db, COLLECTION_NAME, postId);
  const likeRef = doc(db, COLLECTION_NAME, postId, "likes", uid);
  return runTransaction(db, async (tx) => {
    const likeSnap = await tx.get(likeRef);
    if (likeSnap.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likesCount: increment(-1) });
      return false;
    }
    tx.set(likeRef, { likedAt: serverTimestamp() });
    tx.update(postRef, { likesCount: increment(1) });
    return true;
  });
}

/// Para un lote de posts (típicamente una página del feed), qué
/// subconjunto ya tiene like del usuario actual — un read por post,
/// en paralelo. Se pide una sola vez por lote cargado, no en tiempo
/// real (ver page.tsx).
export async function fetchLikedPostIds(uid: string, postIds: string[]): Promise<Set<string>> {
  const results = await Promise.all(
    postIds.map(async (postId) => {
      const snap = await getDoc(doc(db, COLLECTION_NAME, postId, "likes", uid));
      return snap.exists() ? postId : null;
    }),
  );
  return new Set(results.filter((id): id is string => id !== null));
}

// ─── Comentarios ──────────────────────────────────────────────────────
//
// Subcolección community_posts/{postId}/comments/{commentId} — mismo
// criterio que `likes`: lectura pública, escritura exclusiva del
// propio autor del comentario (ver firestore.rules). `timestampInAudio`
// es opcional: si el usuario comentó con el preview reproduciéndose y
// eligió "anclar", queda un segundo exacto del audio; si no, el
// comentario es general (null) — ver CommentsModal.tsx.

export interface PostComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestampInAudio: number | null;
  createdAt: Timestamp | null;
}

function toPostComment(doc: QueryDocumentSnapshot<DocumentData>): PostComment {
  const data = doc.data();
  return {
    id: doc.id,
    authorId: (data.authorId as string) ?? "",
    authorName: (data.authorName as string) ?? "Usuario",
    text: (data.text as string) ?? "",
    timestampInAudio: (data.timestampInAudio as number) ?? null,
    createdAt: (data.createdAt as Timestamp) ?? null,
  };
}

/// Orden cronológico simple (más viejo primero, como cualquier hilo de
/// comentarios) — un post nunca tiene TANTOS comentarios como para que
/// esto necesite paginación propia, a diferencia del feed en sí.
export async function fetchComments(postId: string): Promise<PostComment[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTION_NAME, postId, "comments"), orderBy("createdAt", "asc")),
  );
  return snapshot.docs.map(toPostComment);
}

export async function addComment(
  postId: string,
  params: { authorId: string; authorName: string; text: string; timestampInAudio: number | null },
): Promise<void> {
  await addDoc(collection(db, COLLECTION_NAME, postId, "comments"), {
    authorId: params.authorId,
    authorName: params.authorName,
    text: params.text,
    timestampInAudio: params.timestampInAudio,
    createdAt: serverTimestamp(),
  });
}

/// Para un lote de posts, cuántos comentarios tiene cada uno —
/// getCountFromServer factura como UNA lectura sin importar cuántos
/// documentos haya, no hace falta bajarlos todos solo para mostrar un
/// número en la tarjeta del feed.
export async function fetchCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  const entries = await Promise.all(
    postIds.map(async (postId) => {
      const snap = await getCountFromServer(collection(db, COLLECTION_NAME, postId, "comments"));
      return [postId, snap.data().count] as const;
    }),
  );
  return new Map(entries);
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
