import { createContext, useContext } from "react";

/**
 * Per-panel text-zoom factor (1 = 100%), supplied by {@link PanelFrame}.
 *
 * Most panels are scaled visually by CSS `transform` on their content wrapper.
 * Panels that render their own canvas and do their own hit-testing (the
 * terminal, via xterm) can't survive a scaled ancestor — it desyncs pointer
 * coordinates from cell metrics, so text selection lands on the wrong cells.
 * Those panels instead read this factor and scale their *font* directly, which
 * keeps xterm's geometry self-consistent.
 */
export const PanelZoomContext = createContext(1);

/** Current panel zoom factor (1 = 100%). */
export const usePanelZoom = () => useContext(PanelZoomContext);
