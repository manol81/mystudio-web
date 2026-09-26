// src/lib/guides.ts
//
// Las guías de /guias — artículos que responden búsquedas reales.
//
// Por qué existen (plan de SEO, 2026-09-24): el sitio pasó a tener 45
// URLs, pero casi todas describen el PRODUCTO. Lo que trae gente que
// todavía no sabe que MY STUDIO existe es otra cosa: alguien con un
// problema concreto ("mi grabación quedó corrida") buscándolo en
// Google. Cada guía es una URL que puede responder eso, y de paso le
// sirve a quien ya usa la app.
//
// Diferencia con /ayuda, que es lo que más se presta a confusión:
//   · /ayuda es la REFERENCIA — qué hace cada cosa, organizada por
//     tarea, corta, y espejada a mano en la app (ver helpContent.ts).
//   · /guias son ARTÍCULOS — un problema por página, con su porqué.
// Una guía puede enlazar a /ayuda; al revés no, para que la referencia
// siga siendo corta.
//
// El contenido va como DATOS y no como JSX, igual que helpContent: así
// el orden, los slugs y el formato se pueden probar, y escribir una
// guía nueva es agregar un objeto sin maquetar nada.
//
// Formato de texto: `**así**` es negrita, con el mismo parser que la
// ayuda (parseHelpText). Nada de Markdown completo: no hace falta y
// sería otra dependencia.

/** Un bloque de contenido. Un objeto por tipo, para que el render sea un switch y no un parser. */
export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string; id: string }
  | { kind: "ul"; items: string[] }
  | { kind: "steps"; items: string[] }
  /// Un aviso destacado: la advertencia que evita que alguien pierda
  /// una toma, o el dato que explica por qué algo funciona así.
  | { kind: "note"; text: string };

export interface Guide {
  /// Parte de la URL (/guias/<slug>). Cambiarlo rompe los enlaces que
  /// ya existan, igual que las anclas de /ayuda.
  slug: string;
  /// El título de la página y el `<h1>`. Se escribe como lo buscaría
  /// una persona, no como lo nombraría el equipo.
  title: string;
  /// Lo que se ve en el buscador debajo del título, y en el índice.
  description: string;
  /// ISO corta. Sale en el artículo y en los datos estructurados.
  published: string;
  updated?: string;
  minutes: number;
  blocks: GuideBlock[];
  /// Slugs de otras guías relacionadas, para que ninguna sea una hoja
  /// suelta a la que solo se llega desde el sitemap.
  related?: string[];
}

