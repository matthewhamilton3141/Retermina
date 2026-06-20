import { create } from "zustand";
import { readFile } from "../lib/fs";

/**
 * Shared ephemeral state for the Explorer → Code View file-selection flow.
 * No persistence: the selected file resets when the app restarts.
 */
interface EditorState {
  /** Absolute path of the file currently open in the Code View panel. */
  selectedPath: string | null;
  /** Raw text content of the open file, or null while loading / on error. */
  content: string | null;
  loading: boolean;
  error: string | null;

  /** Diff mode — tracks live changes against a baseline snapshot. */
  diffMode: boolean;
  /** Content snapshot captured when diff mode was activated (the "before"). */
  baseline: string | null;

  /** Open a file: reads it from disk and populates `content`. */
  openFile: (path: string) => Promise<void>;
  /** Re-read the current file from disk (used by the live-poll loop). */
  refreshContent: () => Promise<void>;
  /** Activate diff mode: captures current content as the baseline. */
  enableDiff: () => void;
  /** Deactivate diff mode and clear the baseline. */
  disableDiff: () => void;
  /** Clear the selection (closes the file). */
  close: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedPath: null,
  content: null,
  loading: false,
  error: null,
  diffMode: false,
  baseline: null,

  openFile: async (path) => {
    set({ selectedPath: path, loading: true, content: null, error: null, diffMode: false, baseline: null });
    try {
      const content = await readFile(path);
      set({ content, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  refreshContent: async () => {
    const { selectedPath } = get();
    if (!selectedPath) return;
    try {
      const content = await readFile(selectedPath);
      set({ content });
    } catch {
      // Silently ignore mid-write transient read errors.
    }
  },

  enableDiff: () => {
    const { content } = get();
    if (content === null) return;
    set({ diffMode: true, baseline: content });
  },

  disableDiff: () => set({ diffMode: false, baseline: null }),

  close: () =>
    set({ selectedPath: null, content: null, loading: false, error: null, diffMode: false, baseline: null }),
}));
