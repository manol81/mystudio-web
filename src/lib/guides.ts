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
    related: ["por-que-mi-grabacion-queda-corrida", "que-es-el-bpm-y-como-saber-el-de-tu-cancion"],
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
