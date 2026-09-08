import { ImageResponse } from "next/og";
import { fetchPostSummaryFromServer } from "@/lib/serverCommunity";

// Imagen OpenGraph de UNA publicación: título, apodo y género sobre la
// misma identidad visual que la imagen global (ver app/opengraph-image.tsx).

export const alt = "Publicación en la Comunidad de MY STUDIO";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function PostOpenGraphImage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const post = await fetchPostSummaryFromServer(postId).catch(() => null);
  const title = post?.title ?? "Publicación";
  const author = post?.authorName ?? "";
  const genre = post?.genre ?? "";

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, display: "flex" }}>
            <span>MY </span>
            <span style={{ color: "#66FCF1", marginLeft: 10 }}>STUDIO</span>
          </div>
          {genre && (
            <div style={{ fontSize: 24, color: "#66FCF1", letterSpacing: 3, textTransform: "uppercase" }}>{genre}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1050 }}>
            {title.length > 48 ? `${title.slice(0, 47)}…` : title}
          </div>
          {/* Un solo nodo de texto por <div>: next/og (Satori) exige
              display:flex en cualquier div con más de un hijo, y
              "por {author}" son DOS nodos de texto. */}
          {author && <div style={{ fontSize: 36, color: "#8E99A6" }}>{`por ${author}`}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
          {Array.from({ length: 60 }, (_, i) => {
            const h = 10 + Math.abs(Math.sin(i * 0.7 + title.length) * 45 + Math.sin(i * 0.23) * 15);
            return (
              <div key={i} style={{ width: 11, height: h, background: i % 6 === 0 ? "#66FCF1" : "#2A333D", borderRadius: 3 }} />
            );
          })}
        </div>
      </div>
    ),
    size,
  );
}
