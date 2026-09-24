"use client";

// Presentación para VISITANTES (sin sesión) en la raíz.
//
// Fase 0 del informe "Radiografía MY STUDIO": hasta ahí la web no tenía
// ninguna página que explicara qué es el producto; quien llegaba sin
// cuenta veía un botón de login y nada más.
//
// 2026-09-24 — se amplía por SEO, con el dominio propio ya andando. Lo
// medido antes del cambio: la home entera entregaba **159 palabras** de
// texto indexable, casi todas del menú lateral. Google no tenía qué
// leer, y "contenido insuficiente" es además el motivo número uno de
// rechazo de AdSense. Sigue sin ser una landing de scroll infinito: es
// lo mínimo que responde las preguntas que trae alguien que cae de una
// búsqueda —qué es, cómo se usa, cuánto sale, sirve para mí— y después
// lo deja ver el feed real sonando.
//
// ⚠️ Esto se le muestra a quien NO tiene sesión, y Googlebot es
// exactamente eso: un visitante sin sesión. O sea que lo que indexa
// Google es lo mismo que ve cualquier persona que llega de afuera —
// nada de servir una versión distinta al buscador.

import { Mic2, Share2, Cloud, Users, Sparkles } from "lucide-react";
import Link from "next/link";
import { PLAY_STORE_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const VALUE_PROPS = [
  {
    icon: Mic2,
    title: "Grabá con instrumentos reales",
    text: "Motor de audio nativo de baja latencia, con calibración automática y punch-in. Pensado para guitarra, voz, bajo y percusión, no para loops pegados.",
  },
  {
    icon: Cloud,
    title: "Tus proyectos, en el celular y en la web",
    text: "Sincronizá desde la app y seguí editando en el Arranger web, con banco de sonidos que ajusta tempo y tonalidad al de tu canción.",
  },
  {
    icon: Share2,
    title: "Feedback en el segundo exacto",
    text: "Publicá un arreglo y recibí comentarios anclados al momento preciso de la canción, no un “está bueno” suelto.",
  },
] as const;

const STEPS = [
  {
    title: "1. Grabá tus pistas",
    text: "Abrí la app, creá un proyecto y grabá una pista por instrumento. El metrónomo y la calibración de latencia hacen que todo quede en tiempo, aunque grabes con auriculares.",
  },
  {
    title: "2. Mezclá",
    text: "Volumen, paneo, ecualizador, compresor y reverb por pista, más un limitador en el máster. Lo que escuchás es exactamente lo que se exporta.",
  },
  {
    title: "3. Compartí o buscá quién te sume",
    text: "Exportá a MP3, publicá el tema en la Comunidad o pedí un instrumento que te falte: otro músico graba su parte en su teléfono y te la manda en buena calidad.",
  },
] as const;

const FAQ = [
  {
    q: "¿Cuánto cuesta?",
    a: "La app es gratis y permite hasta cuatro pistas por proyecto. La versión PRO es un pago único, no una suscripción, y saca ese límite, los anuncios y habilita exportar en WAV y por pistas separadas.",
  },
  {
    q: "¿Necesito una placa de audio?",
    a: "No. MY STUDIO graba con el micrófono del teléfono y compensa la latencia por vos. Si tenés una interfaz USB, también funciona.",
  },
  {
    q: "¿Sirve para grabar guitarra y voz?",
    a: "Sí, es justamente para lo que está pensada: grabás una pista, la escuchás mientras grabás la siguiente, y las mezclás en la misma pantalla.",
  },
  {
    q: "¿Hay versión para iPhone?",
    a: "Todavía no. El motor de audio es nativo de Android; una versión para iOS implicaría reescribirlo entero.",
  },
] as const;

/// Datos estructurados para el buscador: le dicen en su propio formato
/// que esto es una aplicación Android gratuita, y de qué categoría. Es
/// lo que habilita que Google pueda mostrar el resultado enriquecido en
/// vez de dos líneas de texto.
const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Android",
  url: SITE_URL,
  installUrl: PLAY_STORE_URL,
  inLanguage: "es",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export function VisitorHero({ onCreateAccount }: { onCreateAccount: () => void }) {
  return (
    <section className="flex flex-col gap-10 rounded-3xl border border-white/10 bg-graphite p-8 sm:p-10">
      <script
        type="application/ld+json"
        // El contenido es una constante de este archivo, no entra nada
        // de afuera: no hay superficie de inyección.
        dangerouslySetInnerHTML={{ __html: JSON.stringify([APP_JSON_LD, FAQ_JSON_LD]) }}
      />

      <div className="flex flex-col gap-4">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-neon-cyan">
          Estudio multipista para músicos, en español
        </p>
        {/* El h1 de la home vive acá, no en el encabezado del feed:
            "Lo que está sonando ahora" no contiene una sola palabra que
            alguien busque. */}
        <h1 className="max-w-3xl font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          Grabá varias pistas con tu celular y armá tu canción entera.
        </h1>
        <p className="max-w-2xl text-sm text-white/60 sm:text-base">
          MY STUDIO es una app Android gratuita para <strong className="font-semibold text-white/80">grabar
          multipista</strong>: grabás la guitarra, después la voz encima, sumás el bajo y la
          percusión, y mezclás todo desde el teléfono. Sin placa de audio, sin computadora y sin
          suscripción. Cuando el tema está listo lo publicás en una comunidad de músicos que escucha
          y comenta.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2.5 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
        >
          Descargar en Google Play
        </a>
        <button
          type="button"
          onClick={onCreateAccount}
          className="rounded-full border border-white/20 px-6 py-2.5 font-display text-sm font-semibold text-white/80 transition-colors duration-200 hover:border-white/50 hover:text-white"
        >
          Crear cuenta gratis
        </button>
        <Link
          href="/ayuda"
          className="rounded-full px-4 py-2.5 font-display text-sm font-semibold text-white/55 transition-colors duration-200 hover:text-white"
        >
          Ver cómo funciona →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex flex-col gap-2 rounded-2xl bg-onyx-black/60 p-4">
            <Icon size={20} className="text-neon-cyan" />
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs leading-relaxed text-white/50">{text}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 border-t border-white/10 pt-8">
        <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
          Cómo se graba una canción en MY STUDIO
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ title, text }) => (
            <div key={title} className="flex flex-col gap-1.5">
              <h3 className="font-display text-sm font-semibold text-neon-cyan">{title}</h3>
              <p className="text-xs leading-relaxed text-white/55">{text}</p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-white/40">
          El paso a paso completo, con los nombres de cada botón, está en{" "}
          <Link href="/ayuda" className="text-neon-cyan hover:underline">
            la guía de uso
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-white/10 pt-8">
        <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
          Para quién es
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex gap-3">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-neon-cyan" />
            <p className="text-xs leading-relaxed text-white/55">
              <strong className="font-semibold text-white/80">Para el que compone y quiere
              escucharse.</strong> Tenés una idea, la grabás con la guitarra y querés oír cómo
              queda con bajo y batería antes de mostrársela a nadie. Eso, que antes pedía una
              computadora y un programa caro, acá entra en el teléfono.
            </p>
          </div>
          <div className="flex gap-3">
            <Users size={18} className="mt-0.5 shrink-0 text-neon-cyan" />
            <p className="text-xs leading-relaxed text-white/55">
              <strong className="font-semibold text-white/80">Para el que necesita un músico
              más.</strong> Publicás el tema diciendo qué instrumento te falta. Quien se suma
              escucha tu canción, graba su parte en su propio teléfono —con su latencia ya
              calibrada— y te la manda en buena calidad para que la sumes a tu proyecto.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-white/10 pt-8">
        <h2 className="font-display text-xl font-bold text-white sm:text-2xl">Preguntas frecuentes</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="flex flex-col gap-1.5">
              <dt className="text-sm font-semibold text-white">{q}</dt>
              <dd className="text-xs leading-relaxed text-white/55">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
