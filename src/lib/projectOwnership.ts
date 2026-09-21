// ¿El .mystudio de esta publicación es MÍO?
//
// Los proyectos sincronizados viven en `users/{uid}/projects/{id}.mystudio`,
// que por firestore/storage rules lee ÚNICAMENTE su dueño. El feed
// guarda esa ruta en `audioUrl`, así que el uid del autor está ahí
// mismo y no hace falta leer nada para saber si vale la pena pedirlo.
//
// Existe por un error reportado (2026-09-21): una publicación sin
// preview y sin paquete de pistas ofrecía "escuchar" a cualquiera, y el
// intento terminaba en un error crudo de Firebase — "storage/unauthorized"
// o, con sesión iniciada, "auth/network-request-failed". Nadie puede
// deducir de eso que lo que falta es que el autor vuelva a publicar.

/**
 * true si [uid] es el dueño del proyecto al que apunta [storagePath].
 *
 * Ante la duda devuelve **false**: sin uid, con una ruta vacía o con un
 * formato que no reconoce, conviene no prometer una descarga que va a
 * fallar. Un falso negativo muestra un cartel de más; un falso positivo
 * devuelve el error ilegible que se está tratando de evitar.
 */
export function isProjectOwner(
  storagePath: string | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (!uid || !storagePath) return false;
  // Acepta la ruta pelada (`users/uid/…`) y también una URL de descarga
  // completa, donde la ruta viaja escapada dentro de `/o/`.
  const decoded = decodeURIComponent(storagePath);
  const match = decoded.match(/users\/([^/]+)\/projects\//);
  return match?.[1] === uid;
}
