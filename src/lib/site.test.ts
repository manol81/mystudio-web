import { describe, expect, it } from "vitest";
import { PLAY_STORE_URL, playStoreUrlFrom } from "./site";

describe("playStoreUrlFrom", () => {
  it("lleva el origen en el referrer que lee Play", () => {
    const url = new URL(playStoreUrlFrom("post"));
    expect(url.searchParams.get("id")).toBe("com.aquiles.mystudio.pocket");
    expect(url.searchParams.get("referrer")).toBe("utm_source=mystudio_web&utm_medium=post");
  });

  it("sigue siendo el link de la ficha", () => {
    expect(playStoreUrlFrom("landing").startsWith(PLAY_STORE_URL)).toBe(true);
  });
});
