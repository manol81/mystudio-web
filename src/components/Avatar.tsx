"use client";

// La cara de una persona en la Comunidad: su foto de perfil si subió
// una, y si no la inicial sobre un color (lo que había siempre). Lee la
// foto del perfil público con caché por persona (ver profilePhoto.ts).

import { usePhotoUrl } from "@/lib/profilePhoto";

const AVATAR_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#82E0AA"];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function Avatar({
  uid,
  name,
  size = 40,
  photoUrl,
}: {
  uid: string;
  name: string;
  size?: number;
  /// Si ya se conoce (la pantalla de perfil la trae), no se vuelve a
  /// leer. `undefined` = buscarla.
  photoUrl?: string | null;
}) {
  const fetched = usePhotoUrl(photoUrl === undefined ? uid : null);
  const url = photoUrl === undefined ? fetched : photoUrl;
  const style = { width: size, height: size };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL de Storage con token: next/image no aporta acá y obligaría a declarar el dominio
      <img
        src={url}
        alt={name}
        style={style}
        loading="lazy"
        className="shrink-0 rounded-full object-cover ring-1 ring-white/10"
      />
    );
  }
  return (
    <div
      style={{ ...style, backgroundColor: colorFor(uid || name), fontSize: Math.round(size * 0.38) }}
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-onyx-black"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
