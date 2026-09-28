// src/lib/postDeletion.ts
//
// Borrar una publicación de la Comunidad con TODO lo que cuelga de
// ella. Vive acá y no adentro de AdminService porque ahora lo usan DOS
// caminos con permisos distintos y el mismo trabajo:
//
//   · el AUTOR, borrando lo suyo (firestore.rules: `request.auth.uid ==
//     resource.data.authorId`), y
//   · el ADMIN, moderando algo ajeno (`isAdmin()`).
//
// Que compartan esta función no es prolijidad: Firestore NO borra
// subcolecciones en cascada, así que el barrido es una lista de pasos
// que hay que acordarse de hacer, y una segunda copia se iba a quedar
// corta el día que aparezca una subcolección nueva — dejando likes,
// comentarios o hilos vivos colgando de un padre que ya no existe,
// invisibles desde cualquier pantalla y ya imposibles de alcanzar.
//
// Lo que NO se toca, a propósito: el `.mystudio` del autor en
// `users/{uid}/projects`. Eso es su PROYECTO, no la publicación —
// despublicar no es perder el trabajo. Lo que sí se va es todo lo que
// existía solo por estar publicado: el preview y el ZIP de pistas.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  type CollectionReference,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export interface DeletePostResult {
  likes: number;
  comments: number;
  collabRequests: number;
  storageObjects: number;
}

/// Borra la publicación [post] y todo lo suyo.
///
/// El documento padre se borra ÚLTIMO: si algo falla a mitad de camino,
/// el post sigue ahí y se puede reintentar. Al revés quedarían
/// documentos vivos colgando de un padre inexistente.
export async function deletePostCascade(post: {
  id: string;
  authorId: string;
}): Promise<DeletePostResult> {
  const postRef = doc(db, "community_posts", post.id);
  const result: DeletePostResult = {
    likes: 0,
    comments: 0,
    collabRequests: 0,
    storageObjects: 0,
  };

  result.likes = await deleteEntireCollection(collection(postRef, "likes"));
  result.comments = await deleteEntireCollection(collection(postRef, "comments"));

  // El hilo de mensajes vive DENTRO de cada pedido, así que se vacía
  // antes de borrar el pedido — al revés quedarían huérfanos.
  const requests = await getDocs(collection(postRef, "collab_requests"));
  for (const request of requests.docs) {
    await deleteEntireCollection(collection(request.ref, "messages"));
    await deleteDoc(request.ref);
    result.collabRequests++;
  }

  // Rutas EXACTAS, sin listar la carpeta: las reglas de Storage dan
  // permiso sobre el objeto, no sobre el prefijo (mismo criterio que
  // AccountDeletionService con las pistas de colaboración). Que un
  // archivo no exista es un final válido, no un error: las
  // publicaciones viejas no tienen ZIP de pistas, y un preview puede
  // haber fallado al generarse.
  for (const path of [
    `community_previews/${post.authorId}/${post.id}`,
    `community_stems/${post.authorId}/${post.id}.zip`,
  ]) {
    try {
      await deleteObject(storageRef(storage, path));
      result.storageObjects++;
    } catch (err) {
      if ((err as { code?: string }).code !== "storage/object-not-found") throw err;
    }
  }

  await deleteDoc(postRef);
  return result;
}

/// Vacía una colección de a páginas y devuelve cuántos documentos
/// borró. De a 400 porque un post con suerte puede tener miles de
/// likes y un `getDocs` sin límite los traería todos a memoria.
async function deleteEntireCollection(col: CollectionReference): Promise<number> {
  let total = 0;
  for (;;) {
    const page = await getDocs(query(col, limit(400)));
    if (page.empty) return total;
    await Promise.all(page.docs.map((d) => deleteDoc(d.ref)));
    total += page.size;
    if (page.size < 400) return total;
  }
}
