// /cuenta/eliminar — URL pública de eliminación de cuenta. Es la que
// se declara en Google Play Console (Data Safety → "Account deletion")
// y la que enlaza la política de privacidad. Server Component solo por
// la metadata; todo lo interactivo está en DeleteAccountPanel.

import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountPanel } from "@/components/DeleteAccountPanel";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Eliminar cuenta",
  description: `Cómo eliminar tu cuenta de ${SITE_NAME} y todos tus datos en la nube, desde la web o desde la app.`,
  alternates: { canonical: `${SITE_URL}/cuenta/eliminar` },
};

export default function DeleteAccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <p className="font-display text-xs uppercase tracking-[0.2em] text-white/40">{SITE_NAME}</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-white">
        Eliminar tu <span className="text-red-400">cuenta</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-white/60">
        Podés borrar tu cuenta y todos tus datos en la nube en cualquier momento, sin pedirle nada
        a nadie: desde esta página o desde la app Android (ícono de cuenta → &ldquo;Eliminar mi
        cuenta&rdquo;). El borrado es inmediato y definitivo.
      </p>

      <div className="mt-8">
        <DeleteAccountPanel />
      </div>

      <p className="mt-8 text-xs text-white/35">
        Más detalles sobre qué datos guardamos y por qué, en la{" "}
        <a
          href="https://sites.google.com/view/mystudiopocket-privacidad/home"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/60 underline-offset-2 hover:underline"
        >
          política de privacidad
        </a>
        . <Link href="/" className="text-white/60 underline-offset-2 hover:underline">Volver al inicio</Link>.
      </p>
    </div>
  );
}
