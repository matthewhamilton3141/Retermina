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
  /** Open a file: reads it from disk and populates `content`. */
  openFile: (path: string) => Promise<void>;
  /** Clear the selection (closes the file). */
  close: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedPath: null,
  content: null,
  loading: false,
  error: null,

  openFile: async (path) => {
    set({ selectedPath: path, loading: true, content: null, error: null });
    try {
      const content = await readFile(path);
      set({ content, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  close: () =>
    set({ selectedPath: null, content: null, loading: false, error: null }),
}));
