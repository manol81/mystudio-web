"use client";

// Buscar personas — hasta acá solo se llegaba a un perfil si esa
// persona aparecía en el feed, así que reencontrar a alguien con quien
// habías hablado dependía de la suerte.
//
// Es una búsqueda por PREFIJO del apodo: es lo máximo que da Firestore
// sin sumar un servicio de búsqueda aparte (ver searchProfiles en
// PublicProfileService.ts). Alcanza para el uso real, que es "sé cómo se
// llama y quiero llegar a su perfil".

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { searchProfiles, type PublicProfile } from "@/lib/PublicProfileService";

export default function SearchPage() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce: escribir dispara una consulta por tecla si no se espera, y
  // cada una es una lectura facturada de Firestore.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      // Microtask por el linter de React, igual que en AuthContext.
      queueMicrotask(() => {
        setResults(null);
        setSearching(false);
      });
      return;
    }
    queueMicrotask(() => setSearching(true));
    const timeout = setTimeout(() => {
      searchProfiles(trimmed)
        .then((found) => {
          setResults(found);
          setError(null);
        })
        .catch(() => setError("No se pudo buscar. Probá de nuevo en un momento."))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timeout);
  }, [term]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold text-white">
        Buscar <span className="text-neon-cyan">personas</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Encontrá a alguien por su apodo para escuchar lo suyo, seguirlo o proponerle
        colaborar.
      </p>

      <div className="relative mt-6">
        <Search
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30"
        />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Apodo — al menos dos letras"
          autoFocus
          className="w-full rounded-full border border-white/10 bg-onyx-black py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/25 focus:border-neon-cyan/50 focus:outline-none"
        />
      </div>

      {error && <p className="mt-6 text-sm text-red-300">{error}</p>}
      {searching && <p className="mt-6 text-sm text-white/40">Buscando…</p>}

      {!searching && results !== null && results.length === 0 && (
        <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-sm text-white/60">Nadie con ese apodo.</p>
          <p className="mt-1.5 text-xs text-white/40">
            La búsqueda es por el comienzo del apodo, no por cualquier parte. Y las personas
            que eligieron su apodo hace mucho aparecen recién cuando vuelvan a guardar su
            perfil.
          </p>
        </div>
      )}

      {!searching && results !== null && results.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2">
          {results.map((p) => (
            <li key={p.uid}>
              <Link
                href={`/u/${p.uid}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-neon-cyan/40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 font-display text-sm font-semibold text-neon-cyan">
                  {(p.username || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{p.username}</p>
                  {p.bio && <p className="truncate text-xs text-white/45">{p.bio}</p>}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-white/35">
                  <Users size={13} />
                  {p.followersCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {results === null && !searching && term.trim().length > 0 && (
        <p className="mt-6 text-sm text-white/40">Escribí al menos dos letras.</p>
      )}
    </div>
  );
}