export const GUIDES: readonly Guide[] = [
  {
    slug: "como-no-perder-tus-ideas-de-canciones",
    title: "Cómo no perder tus ideas de canciones",
    description:
      "Se te ocurre algo, pensás «después lo grabo» y a la noche no te acordás. Un método simple para capturar ideas en 30 segundos, encontrarlas semanas después y convertirlas en canciones.",
    published: "2026-09-26",
    minutes: 8,
    blocks: [
      {
        kind: "p",
        text: "Te sale algo tocando la guitarra. Te gusta. Pensás «esto es buenísimo, después lo grabo». A la noche te acordás de que había algo, pero no de qué era. Y si lo recordás a medias, ya no suena igual.",
      },
      {
        kind: "p",
        text: "No es mala memoria ni falta de talento: **las ideas musicales se borran rápido porque no tienen dónde agarrarse**. Una idea escrita se relee; una melodía en la cabeza se desarma sola en minutos. La única defensa es capturarla mientras existe.",
      },
      {
        kind: "p",
        text: "Lo que sigue es un método simple, sacado de cómo trabajan quienes viven de escribir canciones. No hace falta que tengas la canción entera en la cabeza — justamente se trata de lo contrario.",
      },

      { kind: "h2", text: "La regla de oro: rápido, no bien", id: "rapido-no-bien" },
      {
        kind: "p",
        text: "El error más común es querer que la idea esté **buena** antes de grabarla. Que la guitarra suene afinada, que la letra diga algo, que no te escuchen desafinar. Y mientras tanto la idea se va.",
      },
      {
        kind: "p",
        text: "Los que escriben canciones todos los días hacen lo contrario: **optimizan la velocidad de captura, no la calidad**. El razonamiento es simple y difícil de discutir — mejorar una idea que ya existe es fácil; recuperar una que se te olvidó es imposible.",
      },
      {
        kind: "note",
        text: "**Grabá antes de estar listo.** Una toma horrible de 20 segundos, tarareada mal y con ruido de fondo, vale infinitamente más que la idea perfecta que no grabaste.",
      },
      {
        kind: "p",
        text: "Hay un ejemplo famoso de esto. Paul McCartney soñó la melodía de Yesterday y la grabó con una frase cualquiera de relleno —el título provisorio era «huevos revueltos»— solo para no perder la música mientras aparecía la letra. La letra real tardó meses. La melodía estaba guardada desde el primer día.",
      },
      {
        kind: "p",
        text: "Eso es exactamente lo que tenés que hacer: **separar capturar de componer**. Son dos momentos distintos, y mezclarlos es lo que mata las ideas.",
      },

      { kind: "h2", text: "Capturar en 30 segundos", id: "capturar" },
      {
        kind: "steps",
        items: [
          "Abrí MY STUDIO y tocá **Nuevo Proyecto**.",
          "Ponele un nombre que describa el SONIDO, no el número: «riff rápido tipo rock», «vueltita triste en la menor». En un mes, «Idea 7» no te va a decir nada.",
          "Si tenés el pulso claro, poné el BPM aproximado. Si no, dejalo y seguí — no frena nada.",
          "**Agregar pista**, armala con el botón **R**, y grabá. Tocá o tarareá la idea tal como está.",
          "Stop. Listo. No la escuches, no la juzgues, no la borres. Cerrá y seguí con tu día.",
        ],
      },
      {
        kind: "p",
        text: "Si la idea es una melodía pero todavía no tenés letra, **cantala con cualquier palabra**: «na na na», o lo primero que se te cruce. Es el truco de los huevos revueltos, y funciona igual de bien un martes cualquiera.",
      },
      {
        kind: "note",
        text: "Si estás lejos del instrumento —manejando, caminando, en el trabajo—, tarareá al micrófono del teléfono igual. Una idea tarareada mal se reconstruye; una olvidada no.",
      },

      { kind: "h2", text: "El problema del que nadie habla: encontrarlas después", id: "encontrarlas" },
      {
        kind: "p",
        text: "Acá está la trampa. Capturar es la parte fácil, y mucha gente la resuelve: termina con cientos de notas de voz en el teléfono. El problema aparece meses después, cuando querés usar alguna y **no hay forma de saber qué hay adentro de cada archivo**.",
      },
      {
        kind: "p",
        text: "Le pasa hasta a los profesionales. Dan Wilson —el que escribió Closing Time y trabajó con Adele— cuenta que tiene alrededor de mil ideas en sus notas de voz y que **recuperar algo de ahí le resulta casi imposible**; terminó volviendo a un fichero de tarjetas de papel, porque al menos puede revolverlas y encontrarse con algo por casualidad.",
      },
      {
        kind: "p",
        text: "Tres costumbres chicas evitan ese cementerio:",
      },
      {
        kind: "ul",
        items: [
          "**Nombrá por sonido, no por fecha.** «lento con acordes abiertos» se encuentra; «Proyecto 12» no.",
          "**Poné un marcador donde está lo bueno.** Si la idea aparece recién en el segundo 40, después de dos intentos fallidos, marcala ahí y ponele nombre: «el estribillo». Cuando vuelvas, vas directo.",
          "**Sincronizá con tu cuenta.** Las ideas dejan de vivir en un solo teléfono: si lo cambiás, lo perdés o se rompe, tus ideas siguen ahí.",
        ],
      },

      { kind: "h2", text: "La revisión semanal", id: "revision" },
      {
        kind: "p",
        text: "Capturar sin revisar es juntar, no componer. La segunda costumbre de los que escriben seguido es **una pasada regular** por lo capturado: una vez por semana, veinte minutos, escuchás lo que grabaste y decidís una de tres cosas por idea.",
      },
      {
        kind: "ul",
        items: [
          "**Sigue viva** → dejala y, si podés, sumale algo hoy mismo: una segunda pista, una vuelta más, una letra provisoria.",
          "**No era nada** → borrala sin culpa. Que una idea no sobreviva a la semana no es un fracaso; es información.",
          "**No sé** → dejala quieta. En un mes la escuchás distinto.",
        ],
      },
      {
        kind: "note",
        text: "Escuchar una idea propia una semana después es lo más parecido a escucharla como la escucharía otro. Ese desfasaje es gratis y no se puede comprar: usalo.",
      },

      { kind: "h2", text: "De idea suelta a canción", id: "convertir" },
      {
        kind: "p",
        text: "Una idea que sobrevive a dos revisiones merece una segunda pista. Y esa segunda pista es donde la cosa cambia de categoría: apenas escuchás tu guitarra y cantás encima, deja de ser un fragmento y empieza a sonar a canción. Es el momento en que la mayoría abandona, y es exactamente el que no hay que saltear.",
      },
      {
        kind: "p",
        text: "No hace falta que la canción esté terminada para eso. Al revés: agregar una pista suele ser lo que **destraba** la parte que faltaba.",
      },
      {
        kind: "ul",
        items: [
          "¿Tenés la música y no la letra? Grabá la voz con palabras de relleno y escuchalo. La letra aparece más fácil sobre algo que suena que sobre un papel en blanco.",
          "¿Tenés la letra y no la música? Grabá un rasgueo simple y recitá encima. El ritmo del habla te va a marcar la melodía.",
          "¿Tenés dos partes sueltas y no sabés si pegan? Ponelas una después de la otra en el mismo proyecto. En dos minutos sabés.",
        ],
      },

      { kind: "h2", text: "Cuando te trabás", id: "trabado" },
      {
        kind: "p",
        text: "Quedarse en blanco no se arregla esperando la inspiración. Jeff Tweedy, de Wilco, escribió un libro entero sobre esto y su consejo central es casi aburrido de tan práctico: **escribir un rato todos los días**, aunque sean unos minutos, y terminar lo que empezaste aunque no te convenza. Sin esa constancia, dice, te quedan las pocas canciones al año que lleguen solas.",
      },
      {
        kind: "p",
        text: "Sus ejercicios para destrabar son concretos y se hacen en diez minutos:",
      },
      {
        kind: "ul",
        items: [
          "**Escalera de palabras**: elegí un oficio (médico, panadero, mecánico) y anotá diez verbos de esa actividad. Después mirá alrededor y anotá diez objetos que veas. Cruzá verbos con objetos hasta que aparezca una combinación rara que te guste. De ahí sale un verso.",
          "**Robar palabras de un libro**: abrí cualquier libro en una página al azar, tomá cinco o seis palabras sueltas y obligate a usarlas.",
          "**Recortar y mezclar**: escribí varias frases, cortalas por la mitad y pegá principios con finales que no les correspondían.",
        ],
      },
      {
        kind: "note",
        text: "El objetivo de estos ejercicios no es escribir algo bueno: es **escribir algo**. Lo bueno se elige después, y solo se puede elegir entre lo que existe.",
      },

      { kind: "h2", text: "Mostrala antes de terminarla", id: "compartir" },
      {
        kind: "p",
        text: "La última costumbre es la que más cuesta y la que más rinde: **mostrar la idea antes de que esté lista**. No la versión final, no la mezcla perfecta — el fragmento tal como está.",
      },
      {
        kind: "p",
        text: "Sirve por tres motivos bien concretos, y ninguno es emocional:",
      },
      {
        kind: "ul",
        items: [
          "**Te obliga a cerrar algo.** Una idea que nadie va a escuchar se puede dejar a medias para siempre.",
          "**Te dice dónde está el problema**, que casi nunca es donde creías. Un comentario anclado en el segundo 48 vale más que diez «está bueno».",
          "**Consigue lo que te falta.** Si la canción pide un bajo y vos no tocás el bajo, decilo: alguien que sí toca puede grabar su parte en su teléfono y mandártela para que la sumes a tu proyecto.",
        ],
      },
      {
        kind: "p",
        text: "Ese último punto cambia el cálculo por completo. Durante décadas, terminar una canción con banda significaba conseguir una banda, un lugar y un día en que todos pudieran. Hoy alcanza con publicar el tema diciendo qué instrumento te falta.",
      },

      { kind: "h2", text: "El método, en cinco líneas", id: "resumen" },
      {
        kind: "ul",
        items: [
          "**Capturá rápido, no bien.** Veinte segundos horribles le ganan a la idea perfecta que no grabaste.",
          "**Nombrá por sonido** y marcá dónde está lo bueno, o no lo vas a encontrar nunca más.",
          "**Revisá una vez por semana** y borrá sin culpa lo que no sobrevivió.",
          "**Sumá la segunda pista** apenas una idea aguante dos revisiones: ahí deja de ser un fragmento.",
          "**Mostrala antes de terminarla**, y pedí el instrumento que te falta.",
        ],
      },
      {
        kind: "p",
        text: "Nada de esto pide talento extra ni equipo caro. Pide tener el grabador a un toque de distancia y la costumbre de usarlo cuando la idea aparece, que es siempre en el peor momento.",
      },
    ],
    related: [
      "como-grabar-guitarra-y-voz-en-el-celular",
      "que-es-el-bpm-y-como-saber-el-de-tu-cancion",
    ],
  },

  {
    slug: "por-que-mi-grabacion-queda-corrida",
    title: "Por qué tu grabación queda corrida (y cómo arreglarlo)",
    description:
      "Grabás una pista sobre otra, la escuchás y quedó adelantada o atrasada. No tocaste mal: es la latencia del teléfono. Qué es, por qué pasa y cómo se compensa.",
    published: "2026-09-24",
    minutes: 5,
    blocks: [
      {
        kind: "p",
        text: "Grabás la guitarra sobre una base que ya tenías, la escuchás y algo no cierra: el golpe está corrido. Volvés a grabar con más cuidado y queda corrido igual, siempre para el mismo lado. **No estás tocando mal.** Es un problema conocido de cualquier grabación multipista, y tiene solución exacta.",
      },
      { kind: "h2", text: "Qué es la latencia", id: "que-es" },
      {
        kind: "p",
        text: "Entre que el sonido entra por el micrófono y que el teléfono lo guarda, pasa un tiempo. Y entre que el teléfono decide reproducir la base y que sale por el auricular, pasa otro. Esa demora se llama **latencia**, y en un celular anda entre 20 y 200 milisegundos según el modelo.",
      },
      {
        kind: "p",
        text: "El problema no es que exista: es que vos tocás siguiendo lo que **escuchás**. Si la base te llega tarde, vos tocás tarde para acompañarla, y encima lo que tocás se guarda todavía más tarde. Las dos demoras se suman y quedan grabadas en la pista.",
      },
      {
        kind: "note",
        text: "Por eso siempre queda corrido **para el mismo lado**: la pista nueva suena atrasada respecto de las anteriores. Si fuera un error tuyo, a veces se adelantaría y a veces se atrasaría.",
      },
      { kind: "h2", text: "La solución: medir esa demora una vez", id: "calibrar" },
      {
        kind: "p",
        text: "Como la demora es siempre la misma en un mismo teléfono con los mismos auriculares, alcanza con medirla una vez y descontarla de cada toma. Eso es **calibrar la latencia**. En MY STUDIO lo hace la app sola:",
      },
      {
        kind: "steps",
        items: [
          "Abrí un proyecto y tocá el ícono de **Calibración** en la barra de arriba (si no lo ves, está en el menú de tres puntos).",
          "Tocá **Medir automáticamente**.",
          "**Sacate los auriculares** y subí el volumen del teléfono: el micrófono tiene que poder escuchar el parlante.",
          "Quedate quieto y en silencio unos cinco segundos. La app toca ocho clics, los graba y mide cuánto tardaron en volver.",
          "Tocá **Usar este valor**. Listo: se aplica a todas las tomas que grabes de ahí en adelante.",
        ],
      },
      {
        kind: "p",
        text: "La medición toma los ocho clics y se queda con el valor del medio, no con el promedio: así un ruido suelto de la habitación no arrastra el resultado. Si las ocho mediciones salen muy distintas entre sí, la app **rechaza el resultado** en vez de darte un número inventado — casi siempre significa que había ruido o que el volumen estaba muy bajo.",
      },
      { kind: "h2", text: "Si todavía queda corrido", id: "ajuste-fino" },
      {
        kind: "p",
        text: "El mismo diálogo tiene un slider manual para ajustar a mano después de medir. La prueba casera es esta: grabá el metrónomo, después grabá una palmada justo en el pulso, y escuchá las dos juntas.",
      },
      {
        kind: "ul",
        items: [
          "La palmada suena **tarde** → subí el valor (recorta el arranque de la toma).",
          "La palmada suena **temprano** → bajalo, incluso por debajo de cero (agrega silencio al arranque).",
        ],
      },
      {
        kind: "note",
        text: "Hay un segundo ajuste, aparte: **sincronía del metrónomo**. Ese no corrige la grabación sino el clic contra las pistas que ya tenías. Son dos cosas distintas a propósito, porque se desajustan por motivos distintos.",
      },
      { kind: "h2", text: "Lo que ninguna calibración arregla", id: "auriculares" },
      {
        kind: "p",
        text: "**Usá auriculares con cable.** No es un consejo de calidad de sonido, es lo que hace que todo lo anterior sirva:",
      },
      {
        kind: "ul",
        items: [
          "Con el **parlante**, lo que ya está grabado se filtra dentro de la toma nueva. Después no hay forma de separarlo.",
          "Con **Bluetooth**, la demora cambia sola de un momento a otro — el propio protocolo la ajusta sin avisar. Un número fijo no puede compensar algo que se mueve.",
        ],
      },
      {
        kind: "p",
        text: "Si cambiás de auriculares o de teléfono, volvé a calibrar: la demora es de esa combinación, no del programa.",
      },
    ],
    related: ["como-grabar-guitarra-y-voz-en-el-celular"],
  },

  {
    slug: "como-grabar-guitarra-y-voz-en-el-celular",
    title: "Cómo grabar guitarra y voz en el celular, paso a paso",
    description:
      "Grabar dos pistas y escucharlas juntas, sin placa de audio ni computadora. El orden que conviene, qué hacer con el metrónomo y los errores que cuestan una toma.",
    published: "2026-09-24",
    minutes: 6,
    blocks: [
      {
        kind: "p",
        text: "La idea es simple: grabás la guitarra, después grabás la voz **escuchando** la guitarra, y al final las dos suenan juntas. Eso es grabar multipista, y hoy entra entero en un teléfono. Lo que sigue es el orden que menos problemas trae.",
      },
      { kind: "h2", text: "Antes de apretar Grabar", id: "antes" },
      {
        kind: "ul",
        items: [
          "**Auriculares con cable.** Sin esto, la guitarra que ya grabaste se cuela dentro de la toma de voz y no se puede sacar. El Bluetooth, además, mete un retraso que cambia solo.",
          "**Calibrá la latencia una vez.** Dos minutos que evitan que todo lo que grabes quede corrido — está explicado en la guía de al lado.",
          "**Elegí el tempo (BPM) del proyecto** antes de grabar. Cambiarlo después no mueve lo ya grabado.",
        ],
      },
      { kind: "h2", text: "La primera pista: la guitarra", id: "primera-pista" },
      {
        kind: "steps",
        items: [
          "**Nuevo Proyecto**, ponele nombre y tempo.",
          "**Agregar primera pista** y nombrala «Guitarra» — con tres o cuatro pistas, los nombres dejan de ser un lujo.",
          "Armá la pista con el botón **R** (queda en rojo: es la que va a grabar).",
          "Activá el **metrónomo** y, si querés, la **pre-cuenta**: te da un compás de clic antes de que empiece la toma, para entrar a tiempo.",
          "Tocá **Grabar**. Al terminar, **Stop**.",
        ],
      },
      {
        kind: "note",
        text: "El metrónomo no queda grabado en la pista: lo escuchás vos mientras tocás y no aparece en la mezcla ni en lo que exportás.",
      },
      {
        kind: "p",
        text: "Escuchala antes de seguir. Si esta pista quedó torcida, todo lo que grabes encima va a heredar el problema — es más barato repetirla ahora que arreglar cuatro pistas después.",
      },
      { kind: "h2", text: "La segunda pista: la voz", id: "segunda-pista" },
      {
        kind: "steps",
        items: [
          "**Agregar pista**, nombrala «Voz».",
          "Desarmá la guitarra (sacale el **R**) y armá la voz. Si dejás las dos armadas, grabás encima de lo que ya tenías.",
          "Tocá **Grabar**: vas a escuchar la guitarra por los auriculares mientras cantás.",
        ],
      },
      {
        kind: "note",
        text: "**El error que cuesta una toma**: grabar con la pista equivocada armada. Por eso el estado de «armada» no se guarda entre sesiones — si volvés a abrir el proyecto dentro de una semana, ninguna pista arranca armada, para que no grabes encima de algo por reflejo.",
      },
      {
        kind: "p",
        text: "¿Te equivocaste solo en una parte? No hace falta repetir todo: movés el cursor al segundo donde empieza el problema y grabás desde ahí. Eso es un **punch-in**. La app te avisa antes, porque reemplaza lo que había en esa pista.",
      },
      { kind: "h2", text: "Mezclar: que se escuchen las dos", id: "mezclar" },
      {
        kind: "p",
        text: "Grabar es la mitad. Que suenen bien juntas es la otra, y casi siempre se resuelve con tres controles:",
      },
      {
        kind: "ul",
        items: [
          "**Volumen** de cada pista. Si la voz se pierde, antes de subirla probá bajar la guitarra: subir todo hasta el tope hace que la mezcla distorsione.",
          "**Paneo**: la voz al centro y la guitarra un poco hacia un costado ya separa las dos cosas y se entiende mejor.",
          "**Solo** y **Mute** para escuchar una sola pista y encontrar qué está molestando.",
        ],
      },
      {
        kind: "p",
        text: "Con eso alcanza para una maqueta. Si querés ir más allá, cada pista tiene ecualizador, compresor y un envío a la reverb del máster; y lo que escuchás es exactamente lo que se exporta, así que no hay sorpresas al final.",
      },
      { kind: "h2", text: "Y después", id: "despues" },
      {
        kind: "ul",
        items: [
          "**Exportá a MP3** para compartir por WhatsApp o mail.",
          "**Sincronizá el proyecto** con tu cuenta para seguir editándolo en el navegador o recuperarlo si cambiás de teléfono.",
          "**Publicalo** en la Comunidad diciendo qué instrumento te falta: otro músico puede grabar su parte y mandártela para que la sumes.",
        ],
      },
    ],
    related: [
      "por-que-mi-grabacion-queda-corrida",
      "como-no-perder-tus-ideas-de-canciones",
      "que-es-el-bpm-y-como-saber-el-de-tu-cancion",
    ],
  },

  {
    slug: "que-es-el-bpm-y-como-saber-el-de-tu-cancion",
    title: "Qué es el BPM y cómo saber el de tu canción",
    description:
      "BPM es la velocidad de una canción. Para qué sirve saberlo, cómo se cuenta a mano y cómo detectarlo automáticamente en un audio que ya tenés grabado.",
    published: "2026-09-24",
    minutes: 4,
    blocks: [
      {
        kind: "p",
        text: "**BPM** son las siglas de *beats per minute*: cuántos pulsos entran en un minuto. Es la velocidad de la canción. Una balada anda por 70, un tema de rock por 120, algo bien rápido por 160.",
      },
      {
        kind: "p",
        text: "El pulso es eso que marcás con el pie sin pensarlo cuando escuchás música. Contá cuántas veces lo marcás en un minuto y ese es el BPM.",
      },
      { kind: "h2", text: "Para qué te sirve saberlo", id: "para-que" },
      {
        kind: "ul",
        items: [
          "**Para que el metrónomo te sirva.** Si el clic no está a la velocidad de tu tema, molesta en vez de ayudar.",
          "**Para que los loops encajen.** Un loop de batería grabado a 90 BPM metido en un tema de 120 suena fuera de tiempo, salvo que el programa lo estire.",
          "**Para grabar de a partes.** Si todo está en la misma grilla, podés grabar el estribillo hoy y la estrofa mañana y que peguen.",
        ],
      },
      { kind: "h2", text: "Cómo contarlo a mano", id: "a-mano" },
      {
        kind: "steps",
        items: [
          "Poné la canción y marcá el pulso con el pie o con la mano.",
          "Contá cuántos pulsos hacés en 15 segundos.",
          "Multiplicá por 4. Eso es el BPM.",
        ],
      },
      {
        kind: "note",
        text: "Si te da algo como 60 en un tema que se siente rápido, probablemente estés contando de a dos pulsos. El doble (120) y la mitad (30) de un tempo son ambos «correctos» matemáticamente; el que vale es el que se siente natural para marcar con el pie.",
      },
      { kind: "h2", text: "Cómo detectarlo automáticamente", id: "detectar" },
      {
        kind: "p",
        text: "Si ya tenés el audio, no hace falta contar. Al subir un archivo al Arranger de MY STUDIO en el navegador, el tempo se **detecta solo**: el programa busca los ataques (los golpes) y calcula cada cuánto se repiten.",
      },
      {
        kind: "p",
        text: "Hay una decisión ahí que conviene entender, porque es la diferencia entre que te ayude y que te arruine un archivo: **detectar el tempo no es lo mismo que cambiarlo.**",
      },
      {
        kind: "ul",
        items: [
          "Si el archivo es **corto y calza en compases enteros** —o sea, es un loop— se estira para que entre en el tempo de tu proyecto.",
          "Si es una **canción entera**, el tempo se te informa y no se toca nada. Estirar tres minutos de música sin que nadie lo pida es un desastre silencioso.",
        ],
      },
      {
        kind: "p",
        text: "Y si el audio no tiene pulso claro —un pad, un efecto, una nota larga— el detector lo dice en vez de inventar un número. Un BPM inventado es peor que ninguno: hace que el archivo aparezca cuando filtrás por un tempo que en realidad no tiene.",
      },
      { kind: "h2", text: "El BPM y la tonalidad no son lo mismo", id: "y-la-tonalidad" },
      {
        kind: "p",
        text: "Se nombran juntos todo el tiempo, pero son cosas distintas: el BPM es **cuán rápido** va, la tonalidad es **en qué nota** está. Los dos importan para que un sample entre en tu canción, y los dos se ajustan solos al soltarlo en el Arranger. En el Banco de Sonidos cada sonido trae los dos datos en su ficha.",
      },
    ],
    related: ["como-grabar-guitarra-y-voz-en-el-celular"],
  },
];

export function guideBySlug(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

/// Las relacionadas de una guía, ya resueltas y sin la guía misma.
export function relatedGuides(guide: Guide): Guide[] {
  return (guide.related ?? [])
    .filter((slug) => slug !== guide.slug)
    .map(guideBySlug)
    .filter((g): g is Guide => g !== null);
}
