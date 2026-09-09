// src/lib/PublicProfileService.ts
//
// Perfil PÚBLICO de un usuario: su vidriera en la Comunidad. Vive en
// `/public_profiles/{uid}`, una colección aparte de `/users/{uid}`
// porque ese doc es privado y guarda el email — y Firestore no sabe
// exponer solo algunos campos de un documento, la lectura es todo o
// nada. Acá va únicamente lo que la persona decide mostrar.
//
// El apodo no se guarda suelto: firestore.rules exige que coincida con
// el del perfil privado, que sigue siendo la fuente de verdad y el
// mismo valor que viaja denormalizado como authorName en cada
// publicación (ver propagateUsername en UserProfileService.ts).
//
// El contador de seguidores lo mueve QUIEN SIGUE, no el dueño del
// perfil, con la misma mecánica que likesCount en las publicaciones:
// una transacción que crea o borra el documento de seguidor y ajusta el
// número de a uno. Las reglas verifican que las dos cosas coincidan, así
// que nadie puede inflarse los seguidores.

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export const MAX_BIO_LENGTH = 300;

export interface PublicProfile {
  uid: string;
  username: string;
  bio: string;
  followersCount: number;
}

/// Publicación de la Comunidad, en la forma mínima que necesita el
/// perfil para listarla. No trae el audio: eso lo resuelve el
/// permalink al abrirla.
export interface ProfilePost {
  id: string;
  title: string;
  genre: string;
  likesCount: number;
  createdAt: Date | null;
  /// Nombre con el que publicó. Sirve de respaldo para el encabezado
  /// del perfil cuando la persona todavía no guardó su perfil público:
  /// así la página funciona desde el día uno, sin configurar nada.
  authorName: string;
}

/// Un comentario que esta persona dejó en alguna publicación, para la
/// pestaña de actividad.
export interface ProfileActivity {
  id: string;
  postId: string;
  text: string;
  createdAt: Date | null;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

export async function fetchPublicProfile(uid: string): Promise<PublicProfile | null> {
  const snap = await getDoc(doc(db, "public_profiles", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    uid,
    username: (data.username as string) ?? "",
    bio: (data.bio as string) ?? "",
    followersCount: (data.followersCount as number) ?? 0,
  };
}

/// Crea o actualiza el perfil público. Se llama al elegir apodo y al
/// editar la presentación. `username` tiene que ser el mismo del perfil
/// privado o las reglas rechazan la escritura.
export async function savePublicProfile(
  uid: string,
  params: { username: string; bio: string },
): Promise<void> {
  const ref = doc(db, "public_profiles", uid);
  const existing = await getDoc(ref);
  const payload: Record<string, unknown> = {
    username: params.username,
    bio: params.bio.slice(0, MAX_BIO_LENGTH),
    updatedAt: serverTimestamp(),
  };
  // followersCount solo se manda al crear: en un update las reglas
  // exigen que no cambie, y mandarlo con el valor viejo sería pisar una
  // cuenta que pudo moverse entre la lectura y la escritura.
  if (!existing.exists()) payload.followersCount = 0;
  await setDoc(ref, payload, { merge: true });
}

export async function fetchProfilePosts(uid: string, max = 30): Promise<ProfilePost[]> {
  const snap = await getDocs(
    query(
      collection(db, "community_posts"),
      where("authorId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: (data.title as string) ?? "",
      genre: (data.genre as string) ?? "",
      likesCount: (data.likesCount as number) ?? 0,
      createdAt: toDate(data.createdAt),
      authorName: (data.authorName as string) ?? "",
    };
  });
}

export async function fetchProfileActivity(uid: string, max = 20): Promise<ProfileActivity[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, "comments"),
      where("authorId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  const items: ProfileActivity[] = [];
  for (const d of snap.docs) {
    const postId = d.ref.parent.parent?.id;
    if (!postId) continue;
    items.push({
      id: d.id,
      postId,
      text: (d.data().text as string) ?? "",
      createdAt: toDate(d.data().createdAt),
    });
  }
  return items;
}

export async function isFollowing(targetUid: string, followerUid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "public_profiles", targetUid, "followers", followerUid));
  return snap.exists();
}

/// Sigue o deja de seguir, y ajusta el contador en la misma
/// transacción. Devuelve el estado nuevo.
export async function toggleFollow(targetUid: string, followerUid: string): Promise<boolean> {
  const profileRef = doc(db, "public_profiles", targetUid);
  const followerRef = doc(db, "public_profiles", targetUid, "followers", followerUid);
  return runTransaction(db, async (tx) => {
    const followerSnap = await tx.get(followerRef);
    if (followerSnap.exists()) {
      tx.delete(followerRef);
      tx.update(profileRef, { followersCount: increment(-1) });
      return false;
    }
    // followerUid duplicado adentro del doc a propósito: ver el
    // comentario en firestore.rules. Es lo que permite la consulta
    // "a quiénes sigo" para el feed.
    tx.set(followerRef, { followedAt: serverTimestamp(), followerUid });
    tx.update(profileRef, { followersCount: increment(1) });
    return true;
  });
}

/// A quiénes sigue esta persona. Devuelve los uid de los perfiles
/// seguidos, más recientes primero.
///
/// Los "seguir" anteriores a que el documento llevara `followerUid`
/// adentro no aparecen acá: son de la primera versión de esta función y
/// no hay forma de consultarlos por grupo. Volver a seguir a esa
/// persona los regenera.
export async function fetchFollowingUids(followerUid: string, max = 30): Promise<string[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, "followers"),
      where("followerUid", "==", followerUid),
      orderBy("followedAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs
    .map((d) => d.ref.parent.parent?.id)
    .filter((id): id is string => Boolean(id));
}

/// Borra el perfil público y su lista de seguidores. Lo usa la
/// eliminación de cuenta (ver AccountDeletionService.ts).
export async function deletePublicProfile(uid: string): Promise<void> {
  const followers = await getDocs(collection(db, "public_profiles", uid, "followers"));
  await Promise.all(followers.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "public_profiles", uid));
}
