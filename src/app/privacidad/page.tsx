// /privacidad — política de privacidad (2026-10-20). Antes vivía en
// Google Sites (sites.google.com/view/mystudiopocket-privacidad), y eso
// impedía cargarla en Google Auth Platform → Branding: cada link de esa
// pantalla tiene que estar en un dominio autorizado, y google.com no se
// puede autorizar. Acá queda en el dominio propio.
//
// Es la URL que se declara en Play Console (App content → Privacy
// policy), en AdMob (Privacy & messaging) y en Google Auth Platform.
// Cambiar este texto es cambiar lo que se le promete a la gente: tocar
// solo lo que de verdad cambió en la app o en la web, y actualizar
// LAST_UPDATED.

import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const LAST_UPDATED = "20/10/2026";
const CONTACT_EMAIL = "manolocenter@gmail.com";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: `Qué información usa ${SITE_NAME}, dónde se guarda, con quién se comparte y cómo borrarla.`,
  alternates: { canonical: `${SITE_URL}/privacidad` },
};

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-6">
      <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-white/65">{children}</div>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li>
      <strong className="font-semibold text-white/85">{label}:</strong> {children}
    </li>
  );
}

const listClass = "list-disc space-y-2 pl-5";
const linkClass = "text-neon-cyan underline-offset-2 hover:underline";

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <p className="font-display text-xs uppercase tracking-[0.2em] text-white/40">{SITE_NAME}</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-white">Política de privacidad</h1>
      <p className="mt-2 text-xs text-white/40">Última actualización: {LAST_UPDATED}</p>

      <p className="mt-6 text-sm leading-relaxed text-white/65">
        {SITE_NAME} es una aplicación de grabación y edición de audio multipista para Android, con un
        sitio web ({SITE_URL.replace("https://", "")}) donde está la Comunidad. Esta política explica
        qué información usan la app y el sitio, dónde se guarda y con quién se comparte.
      </p>

      <Section title="Resumen">
        <p>
          El procesamiento de audio (grabar, mezclar, exportar) sucede siempre en tu dispositivo.
          Crear una cuenta es opcional: te permite respaldar tus proyectos en la nube, publicarlos en
          la Comunidad y colaborar con otras personas. La app muestra anuncios en el plan gratuito.
        </p>
      </Section>

      <Section title="Qué información usa la app">
        <ul className={listClass}>
          <Item label="Micrófono (RECORD_AUDIO)">
            exclusivamente para grabar audio en tus propios proyectos, a pedido tuyo, y para mostrar
            el nivel de entrada mientras tenés una pista lista para grabar.
          </Item>
          <Item label="Archivos de audio que importes (opcional)">
            se leen para copiarlos a tu proyecto. No accedemos a ningún otro archivo de tu
            dispositivo.
          </Item>
          <Item label="Email (opcional, solo si creás una cuenta)">
            para iniciar sesión, verificar tu cuenta y recuperar tu contraseña. Nunca se muestra
            públicamente.
          </Item>
          <Item label="Apodo, presentación y foto de perfil (opcionales)">
            son lo que ven otras personas en la Comunidad. Si sos PRO también podés sumar una imagen
            de portada y links a tus redes; todo eso es público.
          </Item>
        </ul>
      </Section>

      <Section title="Cuenta e inicio de sesión">
        <p>
          Podés usar la mayoría de las funciones sin crear una cuenta: todo se guarda localmente en
          tu dispositivo. La cuenta se crea con Firebase Authentication (Google), con email y
          contraseña o con tu cuenta de Google.
        </p>
        <p>
          <strong className="font-semibold text-white/85">Inicio de sesión con Google.</strong> Si
          elegís crear tu cuenta o entrar con Google, Google nos comparte tu nombre, tu dirección de
          email y tu foto de perfil. Usamos el email para identificar tu cuenta. El nombre y la foto
          quedan guardados en Firebase Authentication junto a tu cuenta y no se muestran en la
          Comunidad (ahí se ve solo tu apodo), ni se comparten con terceros. Nunca recibimos tu
          contraseña de Google ni accedemos a otros datos de tu cuenta de Google. Podés quitarle el
          acceso a {SITE_NAME} cuando quieras desde{" "}
          <a href="https://myaccount.google.com/connections" className={linkClass} target="_blank" rel="noopener noreferrer">
            myaccount.google.com
          </a>{" "}
          → Seguridad → Apps y servicios de terceros.
        </p>
      </Section>

      <Section title="Qué podés hacer con una cuenta">
        <ul className={listClass}>
          <li>
            Sincronizar tus proyectos completos (pistas y audio) a un espacio privado en la nube,
            como respaldo o para abrirlos en otro dispositivo o en el sitio web. Solo vos podés
            verlos.
          </li>
          <li>
            Publicar un proyecto en la Comunidad: el título, género, descripción, portada, tu apodo,
            una versión para escuchar de la mezcla y sus pistas por separado (en calidad liviana)
            quedan visibles para cualquiera.
          </li>
          <li>
            Recibir &ldquo;me gusta&rdquo; y comentarios en tus publicaciones, y seguir a otras
            personas.
          </li>
          <li>
            Colaborar: si aceptás a alguien en una canción, esa persona puede grabar su parte y
            mandártela. La pista enviada solo la ven quien la grabó y quien la recibe, y se borra
            sola a los 7 días.
          </li>
          <li>
            Mandar mensajes privados (en una colaboración o entre personas). Solo los leen las dos
            personas de la conversación; tampoco los lee la administración del sitio.
          </li>
          <li>
            Denunciar publicaciones o personas y bloquear usuarios. Usamos las denuncias solo para
            moderar la Comunidad; el bloqueo es privado.
          </li>
        </ul>
      </Section>

      <Section title="Dónde se guardan tus datos">
        <p>
          Sin cuenta, todo se guarda solo en tu dispositivo. Con cuenta, lo que sincronices o
          publiques se guarda en servidores de Firebase (Google Cloud), con reglas de acceso que
          restringen tus proyectos privados y tus mensajes a quienes corresponde.
        </p>
      </Section>

      <Section title="Notificaciones">
        <p>
          Si iniciás sesión en la app, guardamos un identificador de notificaciones de tu
          dispositivo (Firebase Cloud Messaging) para avisarte de pedidos de colaboración, pistas
          recibidas y mensajes. Se borra al cerrar sesión en ese dispositivo.
        </p>
      </Section>

      <Section title="Compras">
        <p>
          {SITE_NAME} PRO se compra a través de Google Play; los datos de pago los administra
          Google, no {SITE_NAME}. Para confirmar que la compra es válida, la consultamos a Google
          Play y guardamos junto a tu cuenta que es válida y el número de pedido.
        </p>
      </Section>

      <Section title="Estadísticas de uso">
        <p>
          La app y el sitio usan Google Analytics para Firebase para saber qué funciones se usan
          (por ejemplo, cuántos proyectos se crean o cuántas pistas se graban). Esos eventos nunca
          incluyen tu audio, el nombre de tus canciones, tu apodo ni tu email.
        </p>
        <p>
          Cuando alguien escucha una publicación de la Comunidad, sumamos una reproducción y el
          país aproximado según el idioma del navegador, sin registrar quién escuchó. Quien publica
          con PRO puede ver esos totales.
        </p>
      </Section>

      <Section title="Anuncios">
        <p>
          {SITE_NAME} muestra anuncios de Google AdMob en el plan gratuito. AdMob puede usar el
          identificador de publicidad de tu dispositivo para mostrar anuncios, que pueden ser
          personalizados según tu configuración de privacidad. En el Espacio Económico Europeo, el
          Reino Unido y Suiza te pedimos el consentimiento antes de mostrar anuncios, y podés
          cambiar tu elección desde la cuenta en la app (&ldquo;Opciones de privacidad&rdquo;). Más
          información:{" "}
          <a href="https://policies.google.com/technologies/partner-sites" className={`${linkClass} break-all`} target="_blank" rel="noopener noreferrer">
            policies.google.com/technologies/partner-sites
          </a>
          .
        </p>
      </Section>

      <Section title="Seguridad y reporte de errores">
        <p>
          Usamos Firebase App Check (con Play Integrity en Android y reCAPTCHA Enterprise en el
          sitio) para comprobar que los pedidos a nuestros servidores vienen de la app o del sitio
          reales. Usamos Firebase Crashlytics para reportar fallas técnicas automáticamente: esos
          reportes incluyen información técnica del dispositivo y del error, nunca tu audio ni el
          contenido de tus proyectos.
        </p>
      </Section>

      <Section title="Compartir contenido">
        <p>
          Podés exportar la mezcla final o un respaldo completo del proyecto y compartirlos con el
          selector de tu sistema operativo: eso queda bajo tu control.
        </p>
      </Section>

      {/* El ancla es la que se declara en Play Console → Data safety como
          link para borrar datos SIN borrar la cuenta. */}
      <Section title="Eliminación de tus datos" id="eliminar-datos">
        <p>
          Podés eliminar tu cuenta y todos sus datos en la nube cuando quieras, desde la app
          (Cuenta → &ldquo;Eliminar mi cuenta&rdquo;) o desde{" "}
          <Link href="/cuenta/eliminar" className={linkClass}>
            {SITE_URL.replace("https://", "")}/cuenta/eliminar
          </Link>
          . El borrado es inmediato. Quedan solo los &ldquo;me gusta&rdquo; que diste en
          publicaciones ajenas y los &ldquo;seguir&rdquo; a otras personas (registros sin datos
          personales), y las denuncias que hayas enviado.
        </p>
        <p>
          Si solo querés borrar una parte, podés eliminar un proyecto de la nube desde la app o
          desde Mis Proyectos en el sitio, y una publicación desde su menú en la Comunidad. Para
          cualquier otra cosa, escribinos a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
            {CONTACT_EMAIL}
          </a>{" "}
          indicando qué querés eliminar.
        </p>
      </Section>

      <Section title="Permisos de Android que solicita la app">
        <ul className={listClass}>
          <Item label="Micrófono (RECORD_AUDIO)">para grabar audio en tus proyectos.</Item>
          <Item label="Notificaciones (POST_NOTIFICATIONS)">
            para avisarte de colaboraciones y mensajes, solo si tenés una cuenta.
          </Item>
        </ul>
      </Section>

      <Section title="Menores de edad">
        <p>
          {SITE_NAME} no está dirigida a niños ni recolecta intencionalmente información de menores
          de 13 años.
        </p>
      </Section>

      <Section title="Cambios a esta política">
        <p>Si esta política cambia, la fecha de &ldquo;Última actualización&rdquo; se actualiza en consecuencia.</p>
      </Section>

      <Section title="Contacto">
        <p>
          Preguntas sobre esta política:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>

      <p className="mt-10 text-xs text-white/35">
        <Link href="/" className="text-white/60 underline-offset-2 hover:underline">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
