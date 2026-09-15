"use client";

// Forma de onda de un sample en una tarjeta del Banco de Sonidos.
//
// Distinta de `ClipWaveform` (adentro de arranger/page.tsx), y a
// propósito: ese dibuja un clip ya colocado, con un ancho en píxeles
// que le dicta el zoom de la línea de tiempo. Este vive en una tarjeta
// de ancho variable (el panel lateral se estira, la grilla del catálogo
// cambia de columnas), así que se mide solo con un ResizeObserver.
//
// Mientras los picos todavía no llegaron dibuja una línea central
// tenue, no un hueco: la tarjeta tiene que ocupar el mismo alto desde
// el primer render, o la lista entera salta cuando se van resolviendo
// las descargas.

import { useEffect, useRef, useState } from "react";

export function SampleWaveform({
  peaks,
  color,
  heightPx = 28,
  className = "",
}: {
  /** null = todavía no se resolvió (o no se pudo). */
  peaks: Float32Array | null;
  color: string;
  heightPx?: number;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [widthPx, setWidthPx] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setWidthPx(Math.floor(width));
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || widthPx <= 0 || heightPx <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);

    const mid = heightPx / 2;

    if (!peaks || peaks.length === 0) {
      // Marcador de posición: una línea, no un vacío.
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, mid - 0.5, widthPx, 1);
      return;
    }

    ctx.fillStyle = color;
    const numBuckets = peaks.length / 2;
    const barWidth = widthPx / Math.max(1, numBuckets);
    for (let i = 0; i < numBuckets; i++) {
      const min = peaks[i * 2];
      const max = peaks[i * 2 + 1];
      const x = i * barWidth;
      const yTop = mid - max * mid;
      const yBottom = mid - min * mid;
      // El máximo de 1px evita que un tramo de silencio desaparezca del
      // todo: una onda con huecos se lee como un error de carga.
      ctx.fillRect(x, yTop, Math.max(0.6, barWidth - 0.4), Math.max(1, yBottom - yTop));
    }
  }, [peaks, color, widthPx, heightPx]);

  return (
    <div ref={wrapperRef} className={className} style={{ height: heightPx }}>
      <canvas ref={canvasRef} style={{ width: widthPx, height: heightPx, display: "block" }} />
    </div>
  );
}
