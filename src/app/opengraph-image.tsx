import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// Imagen OpenGraph por defecto (1200×630) — lo que se ve al pegar el
// link en WhatsApp/Instagram/X. Generada en el servidor con next/og,
// sin assets binarios en el repo. Las publicaciones (/p/[postId])
// tienen la suya propia con el título y el apodo.

export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0B0E11 0%, #151A20 100%)",
          color: "#E8EDF2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
          {Array.from({ length: 42 }, (_, i) => {
            const h = 20 + Math.abs(Math.sin(i * 0.9) * 70 + Math.sin(i * 0.31) * 30);
            return (
              <div
                key={i}
                style={{ width: 14, height: h, background: i % 5 === 0 ? "#66FCF1" : "#2A333D", borderRadius: 4 }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2, display: "flex" }}>
            <span>MY </span>
            <span style={{ color: "#66FCF1", marginLeft: 22 }}>STUDIO</span>
          </div>
          <div style={{ fontSize: 34, color: "#8E99A6", maxWidth: 980, lineHeight: 1.3 }}>{SITE_DESCRIPTION}</div>
        </div>
      </div>
    ),
    size,
  );
}
