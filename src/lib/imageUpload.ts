// src/lib/imageUpload.ts
//
// Achica una imagen EN EL NAVEGADOR antes de subirla (foto de perfil,
// portada de una publicación). Una foto de teléfono pesa 3-8 MB y en
// Blaze cada byte que sale de Storage se factura: el feed la mostraría
// en cada tarjeta, a cada persona que entra. Achicada pesa 50-200 KB y
// se ve igual en el tamaño en que se muestra.
//
// Sale siempre en JPEG: lo entienden todos los navegadores y para fotos
// rinde mejor que PNG. Las reglas de Storage aceptan jpeg/png/webp y
// ponen un tope de tamaño por si alguien sube directo con el SDK.

/// Formatos que se aceptan al elegir el archivo. HEIC (iPhone) no: el
/// navegador no siempre lo sabe decodificar, y fallar después de elegir
/// la foto es peor que no ofrecerla.
export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/// Valida el archivo antes de tocarlo. Devuelve el motivo para mostrar,
/// o null si está bien. Pura, para poder probarla.
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return "Elegí una imagen JPG, PNG o WebP.";
  }
  if (file.size > MAX_INPUT_BYTES) {
    return "La imagen es demasiado grande (más de 20 MB).";
  }
  return null;
}

/// Cuánto achicar: el lado mayor queda en `maxSide` (nunca se agranda).
/// Con `square`, primero se recorta al cuadrado central — es lo que pide
/// un avatar redondo, y lo que espera quien mira la miniatura al elegir.
/// Pura, para poder probarla.
export function resizePlan(
  width: number,
  height: number,
  maxSide: number,
  square: boolean,
): { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number } {
  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;
  if (square) {
    const side = Math.min(width, height);
    sx = Math.floor((width - side) / 2);
    sy = Math.floor((height - side) / 2);
    sw = side;
    sh = side;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  return {
    sx,
    sy,
    sw,
    sh,
    dw: Math.max(1, Math.round(sw * scale)),
    dh: Math.max(1, Math.round(sh * scale)),
  };
}

/// Decodifica, recorta/achica y vuelve a codificar a JPEG.
export async function resizeImage(
  file: Blob,
  opts: { maxSide: number; square?: boolean; quality?: number },
): Promise<Blob> {
  // `imageOrientation: "from-image"` respeta la rotación EXIF: sin eso,
  // muchas fotos de teléfono quedarían acostadas.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const p = resizePlan(bitmap.width, bitmap.height, opts.maxSide, opts.square ?? false);
    const canvas = document.createElement("canvas");
    canvas.width = p.dw;
    canvas.height = p.dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo preparar la imagen."))),
        "image/jpeg",
        opts.quality ?? 0.85,
      ),
    );
  } finally {
    bitmap.close();
  }
}

/// La URL que se guarda en Firestore lleva una marca de versión. Al
/// reemplazar una foto, el objeto de Storage conserva su URL de descarga
/// (mismo token), y el navegador —y el CDN— seguirían mostrando la vieja.
export function withVersion(url: string, version: number = Date.now()): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}
