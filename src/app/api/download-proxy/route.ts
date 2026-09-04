import { NextRequest, NextResponse } from "next/server";

// Proxy de descarga — evita el problema real de CORS al leer los bytes
// de un .mystudio desde el navegador (ver ProjectViewer.tsx).
//
// Lo que en realidad pasaba: CUALQUIER fetch() hecho desde JS en el
// navegador hacia una URL de Firebase Storage necesita que el bucket
// tenga CORS configurado explícitamente (gsutil/gcloud) — esto es
// cierto tanto para getBytes() como para getDownloadURL() + fetch(), a
// diferencia de lo que probamos antes. El botón "Descargar" funcionaba
// porque un <a href> es una navegación del navegador, no una lectura
// por JS — eso nunca pasa por CORS. Configurar CORS en el bucket
// requiere el CLI de Google Cloud (gcloud/gsutil), que no está
// instalado acá — en vez de pedirte instalarlo, esta ruta hace el
// fetch server-to-server (Node, sin restricción de CORS — eso es
// puramente un concepto del navegador) y le devuelve los bytes al
// cliente desde NUESTRO propio origen, que sí es same-origin.
//
// Seguridad: getDownloadURL() ya validó del lado del cliente que el
// usuario tiene permiso (storage.rules exige sesión + ser el dueño) —
// la URL resultante trae su propio token de descarga, así que un fetch
// anónimo acá adentro no repite ningún chequeo de más. Esta ruta valida
// que el dominio de destino sea realmente de Firebase/Google Cloud
// Storage Y que el bucket sea el NUESTRO — solo restringir por dominio
// dejaba esta ruta funcionar como proxy abierto y anónimo hacia
// CUALQUIER objeto público de CUALQUIER bucket de Google Cloud (propio
// o ajeno), lo que permitía usar nuestro servidor como relay gratuito
// de ancho de banda para contenido de terceros.
const ALLOWED_HOSTS = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

const OWN_BUCKET = "my-studio-4530a.firebasestorage.app";

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "Falta el parámetro url." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida." }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "Dominio no permitido." }, { status: 403 });
  }

  // Ambos formatos de URL de descarga (firebasestorage.googleapis.com/v0/b/<bucket>/o/...
  // y storage.googleapis.com/<bucket>/...) traen el nombre del bucket
  // como segmento literal del path.
  if (!parsed.pathname.includes(`/${OWN_BUCKET}/`)) {
    return NextResponse.json({ error: "Bucket no permitido." }, { status: 403 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `No se pudo descargar el archivo (HTTP ${upstream.status}).` },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}
