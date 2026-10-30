// Contenido de la guía de ayuda (/ayuda).
//
// ⚠️ La FUENTE es `docs/ayuda.md` en el repo de la app (my_studio). Este
// archivo y los textos de la pantalla de Ayuda de la app
// (`lib/l10n/app_es.arb`, claves `help*`) son dos copias de lo mismo:
// cambiar un texto es cambiarlo en los TRES lugares, en ese orden. No hay
// nada que verifique que coinciden — mismo trato que la taxonomía de
// samples (ver sampleTaxonomy.ts).
//
// Va como datos y no como JSX para que el orden, los anclajes y el
// formato se puedan probar (helpContent.test.ts) y para que agregar una
// sección sea agregar un objeto, no maquetar.
//
// Formato de texto: `**así**` es negrita. Nada más — la guía es corta a
// propósito y no necesita un parser de Markdown entero.

export type HelpWhere = "App" | "Web" | "App + Web";

/** Un renglón suelto, o una lista numerada de pasos. */
export type HelpItem = string | { steps: string[] };

export interface HelpSection {
  /** Ancla estable: /ayuda#colaborar. Cambiarla rompe los enlaces que ya existan. */
  id: string;
  title: string;
  where: HelpWhere;
  intro?: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "grabar",
    title: "Grabar tu primera toma",
    where: "App",
    items: [
      "Tocá **Nuevo Proyecto**, ponele nombre y tempo (BPM). El tempo se cambia después desde **Tempo** arriba (o tocándolo al ritmo), y **tocando el reloj** de arriba la línea de tiempo se cuenta en **compases** en vez de minutos.",
      "**Agregar primera pista** → **Grabar pista nueva**. Armala con el botón **R** y tocá **Grabar**.",
      "**Pre-cuenta**: el ícono del cronómetro te da uno o más compases de clic antes de que empiece la toma.",
      "**Usá auriculares con cable.** Con el parlante, lo que ya está grabado se filtra en la toma nueva; el Bluetooth agrega un retraso que no se puede corregir.",
      "**Calibrá una vez por teléfono** (ícono de perillas, arriba → **Medir automáticamente**). La app toca unos clics y mide cuánto tarda el micrófono en escucharlos, para que tus tomas caigan justo en el tiempo. Ahí mismo está **Ganancia del micrófono**, si tus tomas suenan bajas.",
      "La toma empieza donde está el cursor: podés entrar a mitad de canción, sin volver a grabar todo desde el principio. Si grabás **encima** de algo, lo anterior no se pierde: queda como otra **toma**, y con **Tomas** (en la barra del clip) elegís qué parte de cada una queda.",
      "**Placa de sonido USB** (por ejemplo una Focusrite Scarlett): conectala con un cable a USB-C o un adaptador OTG. Cada pista muestra **E1 / E2** para elegir de qué entrada graba, y podés armar dos pistas para grabar voz y guitarra a la vez, cada una en su pista. Con la placa se graba en **24 bit**, con margen para dejar los picos lejos del máximo. La placa se calibra aparte del teléfono.",
      "**Afinador** (ícono de velocímetro arriba, o en el menú ⋮): elegí el instrumento —guitarra, bajo, bajo de 5, ukelele, violín, viola, chelo o cromático— y tocá una cuerda sola. La aguja dice cuántos cents le faltan o le sobran y se pone verde cuando está afinada. Con la placa de sonido USB escucha la placa.",
      "**Teclado MIDI** (por ejemplo un Akai MPK mini, por USB): conectalo y suena al tocar, con el sonido que elijas desde **Teclado** arriba: instrumentos grabados —piano de cola, bajo eléctrico, cuerdas y batería— o sintetizados —piano eléctrico, órgano, pad, bajo o lead—. Los pads tocan la batería. Con una pista armada, **Grabar** graba lo que tocás en el teclado (no el micrófono). En una pista vacía queda como **notas**: tocá el nombre de la pista → **Editar notas** para corregirlas en un piano roll. También se pueden dibujar sin teclado: **Agregar pista** → **Pista de notas**. En una pista que ya tiene audio, queda como una toma más.",
      "**Batería automática** (en **Agregar pista**): elegí un estilo —Rock, Pop, Balada, Cumbia, Reggaetón o Shuffle— y se arma una pista de batería al tempo del proyecto, del largo de la canción y con un redoble cada 8 compases. Sirve para grabar encima sin metrónomo; después es una pista más. **Batería por patrones** (también en **Agregar pista**): armá patrones de 1, 2 o 4 compases tocando la grilla o con los pads del controlador en loop, duplicá uno para hacer un fill y ordená la canción en bloques (\"A ×8, B ×1\"). Mantené apretado un casillero para elegir la fuerza del golpe, y usá **Swing** para darle groove. Para cambiarla después, tocá el nombre de la pista → **Editar batería**.",
    ],
  },
  {
    id: "mezclar",
    title: "Mezclar",
    where: "App",
    items: [
      "Cada pista tiene volumen, paneo, **M** (silenciar) y **S** (solo).",
      "**FX** en cada pista: un **preset** para empezar (Voz, Guitarra, Bajo… y con carácter: Doble voz, Voz con eco, Voz de estadio, Voz distorsionada, Radio vieja, Megáfono, Guitarra crunch…), corte de graves, ecualizador de graves/medios/agudos con la frecuencia de los medios movible, compresor, **puerta de ruido**, **saturación**, **eco** al tempo del proyecto, **doble / chorus** y cuánto manda a la reverb. El botón se pone violeta cuando hay algo activo. Si la pista tiene audio, al final están las **voces extra**: **Armonía** (una pista nueva con la toma a otra altura: siguiendo la escala del tema, como un coro de verdad, o a distancia fija, por ejemplo una quinta arriba) y **Coro** (dos o cuatro copias a los costados, como varias personas cantando lo mismo).",
      "**Máster** (ícono de ecualizador arriba): un ecualizador para toda la mezcla con sus presets (Cálido, Brillante, Parlantes chicos…), el tamaño de la reverb y el limitador, que evita que la mezcla distorsione. Dejalo prendido.",
    ],
  },
  {
    id: "editar",
    title: "Editar y practicar",
    where: "App",
    items: [
      "**Mantené apretado** un clip para seleccionarlo (y sin soltar, arrastralo para moverlo): **Cortar**, **Copiar**, **Pegar**, borrar, y moverlo con el **Imán** (se ajusta al tiempo) o libre. Un toque solo no agarra nada, así podés scrollear tranquilo. Para pegar en **otra pista**: copiá, tocá el lugar de esa pista donde va (aparece un clip punteado) y tocá Pegar; cada Pegar siguiente cae justo después. Para soltar lo copiado, **mantené apretado Pegar**. **Tocá el nombre de una pista** para su menú: **Duplicar pista** (una copia igual, justo debajo, llamada \"Voz-1\") o borrarla.",
      "**Marcadores**: nombrá las partes del tema (Intro, Estribillo…) en la línea de tiempo.",
      "**Loop**: repite el clip seleccionado, el tramo entre marcadores o todo el proyecto. Mantené apretado para elegir el rango a mano. Ideal para ensayar una parte hasta que salga.",
      "**Deshacer** está arriba, por si algo salió mal.",
      "**Importar audio**: sumá un MP3 o WAV de tu teléfono como pista nueva. También podés compartir un audio desde WhatsApp o el mail directo a MY STUDIO.",
      "**Afinar** (en la barra del clip seleccionado): la app encuentra las notas de una voz o de un instrumento de una nota a la vez y las lleva a la escala que elijas (o que detecta). **Natural** corrige cada nota entera y respeta el vibrato; **Robot** es el efecto de autotune. Cada nota se puede arrastrar a otra. El original no se toca: **Quitar afinación** vuelve a como lo grabaste.",
    ],
  },
  {
    id: "exportar",
    title: "Exportar y respaldar",
    where: "App",
    items: [
      "**Exportar y compartir**: **MP3** gratis, para WhatsApp, mail o redes; **WAV 24 bit**, máxima calidad para llevar a otro programa (PRO, o gratis viendo un video); y **Pistas por separado (stems)**, un WAV por pista (PRO). Con **Volumen como en Spotify** prendido, la mezcla sale al nivel de las plataformas (−14 LUFS) sin saturar. **Video para redes**: un video vertical o cuadrado con la onda animada, el título y tu nombre, para Reels, TikTok o Stories (15, 30 o 60 s); el texto para la publicación queda copiado.",
      "**Exportar respaldo** (menú del proyecto): guarda el proyecto COMPLETO en un archivo `.mystudio`. Para restaurarlo, **Importar proyecto**.",
      "**MY STUDIO PRO** es un pago único, para siempre: pistas ilimitadas (la versión gratis tiene 4 por proyecto) y las exportaciones de calidad. Sin PRO, al llegar al límite podés **ver un video** a cambio de una pista más en ese proyecto, cuantas veces quieras.",
    ],
  },
  {
    id: "nube",
    title: "Tu cuenta y la nube",
    where: "App + Web",
    items: [
      "La cuenta es **opcional**: sin cuenta, todo funciona en tu teléfono. Para crearla alcanza con **Continuar con Google**, o con email y contraseña.",
      "Con cuenta, **Sincronizar a la nube** (menú del proyecto) lo sube, y lo ves en la web en **Mis Proyectos**.",
      "Si lo cambiaste en la web, la tarjeta del proyecto en la app avisa **Hay cambios nuevos en la nube** → **Actualizar desde la nube**.",
      "Si lo cambiaste en los dos lados, MY STUDIO te pregunta antes de pisar nada: **Bajar los cambios** o **Subir igual**. Nunca mezcla dos versiones por su cuenta.",
    ],
  },
  {
    id: "banco-de-sonidos",
    title: "Banco de Sonidos",
    where: "App + Web",
    items: [
      "Loops y sonidos listos para sumar a tu tema, con filtros por tipo, instrumento, género, tempo y tonalidad.",
      "**Se escuchan ya ajustados a tu tema**: al tempo de tu proyecto y, en la web, llevados a una tonalidad que combine. Lo que escuchás es lo que se suma.",
      "En la app: **Banco de Sonidos** al agregar una pista, o con el botón del Banco en la cabecera de una pista que ya existe.",
      "En la web, **Solo compatibles** muestra únicamente lo que entra en la tonalidad de tu tema.",
    ],
  },
  {
    id: "arranger",
    title: "El Arranger",
    where: "Web",
    intro: "Armá temas en la computadora con samples y tus propios audios.",
    items: [
      "**Mis Proyectos** → **Nuevo Proyecto**, o **Editar en Arranger** sobre uno sincronizado desde la app.",
      "Arrastrá samples del panel, o subí audios propios: MY STUDIO detecta **tempo y tonalidad** solo, y te dice si el clip **entra** en el tono del tema (y si no, **Adaptar** lo transpone).",
      "**Estirá el borde derecho** de un loop para repetirlo.",
      "Imán a la grilla (compás, 1/2, 1/4…); **Alt** mientras arrastrás lo suelta.",
      "Seleccioná varios clips (Ctrl+click o arrastrando sobre el fondo) para moverlos, duplicarlos (Ctrl+D), copiarlos y pegarlos juntos.",
      "Marcá un loop arrastrando sobre la regla de tiempo, y usá el metrónomo para comprobar que todo va en tiempo.",
      "**Ctrl+Z** deshace, **Ctrl+Y** rehace.",
      "**Guardar** lo sube a la nube, y lo abrís en la app. Si cerrás la pestaña sin guardar, al volver te ofrece recuperar el borrador.",
    ],
  },
  {
    id: "colaborar",
    title: "Comunidad y colaboraciones",
    where: "App + Web",
    intro: "Publicar se puede desde la app o la web; grabar tu parte, desde la app.",
    items: [
      "**Comunidad**: publicá un tema desde la app (en el mezclador, **Publicar en la Comunidad**) o desde la web; escuchá, comentá y dale me gusta a lo de otros en la web. Al publicar podés marcar **qué instrumentos te faltan**.",
      "**Buscan músicos** (web): temas que necesitan a alguien. Filtrá por tu instrumento y pedí sumarte.",
      "**Si sos el autor**: aceptás o rechazás los pedidos (en la web o en el ícono de apretón de manos de la app).",
      "**Si te aceptaron:**",
      {
        steps: [
          "En la app, tocá el **apretón de manos** → buscá el tema → **Abrir**. Se arma un proyecto con una pista por instrumento.",
          "Grabá tu parte ahí.",
          "Desde el mezclador, el ícono de **enviar** → elegí tu pista.",
        ],
      },
      "**La pista enviada dura 7 días**: el autor tiene que bajarla a su proyecto antes (**Agregar a mi proyecto**). Si se vence, se puede volver a mandar desde el mismo proyecto.",
      "Cada colaboración tiene su **Conversación**, en la app y en la web.",
    ],
  },
  {
    id: "mensajes",
    title: "Mensajes y seguridad",
    where: "App + Web",
    items: [
      "**Mensajes**: escribile a alguien desde su perfil en la web. Si esa persona no te sigue, tu primer mensaje le llega como solicitud y no podés seguir escribiendo hasta que acepte. Contestar se puede desde la app o la web.",
      "**Denunciar** y **Bloquear** (menú de tres puntos): bloquear es privado, la otra persona no se entera.",
      "**Eliminar mi cuenta** (en Cuenta): borra tu cuenta y todo lo que subiste a la nube. Los proyectos guardados en tu teléfono no se tocan.",
    ],
  },
];

/** Un pedazo de texto, en negrita o no. */
export interface HelpSpan {
  text: string;
  bold: boolean;
}

/**
 * Parte `**así**` en tramos. Un `**` sin cerrar se deja como texto
 * literal en vez de poner en negrita todo lo que sigue: un error de tipeo
 * en la guía tiene que verse como un error de tipeo, no romper el párrafo.
 */
export function parseHelpText(raw: string): HelpSpan[] {
  const spans: HelpSpan[] = [];
  let rest = raw;
  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) {
      spans.push({ text: rest, bold: false });
      break;
    }
    const close = rest.indexOf("**", open + 2);
    if (close === -1) {
      spans.push({ text: rest, bold: false });
      break;
    }
    if (open > 0) spans.push({ text: rest.slice(0, open), bold: false });
    spans.push({ text: rest.slice(open + 2, close), bold: true });
    rest = rest.slice(close + 2);
  }
  return spans;
}
