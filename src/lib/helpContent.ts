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
      "**Pre-cuenta** (arriba, en **Grabar**): te da uno o más compases de clic antes de que empiece la toma. Para que el **clic** suene más fuerte o más suave, **mantené apretado** su botón (al lado de Grabar).",
      "**Usá auriculares con cable.** Con el parlante, lo que ya está grabado se filtra en la toma nueva; el Bluetooth agrega un retraso que no se puede corregir.",
      "**Calibrá una vez por teléfono** (arriba, **Grabar → Calibrar latencia → Medir automáticamente**). La app toca unos clics y mide cuánto tarda el micrófono en escucharlos, para que tus tomas caigan justo en el tiempo. Ahí mismo está **Ganancia del micrófono**, si tus tomas suenan bajas.",
      "La toma empieza donde está el cursor: podés entrar a mitad de canción, sin volver a grabar todo desde el principio. Si grabás **encima** de algo, lo anterior no se pierde: queda como otra **toma**, y con **Tomas** (en la barra del clip) elegís qué parte de cada una queda.",
      "**Placa de sonido USB** (por ejemplo una Focusrite Scarlett): conectala con un cable a USB-C o un adaptador OTG. Cada pista muestra **E1 / E2** para elegir de qué entrada graba, y podés armar dos pistas para grabar voz y guitarra a la vez, cada una en su pista. Con la placa se graba en **24 bit**, con margen para dejar los picos lejos del máximo. La placa se calibra aparte del teléfono.",
      "**Afinador** (arriba, en **Grabar**): elegí el instrumento —guitarra, bajo, bajo de 5, ukelele, violín, viola, chelo o cromático— y tocá una cuerda sola. La aguja dice cuántos cents le faltan o le sobran y se pone verde cuando está afinada. Con la placa de sonido USB escucha la placa.",
      "**Teclado MIDI** (por ejemplo un Akai MPK mini, por USB): conectalo y suena al tocar, con el sonido que elijas desde **Teclado** arriba: instrumentos grabados —piano de cola, bajo eléctrico, cuerdas y batería— o sintetizados —piano eléctrico, órgano, pad, bajo o lead—. Los pads tocan la batería. Con una pista armada, **Grabar** graba lo que tocás en el teclado (no el micrófono). En una pista vacía queda como **notas**: tocá el nombre de la pista → **Editar notas** para corregirlas en un piano roll: ahí se elige el instrumento, y **Grabar** toca el proyecto y anota lo que tocás encima. Manteniendo apretado se eligen varias notas para moverlas, copiarlas, repetirlas o subirlas de tono. También se pueden dibujar sin teclado: **Agregar pista** → **Pista de notas**. En una pista que ya tiene audio, queda como una toma más.",
      "**Batería automática** (en **Agregar pista**): elegí un estilo —Rock, Pop, Balada, Cumbia, Reggaetón o Shuffle— y se arma una pista con una batería grabada de verdad, al tempo del proyecto, del largo de la canción y con un redoble cada 8 compases. Sirve para grabar encima sin metrónomo; después es una pista más. **Batería por patrones** (también en **Agregar pista**): armá patrones de 1, 2 o 4 compases tocando la grilla o con los pads del controlador en loop, duplicá uno para hacer un fill y ordená la canción en bloques (\"A ×8, B ×1\"). Mantené apretado un casillero para elegir la fuerza del golpe, y usá **Swing** para darle groove. En **Más sonidos** hay pandereta, shaker, cencerro, claves y otras variantes; **Caja grande** suena como en un gran salón. Para cambiarla después, también si es una batería automática, tocá el nombre de la pista → **Editar batería**.",
      "**La banda que te escucha** (en **Agregar pista**): grabá tu idea con guitarra o piano **al clic** del proyecto, con o sin voz, y la app escucha los acordes compás por compás. Corregí el que haya salido mal tocándolo (ahí también le das color: 7, maj7, 6, 9 o sus4), elegí el estilo —rock, pop, balada, cumbia, reggaetón, shuffle, blues lento, funk, bossa nova o jazz— y los instrumentos —batería, bajo, piano, cuerdas y órgano— y tocá **Armar la banda**. Cada uno toca como un músico: varía al final de cada frase, sube en la segunda parte, el bajo camina hacia el acorde que viene y el piano arpegia o se adelanta a los cambios; con **Cierre al final** la banda termina la canción. En **Cómo toca cada uno** elegís la fuerza de cada instrumento (suave, media o fuerte) y si toca **simple**, sin adornos. Cada instrumento queda en su pista, ya mezclado, y se edita tocando su nombre (el bajo, el piano y las cuerdas en el piano roll; la batería en su editor). Los acordes quedan en una franja arriba de las pistas: tocá uno para cambiarlo y **Rearmar la banda** para que lo siga.",
      "**Tararear una melodía** (en **Agregar pista**): grabá la melodía cantando o tarareando al clic —mejor con «ta» o «na» en cada nota—, y después tocá el nombre de la pista → **Pasar a notas**. Elegí el instrumento (piano, bajo, cuerdas, lead…) y la octava, y si va al compás y a la escala: se crea una pista de notas que se corrige en el piano roll, y la voz queda silenciada como guía. Sirve con cualquier pista donde se cante una melodía.",
      "**Pads (sampler)** (en **Agregar pista**): 16 pads en 4 bancos, a pantalla completa. Cada pad toma un sonido grabado, importado, del Banco de Sonidos o de cualquier pista del proyecto (también desde un clip: **Sonido → Al sampler**, en la barra del clip). Se elige qué parte suena, si es un golpe, se mantiene o hace loop, al revés, el tono, el volumen, un grupo de corte y uno de los dos buses de efectos (filtro, lo-fi, vinilo, cassette, stutter, eco de cinta). **Cortar** reparte un sample en varios pads. Se tocan en la pantalla o con un controlador de pads (como el Akai MPK mini; si manda otras notas, **Aprender**). Los **patrones** se arman tocando con **Grabar** o paso por paso, y **Pasar al proyecto** los convierte en una pista que se vuelve a editar desde su nombre.",
      "**Grabar sin clic (tempo inteligente)**: grabá una idea a tu tiempo (**Nueva pista → Grabar una idea libre**, o con el metrónomo apagado) y la app encuentra el pulso. En **Al tempo** (en la barra del clip, dentro de **Tono y tempo**) se ve cada pulso sobre la onda, se escucha con un clic encima, se corrige (×2, ÷2, dónde cae el «1») y se elige si el proyecto pasa a ese tempo o la toma se lleva al del proyecto. La toma queda en compás, lista para sumarle una banda, una batería o pads. El original queda guardado: **Deshacer** vuelve a él.",
      "**Lo que ya tocaste**: con una pista armada, la app se acuerda de los últimos 4 minutos que tocaste aunque no hayas apretado Grabar. Si te salió algo bueno, tocá **Guardá eso** (al lado del medidor del micrófono) y elegí cuánto. Lo tocado con la canción sonando queda en su lugar; con el **loop** prendido, cada vuelta queda como una toma, y en **Tomas** armás la mejor. Lo tocado sin la canción queda en el cursor, listo para **Al tempo**. Con un teclado MIDI, lo mismo con las notas.",
    ],
  },
  {
    id: "mezclar",
    title: "Mezclar",
    where: "App",
    items: [
      "Cada pista tiene volumen, paneo, **M** (silenciar) y **S** (solo).",
      "**FX** en cada pista: un **preset** para empezar (Voz, Guitarra, Bajo… y con carácter: Doble voz, Voz con eco, Voz de estadio, Voz distorsionada, Radio vieja, Megáfono, Guitarra crunch…), corte de graves, ecualizador de graves/medios/agudos con la frecuencia de los medios movible, compresor, **puerta de ruido**, **saturación**, **eco** al tempo del proyecto, **doble / chorus** y cuánto manda a la reverb. El botón se pone violeta cuando hay algo activo. Si la pista tiene audio, al final están las **voces extra**: **Armonía** (una, dos o tres voces nuevas con la toma a otra altura: siguiendo la escala del tema —que se ve y se corrige antes de crear— y sus acordes si los hay, y ya afinadas; o a distancia fija, por ejemplo una quinta arriba) y **Coro** (dos o cuatro copias a los costados, cada una desafinada apenas a su manera, como varias personas cantando lo mismo).",
      "**Máster** (arriba, **Canción → Efectos del máster**): un ecualizador para toda la mezcla con sus presets (Cálido, Brillante, Parlantes chicos…), el tamaño de la reverb y el limitador, que evita que la mezcla distorsione. Dejalo prendido.",
      "**Automatización** (tocá el nombre de una pista): una curva que cambia el **volumen**, el **paneo** o la **reverb** de la pista a lo largo del tema. En **Puntos** tocás para poner uno, lo arrastrás o lo mantenés apretado para borrarlo; en **Tramo** marcás una parte y le ponés un valor. Se escucha mientras se edita. El volumen se suma al fader; el paneo y la reverb, mientras tengan curva, reemplazan a los de la pista. En la cabecera aparece una rayita naranja cuando la pista tiene curvas.",
      "**Modo en vivo** (arriba, **En vivo**): para tocar con secuencias. Un lado va a los auriculares o in-ears de la **banda**, con toda la canción, el clic y las pistas que marques **solo para la banda**; el otro va al **frente**, con todo menos eso. Cada lado en mono, sin importar el paneo. Sin placa, con un cable «Y» (de plug estéreo a dos plugs mono) en el jack o el adaptador USB-C; con placa, por sus **salidas 1 y 2**. Antes de tocar, **Probar la conexión** hace sonar cada lado por separado. Una **guía hablada** («Coro», «Puente», «1, 2, 3, 4») es una pista que grabás con tu voz y marcás solo para la banda. En la misma hoja está el **volumen del clic** y la **lista de temas** del show: arriba de las pistas se ve cuál sigue y se pasa con un toque, o solo al terminar la canción.",
      "**Amplificador y pedales** (en **FX** de una pista, se abre solo con **Guitarra eléctrica**): para una guitarra grabada directo, con la placa en modo instrumento o un cable. Elegí un sonido —Limpio brillante, Blues, Crunch clásico, Rock, Solo con eco, Metal, Fuzz, Funk con wah, Ambiente…— y en **Abrir la pedalera completa** ajustá cada pedal en el orden de una pedalera real: puerta de ruido, compresor, wah, distorsión (overdrive, distorsión o fuzz), amplificador (limpio, crunch o lead, con graves, medios, agudos, presencia y master), bafle (1×12, 2×12 o 4×12), modulación (chorus, flanger, phaser o trémolo) y eco (libre o a tempo). Se escucha mientras lo movés. También hay sonidos de **bajo** (amplificador limpio o saturado, bafles 1×15, 4×10 y 8×10, octavador y mezcla con la línea directa). Con **Escuchar mientras tocás**, la pista armada y auriculares o una placa, te escuchás con la pedalera al instante; lo que se graba es el sonido limpio, así después lo podés cambiar. En el bafle, **Tu IR** carga un IR en WAV (la «huella» de un bafle real con su micrófono; hay muchos gratis en internet) y suena en lugar del simulado; queda guardado con el proyecto. También hay **boost** (limpio, de agudos o de medios), **ecualizador** (cortes de graves y agudos, medios movibles) y **reverb** (resorte, sala o hall), y dos amplificadores más: **Clase A** (brillante, de la familia del AC30) y **Moderno** (muy alta ganancia, para metal).",
      "**Tocar en vivo con la pedalera** (en vez de llevar una pedalera): en la pedalera de la pista hay **escenas** —hasta 8 pedaleras enteras: la de la estrofa, la del estribillo, la del solo—; tocá una para editarla y escucharla. Para que cambie sola en la canción, en **Automatización → Escenas** tocá donde querés el cambio y elegí la escena; con **Pedalera…** cualquier perilla (la distorsión que crece, el wah como pedal de expresión, cuánto eco) se mueve sola con una curva. Los cambios no hacen clic, y el eco y la reverb dejan sonar su cola. En el **Modo en vivo**, marcá tus pistas como **Mi instrumento** (la guitarra en la entrada 1 de la placa y el bajo en la 2): se escuchan con su pedalera sin armarlas, así nunca graban por error. **Pedalera en vivo** muestra las escenas en botones grandes para cambiar a mano; también con un pedal Bluetooth de pasar páginas o un pedal MIDI. Los ecos a tempo siguen el tempo del proyecto.",
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
      "**Afinar** (en la barra del clip seleccionado, dentro de **Tono y tempo**): la app encuentra las notas de una voz o de un instrumento de una nota a la vez y las lleva a la escala que elijas (o que detecta). **Natural** corrige cada nota entera y respeta el vibrato; **Robot** es el efecto de autotune. Cada nota se puede arrastrar a otra. El original no se toca: **Quitar afinación** vuelve a como lo grabaste.",
      "**Limpiar** (en la barra del clip seleccionado, dentro de **Sonido**): la app escucha la toma y encuentra el **ruido de fondo**, el **zumbido** de la electricidad, las **eses** fuertes y los **golpes de aire**, con lo que conviene ya prendido. Escuchá los primeros segundos **Original** y **Limpio**, y tocá **Limpiar**. El original queda guardado: **Deshacer**, o **Volver a la toma original** en la misma hoja.",
    ],
  },
  {
    id: "exportar",
    title: "Exportar y respaldar",
    where: "App",
    items: [
      "**Exportar** (arriba, **Compartir → Exportar audio o video**): **MP3** gratis, para WhatsApp, mail o redes; **WAV 24 bit**, máxima calidad para llevar a otro programa (PRO, o gratis viendo un video); y **Pistas por separado (stems)**, un WAV por pista (PRO). Con **Volumen como en Spotify** prendido, la mezcla sale al nivel de las plataformas (−14 LUFS) sin saturar. **Video para redes**: un video vertical o cuadrado con la onda animada, el título y tu nombre, para Reels, TikTok o Stories (15, 30 o 60 s); el texto para la publicación queda copiado.",
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
          "Desde el mezclador, **Compartir → Mandarle mi pista al autor** → elegí tu pista.",
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
