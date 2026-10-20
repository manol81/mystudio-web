import { beforeEach, describe, expect, it } from "vitest";
import {
  PassthroughFiles,
  beginImport,
  isPassthroughIntact,
  rememberImportedFile,
  snapshotOf,
} from "./importPassthrough";

const base = {
  startSeconds: 4,
  sourceOffsetSeconds: 0.5,
  sourceDurationSeconds: 3,
  gain: 1,
  fadeInSeconds: 0,
  fadeOutSeconds: 0.1,
  pitchShift: 0,
  repeats: 1,
};

describe("importPassthrough", () => {
  let id: string;
  beforeEach(() => {
    id = beginImport();
    rememberImportedFile(`${id}/audio_0.wav`, new Uint8Array([1, 2, 3]));
  });

  it("un clip sin tocar viaja tal cual; tocado, se renderiza", () => {
    const passthrough = { fileKey: `${id}/audio_0.wav`, manifestClip: {}, snapshot: snapshotOf(base) };
    expect(isPassthroughIntact({ ...base, passthrough })).toBe(true);
    expect(isPassthroughIntact({ ...base, startSeconds: 4.5, passthrough })).toBe(false);
    expect(isPassthroughIntact({ ...base, gain: 0.8, passthrough })).toBe(false);
    expect(isPassthroughIntact({ ...base, repeats: 2, passthrough })).toBe(false);
    expect(isPassthroughIntact(base)).toBe(false);
  });

  it("sin los bytes (otra importación o recargar la página) se renderiza", () => {
    const passthrough = { fileKey: `${id}/audio_0.wav`, manifestClip: {}, snapshot: snapshotOf(base) };
    beginImport();
    expect(isPassthroughIntact({ ...base, passthrough })).toBe(false);
  });

  it("un archivo que nombran varios clips y tomas va una sola vez", () => {
    rememberImportedFile(`${id}/audio_1.wav`, new Uint8Array([4]));
    const files = new PassthroughFiles();
    expect(files.nameFor(`${id}/audio_0.wav`)).toBe("src_0.wav");
    expect(files.nameFor(`${id}/audio_1.wav`)).toBe("src_1.wav");
    expect(files.nameFor(`${id}/audio_0.wav`)).toBe("src_0.wav");
    expect(files.nameFor(`${id}/no_existe.wav`)).toBeNull();
    expect(files.entries().map((e) => e.name)).toEqual(["src_0.wav", "src_1.wav"]);
  });
});
