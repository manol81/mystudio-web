// Perfil público de un usuario: /u/{uid}
//
// Va por uid y no por apodo porque los apodos NO son únicos en este
// proyecto (decisión documentada en UserProfileService.ts: forzar
// unicidad necesitaría una colección de reservas aparte). Con el uid la
// dirección es estable aunque la persona cambie de apodo.
//
// Server Component solo por la metadata; todo lo interactivo vive en
// PublicProfileView.

import type { Metadata } from "next";
import { PublicProfileView } from "@/components/PublicProfileView";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { fetchPublicProfileFromServer } from "@/lib/serverCommunity";

export async function generateMetadata({
  params,
}: PageProps<"/u/[uid]">): Promise<Metadata> {
  const { uid } = await params;
  const profile = await fetchPublicProfileFromServer(uid);
  const name = profile?.username || "Perfil";
  const description =
    profile?.bio || `Escuchá lo que publica ${name} en la Comunidad de ${SITE_NAME}.`;
  return {
    title: name,
    description,
    alternates: { canonical: `${SITE_URL}/u/${uid}` },
    openGraph: {
      type: "profile",
      title: `${name} · ${SITE_NAME}`,
      description,
      url: `${SITE_URL}/u/${uid}`,
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps<"/u/[uid]">) {
  const { uid } = await params;
  return <PublicProfileView uid={uid} />;
}
