// src/lib/collabRoles.ts
//
// Qué instrumento o voz busca una publicación. Fuente única de verdad
// para el selector al publicar, las etiquetas del feed y el filtro de
// búsqueda: un valor escrito distinto en dos lados haría que el filtro
// nunca encuentre nada, el mismo problema que ya documenta
// sampleTaxonomy.ts.
//
// Se guardan tal cual en `community_posts.wantedRoles` y se consultan
// con `array-contains`, así que cambiar un texto de esta lista deja
// huérfanas las publicaciones que ya lo usaban. Para agregar, sumar al
// final; para renombrar, hace falta migrar los documentos.

export const COLLAB_ROLES = [
  "Voz",
  "Coros",
  "Guitarra",
  "Bajo",
  "Batería",
  "Percusión",
  "Teclados",
  "Vientos",
  "Cuerdas",
  "Libre",
] as const;

export type CollabRole = (typeof COLLAB_ROLES)[number];

/// Tope de roles por publicación. Pedir todo es lo mismo que no pedir
/// nada: obliga a decir qué falta de verdad, que es lo que hace útil el
/// filtro para el que busca dónde tocar.
export const MAX_WANTED_ROLES = 4;

export function isCollabRole(value: string): value is CollabRole {
  return (COLLAB_ROLES as readonly string[]).includes(value);
}
