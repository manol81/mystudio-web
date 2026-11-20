// El IR propio de la pedalera (app +76): viaja en el .mystudio como una
// entrada más del ZIP, y la pedalera lo nombra (rig.irFile). Acá se
// decodifica A LA TASA DEL CONTEXTO —la misma a la que después se mezcla—
// y se cuelga de los efectos de la pista (TrackFx.rigIr). Sin el archivo,
// la pedalera usa el bafle sintético (ver GuitarRigDsp).

import type JSZip from "jszip";
import type { TrackFx } from "./trackEffects";

export async function withRigIr(fx: TrackFx, zip: JSZip, ctx: BaseAudioContext): Promise<TrackFx> {
  const rig = fx.rig;
  if (!rig || !rig.on || rig.cab !== 7 || !rig.irFile) return fx;
  const entry = zip.file(rig.irFile);
  if (!entry) return fx;
  try {
    const buffer = await ctx.decodeAudioData(await entry.async("arraybuffer"));
    return { ...fx, rigIr: buffer.getChannelData(0).slice() };
  } catch {
    return fx; // un IR que no se puede leer no rompe la canción
  }
}
