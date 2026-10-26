"use client";

// La invitación a la app debajo de una canción compartida (2026-10-26).
//
// /p/{id} es la página a la que llega quien toca un link compartido en
// WhatsApp, Instagram o donde sea — casi siempre alguien que NO conoce
// MY STUDIO. Hasta acá veía la canción y nada más: ni un botón a la app,
// ni a quién pertenece, ni que podía sumarse. Es el lugar con más gente
// nueva de todo el sitio y no convertía.
//
// Tres caminos, del más fuerte al más suave:
//   1. Sumarse a ESTA canción, si el autor busca músicos. El botón
//      "Sumarme" ya está en la tarjeta de arriba; acá se lo explica.
//   2. Bajar la app (Google Play, con el origen medido).
//   3. Seguir escuchando: más del autor y el resto de la Comunidad.
// Con `authorId` null (la publicación se borró) queda solo la invitación
// general: un link viejo también puede traer a alguien.

import Link from "next/link";
import { Handshake, Music2 } from "lucide-react";
import { PlayStoreLink } from "@/components/PlayStoreLink";

export function PostAppCta({
  authorId,
  authorName,
  wantedRoles,
}: {
  authorId: string | null;
  authorName: string;
  wantedRoles: string[];
}) {
  return (
    <section
      aria-label="Grabá tu música con MY STUDIO"
      className="flex flex-col gap-4 rounded-2xl border border-neon-cyan/20 bg-gradient-to-br from-neon-cyan/10 via-graphite to-graphite p-6"
    >
      {wantedRoles.length > 0 && authorId && (
        <p className="flex items-start gap-2 text-sm text-white/80">
          <Handshake size={16} className="mt-0.5 shrink-0 text-neon-cyan" />
          <span>
            <strong className="text-white">{authorName}</strong> busca{" "}
            <strong className="text-neon-cyan">{wantedRoles.join(", ")}</strong> para esta
            canción. Tocá <strong className="text-white">Sumarme</strong> y grabá tu parte
            desde la app.
          </span>
        </p>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/15 text-neon-cyan">
          <Music2 size={20} />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-white">¿Hacés música?</p>
          <p className="text-sm text-white/60">
            Esta canción se grabó con MY STUDIO, el estudio multipista en tu teléfono. Grabá la
            tuya, pista por pista, y compartila acá. Gratis en Android.
          </p>
        </div>
      </div>

      <PlayStoreLink
        source="post"
        className="inline-flex items-center justify-center gap-2 rounded-full bg-neon-cyan px-5 py-2.5 text-sm font-semibold text-onyx-black transition-opacity hover:opacity-90"
      >
        Bajar MY STUDIO gratis
      </PlayStoreLink>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {authorId && (
          <Link href={`/u/${authorId}`} className="text-white/50 transition-colors hover:text-neon-cyan">
            Más de {authorName}
          </Link>
        )}
        <Link href="/" className="text-white/50 transition-colors hover:text-neon-cyan">
          Escuchar más canciones de la Comunidad
        </Link>
      </div>
    </section>
  );
}
