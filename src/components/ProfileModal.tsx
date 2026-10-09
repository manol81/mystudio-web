"use client";

// Modal de "Editar Perfil": el nickname público (el nombre que aparece
// en publicaciones y comentarios de la Comunidad, en vez del email
// real) y la presentación que se ve en el perfil público. Mismo
// criterio visual que el resto de los modales.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { ACCEPTED_IMAGE_TYPES, imageFileProblem } from "@/lib/imageUpload";
import {
  removeProfileBanner,
  removeProfilePhoto,
  setProfileBanner,
  setProfilePhoto,
  usePhotoUrl,
} from "@/lib/profilePhoto";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PROFILE_LINK_KEYS,
  PROFILE_LINK_LABELS,
  buildProfileLinks,
  type ProfileLinkKey,
} from "@/lib/profileLinks";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  isValidUsername,
  setUsername as saveUsername,
} from "@/lib/UserProfileService";
import {
  fetchPublicProfile,
  savePublicProfile,
  MAX_BIO_LENGTH,
} from "@/lib/PublicProfileService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const [username, setUsernameInput] = useState(profile?.username ?? "");
  const [bio, setBio] = useState("");
  // Perfil ampliado (PRO, 2026-10-09): banner y links.
  const [isPro, setIsPro] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [linkInputs, setLinkInputs] = useState<Record<ProfileLinkKey, string>>({
    spotify: "", instagram: "", youtube: "", soundcloud: "", tiktok: "", web: "",
  });
  // La foto se guarda APENAS se elige (no con "Guardar"): es un archivo
  // que ya se subió, y esperar al botón obligaría a explicar por qué la
  // foto nueva todavía no se ve en ningún lado.
  const photoUrl = usePhotoUrl(user?.uid);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function handlePhotoChosen(file: File | undefined) {
    if (!user || !file) return;
    const problem = imageFileProblem(file);
    if (problem) {
      setPhotoError(problem);
      setPhotoStatus("error");
      return;
    }
    // El perfil público (donde vive la foto) exige apodo.
    const name = profile?.username ?? username.trim();
    if (!isValidUsername(name)) {
      setPhotoError("Elegí y guardá tu nickname antes de subir una foto.");
      setPhotoStatus("error");
      return;
    }
    setPhotoStatus("uploading");
    setPhotoError(null);
    try {
      await setProfilePhoto(user.uid, name, file);
      setPhotoStatus("idle");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
      setPhotoStatus("error");
    }
  }

  async function handleBannerChosen(file: File | undefined) {
    if (!user || !file) return;
    const problem = imageFileProblem(file);
    if (problem) {
      setPhotoError(problem);
      setPhotoStatus("error");
      return;
    }
    setBannerBusy(true);
    setPhotoError(null);
    try {
      setBannerUrl(await setProfileBanner(user.uid, file));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
      setPhotoStatus("error");
    } finally {
      setBannerBusy(false);
    }
  }

  async function handleBannerRemoved() {
    if (!user) return;
    setBannerBusy(true);
    try {
      await removeProfileBanner(user.uid);
      setBannerUrl(null);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
      setPhotoStatus("error");
    } finally {
      setBannerBusy(false);
    }
  }

  async function handlePhotoRemoved() {
    if (!user) return;
    setPhotoStatus("uploading");
    setPhotoError(null);
    try {
      await removeProfilePhoto(user.uid);
      setPhotoStatus("idle");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
      setPhotoStatus("error");
    }
  }

  // La presentación vive en el perfil PÚBLICO, que es otra colección
  // (ver PublicProfileService.ts) — hay que traerla aparte.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchPublicProfile(user.uid)
      .then((p) => {
        if (cancelled || !p) return;
        setBio(p.bio);
        setIsPro(p.isPro);
        setBannerUrl(p.bannerUrl);
        setLinkInputs((prev) => {
          const next = { ...prev };
          for (const k of PROFILE_LINK_KEYS) next[k] = p.links[k] ?? "";
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propagated, setPropagated] = useState<{
    posts: number;
    comments: number;
  } | null>(null);

  const isBusy = status === "saving" || status === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = username.trim();
    if (!isValidUsername(trimmed)) {
      setErrorMessage(
        "3 a 20 caracteres: letras, números o guión bajo, sin espacios.",
      );
      setStatus("error");
      return;
    }
    // Links del perfil ampliado: se validan antes de guardar nada.
    const builtLinks = isPro ? buildProfileLinks(linkInputs) : null;
    if (builtLinks && builtLinks.invalid.length > 0) {
      setErrorMessage(
        `Revisá ${builtLinks.invalid.map((k) => PROFILE_LINK_LABELS[k]).join(", ")}: tiene que ser un link (por ejemplo instagram.com/tu_banda).`,
      );
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    try {
      const result = await saveUsername(user.uid, trimmed);
      // Después del apodo, nunca antes: las reglas del perfil público
      // exigen que el nombre coincida con el privado, que es la fuente
      // de verdad.
      await savePublicProfile(user.uid, { username: trimmed, bio: bio.trim() });
      if (builtLinks) {
        await setDoc(doc(db, "public_profiles", user.uid), { links: builtLinks.links }, { mergeFields: ["links"] });
      }
      setPropagated(result);
      setStatus("success");
      setTimeout(onClose, result.posts + result.comments > 0 ? 2200 : 900);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={isBusy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">
          Editar Perfil
        </h2>
        <p className="mt-1 text-xs text-white/50">
          Tu nickname es el nombre que ven los demás en la Comunidad — nunca tu
          email. Al guardarlo se actualiza también en tus publicaciones y
          comentarios.
        </p>

        {status === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">¡Guardado!</p>
            {propagated && propagated.posts + propagated.comments > 0 && (
              <p className="max-w-xs text-xs text-white/40">
                Actualizado también en {propagated.posts}{" "}
                {propagated.posts === 1 ? "publicación" : "publicaciones"} y{" "}
                {propagated.comments}{" "}
                {propagated.comments === 1 ? "comentario" : "comentarios"}.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            {user && (
              <div className="flex items-center gap-4">
                <Avatar
                  uid={user.uid}
                  name={profile?.username || username || "?"}
                  size={64}
                  photoUrl={photoUrl}
                />
                <div className="flex flex-col items-start gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      void handlePhotoChosen(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    disabled={photoStatus === "uploading"}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-semibold text-neon-cyan hover:underline disabled:opacity-50"
                  >
                    {photoStatus === "uploading"
                      ? "Guardando foto..."
                      : photoUrl
                        ? "Cambiar foto"
                        : "Subir una foto"}
                  </button>
                  {photoUrl && photoStatus !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => void handlePhotoRemoved()}
                      className="text-[11px] text-white/40 hover:text-red-300"
                    >
                      Quitar foto
                    </button>
                  )}
                  <p className="text-[10px] text-white/30">La ven todos en la Comunidad.</p>
                </div>
              </div>
            )}
            {photoStatus === "error" && photoError && (
              <p className="text-xs text-red-400" role="alert">
                {photoError}
              </p>
            )}
            <div>
              <label
                htmlFor="profile-username"
                className="mb-1.5 block text-xs text-white/60"
              >
                Nickname
              </label>
              <input
                id="profile-username"
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsernameInput(e.target.value)}
                className={inputClasses}
                placeholder="tu_nombre"
                maxLength={20}
              />
            </div>

            <div>
              <label htmlFor="profile-bio" className="mb-1.5 block text-xs text-white/60">
                Presentación
              </label>
              <textarea
                id="profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
                rows={3}
                className={`${inputClasses} resize-none`}
                placeholder="Contá qué tocás, de dónde sos, qué estás buscando…"
              />
              <p className="mt-1 text-right text-[10px] text-white/30">
                {bio.length}/{MAX_BIO_LENGTH}
              </p>
            </div>

            {isPro && (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
                  Perfil ampliado · PRO
                </p>
                <div>
                  <span className="mb-1.5 block text-xs text-white/60">Banner</span>
                  {bannerUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- URL de Storage con token
                    <img src={bannerUrl} alt="" className="mb-2 h-16 w-full rounded-lg object-cover" />
                  )}
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      void handleBannerChosen(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={bannerBusy}
                      onClick={() => bannerInputRef.current?.click()}
                      className="text-xs font-semibold text-neon-cyan hover:underline disabled:opacity-50"
                    >
                      {bannerBusy ? "Guardando..." : bannerUrl ? "Cambiar banner" : "Subir un banner"}
                    </button>
                    {bannerUrl && !bannerBusy && (
                      <button
                        type="button"
                        onClick={() => void handleBannerRemoved()}
                        className="text-[11px] text-white/40 hover:text-red-300"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {PROFILE_LINK_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-[11px] text-white/50">{PROFILE_LINK_LABELS[k]}</span>
                      <input
                        type="text"
                        value={linkInputs[k]}
                        onChange={(e) => setLinkInputs((prev) => ({ ...prev, [k]: e.target.value }))}
                        placeholder={k === "web" ? "tusitio.com" : `${k}.com/…`}
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-onyx-black px-3 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {user && (
              <Link
                href={`/u/${user.uid}`}
                onClick={onClose}
                className="text-xs text-neon-cyan/80 underline-offset-2 hover:underline"
              >
                Ver mi perfil público
              </Link>
            )}

            {status === "error" && errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-3">
              {/* Eliminación self-service — misma página que declara
                  Google Play (Data Safety → account deletion). */}
              <Link
                href="/cuenta/eliminar"
                onClick={onClose}
                className="text-xs text-red-400/70 underline-offset-2 transition-colors hover:text-red-300 hover:underline"
              >
                Eliminar mi cuenta
              </Link>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50"
                >
                  {status === "saving" ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
