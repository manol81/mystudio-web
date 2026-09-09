// src/lib/NotificationsService.ts
//
// Notificaciones de la Comunidad SIN backend: hasta ahora, si alguien
// comentaba tu tema no te enterabas nunca, y la Bandeja de Entrada era
// una pantalla vacía. Publicar y no recibir señal de vuelta es la razón
// principal por la que nadie volvía al feed.
//
// No hay Cloud Functions en este proyecto (decisión consciente, ver
// CLAUDE.md), así que no existe nada que escriba una notificación
// cuando ocurre el evento. En vez de eso, las notificaciones se
// DERIVAN con una consulta del propio usuario: "comentarios y me gusta
// que recibieron mis publicaciones". Para que eso sea UNA consulta y
// no una por publicación, cada comentario y cada like guardan
// `postAuthorId` denormalizado — validado en firestore.rules contra el
// autor real del post, así que nadie puede dirigirle una notificación
// falsa a otra persona.
//
// El estado "leído" es una sola marca de tiempo en el perfil
// (`notificationsSeenAt`): todo lo posterior a esa fecha está sin leer.
// No se guarda estado por notificación a propósito — sería una
// escritura por cada una, y para este tamaño de comunidad no aporta
// nada sobre una única marca.

import {
  collectionGroup,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/// Tope de notificaciones que se traen. Más que esto no aporta: quien
/// tenga cientos sin leer necesita entrar al feed, no una lista larga.
const MAX_NOTIFICATIONS = 50;

export type NotificationKind = "comment" | "like";

export interface CommunityNotification {
  id: string;
  kind: NotificationKind;
  postId: string;
  /// Título del post en el momento de leer la notificación, no el que
  /// tenía cuando ocurrió: se lee del post, así que si el autor lo
  /// renombró, la notificación muestra el nombre actual.
  postTitle: string;
  actorName: string;
  actorId: string;
  createdAt: Date | null;
  /// Solo para comentarios: el texto, recortado por la UI.
  text?: string;
  /// Solo para comentarios anclados: segundo del audio al que apuntan.
  timestampInAudio?: number | null;
  isUnread: boolean;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

/// Trae las notificaciones del usuario, más nuevas primero. Excluye lo
/// que hizo uno mismo: comentar en tu propio tema o darte like no es
/// una novedad.
export async function fetchNotifications(
  uid: string,
  seenAt: Date | null,
): Promise<CommunityNotification[]> {
  const [commentsSnap, likesSnap] = await Promise.all([
    getDocs(
      query(
        collectionGroup(db, "comments"),
        where("postAuthorId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(MAX_NOTIFICATIONS),
      ),
    ),
    getDocs(
      query(
        collectionGroup(db, "likes"),
        where("postAuthorId", "==", uid),
        orderBy("likedAt", "desc"),
        limit(MAX_NOTIFICATIONS),
      ),
    ),
  ]);

  const raw: Omit<CommunityNotification, "postTitle" | "isUnread">[] = [];

  for (const d of commentsSnap.docs) {
    const data = d.data();
    if (data.authorId === uid) continue;
    // La subcolección cuelga del post: el padre del padre es el doc.
    const postId = d.ref.parent.parent?.id;
    if (!postId) continue;
    raw.push({
      id: d.id,
      kind: "comment",
      postId,
      actorName: (data.authorName as string) ?? "Alguien",
      actorId: (data.authorId as string) ?? "",
      createdAt: toDate(data.createdAt),
      text: (data.text as string) ?? "",
      timestampInAudio: (data.timestampInAudio as number | null) ?? null,
    });
  }

  for (const d of likesSnap.docs) {
    const data = d.data();
    // En likes el id del documento ES el uid de quien lo dio.
    if (d.id === uid) continue;
    const postId = d.ref.parent.parent?.id;
    if (!postId) continue;
    raw.push({
      id: `like_${postId}_${d.id}`,
      kind: "like",
      postId,
      // El like no guarda el nombre de quien lo dio: guardarlo sería
      // otro dato denormalizado que se desactualiza al cambiar el
      // apodo, y para "le gustó tu tema" el quién importa menos que el
      // qué. Ver la nota de propagateUsername en UserProfileService.
      actorName: "",
      actorId: d.id,
      createdAt: toDate(data.likedAt),
    });
  }

  raw.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const top = raw.slice(0, MAX_NOTIFICATIONS);

  // El título se lee del post, una vez por post distinto: son pocas
  // lecturas y así el título nunca queda viejo.
  const titles = new Map<string, string>();
  await Promise.all(
    [...new Set(top.map((n) => n.postId))].map(async (postId) => {
      try {
        const snap = await getDoc(doc(db, "community_posts", postId));
        titles.set(postId, snap.exists() ? ((snap.data().title as string) ?? "") : "");
      } catch {
        titles.set(postId, "");
      }
    }),
  );

  const seenMillis = seenAt?.getTime() ?? 0;
  return top.map((n) => ({
    ...n,
    postTitle: titles.get(n.postId) || "una publicación tuya",
    isUnread: (n.createdAt?.getTime() ?? 0) > seenMillis,
  }));
}

/// Cuántas novedades sin leer hay, para el indicador del menú. Usa el
/// contador del servidor en vez de traer los documentos: son dos
/// lecturas en vez de cien, y acá solo hace falta el número.
///
/// Aproximación consciente: incluye lo que uno mismo haya comentado en
/// sus propios temas, porque filtrar eso exigiría traer los documentos.
/// La lista de la Bandeja de Entrada sí los excluye, así que como mucho
/// el número aparece un punto más alto que la lista.
export async function countUnreadNotifications(
  uid: string,
  seenAt: Date | null,
): Promise<number> {
  const since = seenAt ? Timestamp.fromDate(seenAt) : Timestamp.fromMillis(0);
  const [comments, likes] = await Promise.all([
    getCountFromServer(
      query(
        collectionGroup(db, "comments"),
        where("postAuthorId", "==", uid),
        where("createdAt", ">", since),
      ),
    ),
    getCountFromServer(
      query(
        collectionGroup(db, "likes"),
        where("postAuthorId", "==", uid),
        where("likedAt", ">", since),
      ),
    ),
  ]);
  return comments.data().count + likes.data().count;
}

/// Marca todo como leído. Se llama al abrir la Bandeja de Entrada.
export async function markNotificationsSeen(uid: string): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { notificationsSeenAt: serverTimestamp() },
    { merge: true },
  );
}
