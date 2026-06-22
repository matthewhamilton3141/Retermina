/**
 * Runtime registration of user-uploaded fonts.
 *
 * Uploaded faces live as files under <data_dir>/Retermina/fonts (managed by the
 * Rust `fonts` module). We never reference them by URL — instead we pull the
 * bytes through Rust as base64 and hand them to the FontFace Web API directly,
 * which sidesteps the asset:// protocol and its scope configuration entirely.
 */
import { invoke } from "@tauri-apps/api/core";

import type { CustomFont } from "../store/app";

/** Decode a base64 string to an ArrayBuffer for FontFace consumption. */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Families already added to document.fonts this session. */
const registered = new Set<string>();

/**
 * Ensure a single custom font's family is registered. Reads its bytes from the
 * Rust backend (unless `data` is supplied from a fresh upload) and adds a
 * FontFace to the document. Idempotent per family.
 */
export async function registerCustomFont(
  font: Pick<CustomFont, "family" | "fileName">,
  data?: string,
): Promise<void> {
  if (registered.has(font.family)) return;
  try {
    const b64 = data ?? (await invoke<string>("read_font", { fileName: font.fileName }));
    const face = new FontFace(font.family, base64ToArrayBuffer(b64));
    await face.load();
    document.fonts.add(face);
    registered.add(font.family);
  } catch (err) {
    console.error(`Failed to register custom font "${font.family}":`, err);
  }
}

/** Register every persisted custom font (call once on startup / on change). */
export async function registerAllCustomFonts(fonts: readonly CustomFont[]): Promise<void> {
  await Promise.all(fonts.map((f) => registerCustomFont(f)));
}
