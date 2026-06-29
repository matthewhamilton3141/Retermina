/**
 * Community Loom gallery client.
 *
 * Read path: fetch a static `catalog.json` (an array of Loom documents, sans
 * bundled font assets) published from the `retermina-looms` repo via GitHub
 * Pages / raw. Every entry is run through `parsePreset`, so a malformed catalog
 * entry is repaired or dropped rather than trusted.
 *
 * Write path: `shareUrl` builds a pre-filled GitHub Issue URL carrying the
 * user's Loom JSON — the client half of the "submit → CI validates → auto-PR"
 * flow (Option B). No server, no auth beyond a GitHub account.
 */
import { parsePreset, type ReterminaPreset } from "./preset";

/** The GitHub repo backing the gallery. */
export const MARKETPLACE_REPO = "matthewhamilton3141/retermina-looms";

/** Where the published catalog lives (raw, CDN-cached, no server). */
export const MARKETPLACE_CATALOG_URL =
  `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main/catalog.json`;

/** A gallery entry: a sanitized Loom plus optional listing metadata. */
export interface CatalogLoom {
  preset: ReterminaPreset;
  author?: string;
  description?: string;
}

/**
 * Fetch + sanitize the published catalog. Each entry may carry listing fields
 * (`author`, `description`) alongside the embedded Loom; the Loom itself is
 * defensively parsed.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogLoom[]> {
  const res = await fetch(MARKETPLACE_CATALOG_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Gallery unavailable (HTTP ${res.status}).`);

  const data = (await res.json()) as { looms?: unknown };
  const rows = Array.isArray(data?.looms) ? data.looms : [];

  const out: CatalogLoom[] = [];
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    // An entry is either a bare Loom or { ...loomMeta, loom: {...} }.
    const preset = parsePreset(r.loom ?? row);
    if (!preset) continue;
    out.push({
      preset,
      author: typeof r.author === "string" ? r.author : undefined,
      description: typeof r.description === "string" ? r.description : undefined,
    });
  }
  return out;
}

/**
 * A pre-filled GitHub issue URL that submits this Loom to the gallery. A repo
 * Action validates the JSON and opens a PR; a maintainer merge publishes it.
 */
export function shareUrl(preset: ReterminaPreset): string {
  const json = JSON.stringify({ ...preset, assets: undefined }, null, 2);
  const body = [
    `Submitting **${preset.name}** to the Loom gallery.`,
    "",
    "```json",
    json,
    "```",
  ].join("\n");
  const params = new URLSearchParams({
    title: `Loom: ${preset.name}`,
    labels: "loom-submission",
    body,
  });
  return `https://github.com/${MARKETPLACE_REPO}/issues/new?${params.toString()}`;
}
