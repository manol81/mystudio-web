// src/lib/profileLinks.ts
//
// Links del perfil ampliado PRO (2026-10-09). La lista de redes es FIJA y
// es la misma que validan las reglas de Firestore (validExtras en
// public_profiles): agregar una acá sin sumarla allá hace fallar el
// guardado entero.

export const PROFILE_LINK_KEYS = ["spotify", "instagram", "youtube", "soundcloud", "tiktok", "web"] as const;
export type ProfileLinkKey = (typeof PROFILE_LINK_KEYS)[number];
export type ProfileLinks = Partial<Record<ProfileLinkKey, string>>;

export const PROFILE_LINK_LABELS: Record<ProfileLinkKey, string> = {
  spotify: "Spotify",
  instagram: "Instagram",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  tiktok: "TikTok",
  web: "Sitio web",
};

/// Limpia lo que escribió la persona: vacío = sin link; sin protocolo se
/// le agrega https://; solo se acepta https y hasta 200 caracteres (lo
/// mismo que exigen las reglas). Devuelve null si no es un link usable.
export function normalizeProfileLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  if (!/^https:\/\/[^\s]+\.[^\s]+$/i.test(withScheme) || withScheme.length > 200) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" ? withScheme : null;
  } catch {
    return null;
  }
}

/// Arma el mapa que se guarda: solo las claves con un link válido. Los
/// inválidos vuelven en `invalid`, para avisar en vez de tirarlos callado.
export function buildProfileLinks(input: Record<ProfileLinkKey, string>): {
  links: ProfileLinks;
  invalid: ProfileLinkKey[];
} {
  const links: ProfileLinks = {};
  const invalid: ProfileLinkKey[] = [];
  for (const key of PROFILE_LINK_KEYS) {
    const raw = input[key] ?? "";
    if (!raw.trim()) continue;
    const ok = normalizeProfileLink(raw);
    if (ok) links[key] = ok;
    else invalid.push(key);
  }
  return { links, invalid };
}
