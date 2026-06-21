import { create } from "zustand";
import { readFile, writeFile } from "../lib/fs";

interface EditorState {
  selectedPath: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;

  /** Diff mode — tracks live changes against a baseline snapshot. */
  diffMode: boolean;
  baseline: string | null;

  /** Safe Edit mode — unlocks the panel for direct text editing. */
  isEditing: boolean;
  /** In-progress edits; mirrors content on entry, diverges as the user types. */
  editDraft: string | null;
  /** Non-null while a save is in flight. */
  saving: boolean;
  /** Save error message, cleared on next edit or successful save. */
  saveError: string | null;

  openFile: (path: string) => Promise<void>;
  refreshContent: () => Promise<void>;
  enableDiff: () => void;
  disableDiff: () => void;

  /** Enter edit mode: unlock the textarea with the current content as draft. */
  startEditing: () => void;
  /** Update the in-progress draft as the user types. */
  setDraft: (draft: string) => void;
  /** Discard the draft and return to read-only view. */
  cancelEditing: () => void;
  /** Write the draft to disk, refresh content, and return to read-only view. */
  saveEdits: () => Promise<void>;

  close: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedPath: null,
  content: null,
  loading: false,
  error: null,
  diffMode: false,
  baseline: null,
  isEditing: false,
  editDraft: null,
  saving: false,
  saveError: null,

  openFile: async (path) => {
    set({
      selectedPath: path,
      loading: true,
      content: null,
      error: null,
      diffMode: false,
      baseline: null,
      isEditing: false,
      editDraft: null,
      saveError: null,
    });
    try {
      const content = await readFile(path);
      set({ content, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  refreshContent: async () => {
    const { selectedPath, isEditing } = get();
    if (!selectedPath || isEditing) return; // don't clobber in-progress edits
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

  startEditing: () => {
    const { content } = get();
    if (content === null) return;
    set({ isEditing: true, editDraft: content, saveError: null });
  },

  setDraft: (draft) => set({ editDraft: draft, saveError: null }),

  cancelEditing: () => set({ isEditing: false, editDraft: null, saveError: null }),

  saveEdits: async () => {
    const { selectedPath, editDraft } = get();
    if (!selectedPath || editDraft === null) return;
    set({ saving: true, saveError: null });
    try {
      await writeFile(selectedPath, editDraft);
      set({ content: editDraft, isEditing: false, editDraft: null, saving: false });
    } catch (err) {
      set({ saving: false, saveError: String(err) });
    }
  },

  close: () =>
    set({
      selectedPath: null,
      content: null,
      loading: false,
      error: null,
      diffMode: false,
      baseline: null,
      isEditing: false,
      editDraft: null,
      saving: false,
      saveError: null,
    }),
}));
