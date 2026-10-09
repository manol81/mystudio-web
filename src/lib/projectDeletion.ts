// src/lib/projectDeletion.ts
//
// Borrar un proyecto de la nube desde "Mis Proyectos" (2026-10-09). Hasta
// acá solo se podía desde la app.
//
// Mismo orden que `CloudSyncService.deleteCloudProject` de la app, y por
// el mismo motivo: primero el ARCHIVO, después el documento. Si algo
// falla a la mitad queda un documento visible que se puede volver a
// borrar; al revés quedaría un .mystudio pesado que ya nadie nombra y que
// se factura igual. Que el archivo no exista es un final válido.
//
// Lo que NO se toca:
//  · La copia del TELÉFONO: la app la sigue teniendo y puede volver a
//    subirla. Es la otra mitad de "borrar de la nube" en la app.
//  · Las publicaciones de la Comunidad hechas con este proyecto. Las que
//    tienen preview y pistas livianas siguen sonando igual; las viejas,
//    sin eso, dejan de poder abrirse (dependían del .mystudio). Por eso el
//    diálogo avisa cuántas hay.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export async function deleteCloudProject(
  uid: string,
  project: { cloudId: string; storagePath: string },
): Promise<void> {
  if (project.storagePath) {
    try {
      await deleteObject(ref(storage, project.storagePath));
    } catch (err) {
      if ((err as { code?: string }).code !== "storage/object-not-found") throw err;
    }
  }
  await deleteDoc(doc(db, "users", uid, "projects", project.cloudId));
}

/// Cuántas publicaciones de la Comunidad salieron de este proyecto, y
/// cuántas de ellas dependen del .mystudio para sonar (sin preview).
export async function postsFromProject(
  uid: string,
  cloudId: string,
): Promise<{ total: number; withoutPreview: number }> {
  const snap = await getDocs(
    query(
      collection(db, "community_posts"),
      where("authorId", "==", uid),
      where("projectId", "==", cloudId),
    ),
  );
  return {
    total: snap.size,
    withoutPreview: snap.docs.filter((d) => !d.data().audioPreviewUrl).length,
  };
}
