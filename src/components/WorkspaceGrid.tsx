import React, { useState, useRef, useEffect } from 'react';

interface WorkspaceWindow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

const GRID_SIZE = 20; // Grid cell scale in pixels

export const workspaceGrid: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [windows, setWindows] = useState<WorkspaceWindow[]>([
    { id: 'win-1', x: 20, y: 20, width: 340, height: 240, title: 'reterminal-bash' },
    { id: 'win-2', x: 400, y: 20, width: 400, height: 280, title: 'workspace-metrics' },
  ]);

  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    startX: number;
    startY: number;
    startWinX: number;
    startWinY: number;
  } | null>(null);

  useEffect(() => {
    if (!activeDrag) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const targetWindow = windows.find((w) => w.id === activeDrag.id);
      if (!targetWindow) return;

      // 1. Calculate raw delta relative to initial click position
      const deltaX = e.clientX - activeDrag.startX;
      const deltaY = e.clientY - activeDrag.startY;

      let newX = activeDrag.startWinX + deltaX;
      let newY = activeDrag.startWinY + deltaY;

      // 2. Clamp sizing logic so windows cannot move out of grid bounds
      // Limits maximum width/height constraints contextually to container limits
      const maxX = containerRect.width - targetWindow.width;
      const maxY = containerRect.height - targetWindow.height;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      // 3. Grid cell snapping computation
      const snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

      setWindows((prev) =>
        prev.map((w) => (w.id === activeDrag.id ? { ...w, x: snappedX, y: snappedY } : w))
      );
    };

    const handleMouseUp = () => {
      setActiveDrag(null);
    };

    // Attach to window global event to catch drag handlers regardless of speed/boundaries
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, windows]);

  const initiateDrag = (id: string, e: React.MouseEvent, currentX: number, currentY: number) => {
    e.preventDefault();
    setActiveDrag({
      id,
      startX: e.clientX,
      startY: e.clientY,
      startWinX: currentX,
      startWinY: currentY,
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[85vh] border border-zinc-800 bg-zinc-950 overflow-hidden select-none rounded-lg"
      style={{
        backgroundImage: 'radial-gradient(#27272a 1.2px, transparent 1.2px)',
        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
      }}
    >
      {windows.map((win) => {
        // Fallback checks preventing sizing scaling from blowing past wrapper dimensions
        const maxContainerW = containerRef.current ? containerRef.current.clientWidth - 20 : 800;
        const maxContainerH = containerRef.current ? containerRef.current.clientHeight - 20 : 600;
        
        const optimalWidth = Math.min(win.width, maxContainerW);
        const optimalHeight = Math.min(win.height, maxContainerH);

        const isCurrentlyDragging = activeDrag?.id === win.id;

        return (
          <div
            key={win.id}
            className="absolute bg-zinc-900/95 border border-zinc-700/80 rounded-md shadow-2xl flex flex-col backdrop-blur-sm"
            style={{
              transform: `translate3d(${win.x}px, ${win.y}px, 0)`,
              width: `${optimalWidth}px`,
              height: `${optimalHeight}px`,
              // Disabling transitions explicitly while dragging completely removes latency/ghosting
              transition: isCurrentlyDragging ? 'none' : 'transform 0.08s cubic-bezier(0.2, 0.8, 0.2, 1)',
              zIndex: isCurrentlyDragging ? 50 : 10,
            }}
          >
            {/* Window Drag Title Bar Handle */}
            <div
              className="bg-zinc-800/80 px-4 py-2 text-zinc-300 text-xs font-mono cursor-grab active:cursor-grabbing flex items-center justify-between border-b border-zinc-700 select-none"
              onMouseDown={(e) => initiateDrag(win.id, e, win.x, win.y)}
            >
              <span className="truncate max-w-[80%] font-medium">{win.title}</span>
              <div className="flex space-x-1.5 flex-shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-700 block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 block"></span>
              </div>
            </div>

            {/* Panel Viewport Shell Workspace */}
            <div className="p-4 flex-1 text-zinc-400 font-mono text-xs overflow-auto">
              {/* Inner components populate here */}
              <p className="text-emerald-400">matthew@retermina:~$ <span className="text-zinc-100">initialized grid constraint.</span></p>
            </div>
          </div>
        );
      })}
    </div>
  );
};