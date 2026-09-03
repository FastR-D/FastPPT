import { useCallback, useEffect, useRef, useState } from "react";
import "./CanvasViewport.css";

type CanvasSize = { width: number; height: number };
type Point = { x: number; y: number };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function fitScale(viewport: CanvasSize, canvas: CanvasSize) {
  const padding = 48;
  if (viewport.width <= padding || viewport.height <= padding || canvas.width <= 0 || canvas.height <= 0) return 1;
  return clampZoom(Math.min((viewport.width - padding) / canvas.width, (viewport.height - padding) / canvas.height));
}

export function CanvasViewport({ slideId, revision, tool, bindCanvas }: { slideId: string; revision: string; tool: string; bindCanvas: (frame: HTMLIFrameElement | null) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const dragStart = useRef<{ pointer: Point; pan: Point }>();
  const [canvas, setCanvas] = useState<CanvasSize>({ width: 1280, height: 720 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);

  const fit = useCallback(() => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return;
    setZoom(fitScale({ width: viewport.width, height: viewport.height }, canvas));
    setPan({ x: 0, y: 0 });
  }, [canvas]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => { setPan({ x: 0, y: 0 }); }, [slideId, revision]);

  const attachFrame = (frame: HTMLIFrameElement | null) => {
    frameRef.current = frame;
    bindCanvas(frame);
  };

  const loaded = () => {
    const viewBox = frameRef.current?.contentDocument?.querySelector("svg")?.viewBox.baseVal;
    if (viewBox?.width && viewBox.height) setCanvas({ width: viewBox.width, height: viewBox.height });
  };

  const startPan = (event: React.PointerEvent) => {
    if (!panning) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointer: { x: event.clientX, y: event.clientY }, pan };
  };

  const movePan = (event: React.PointerEvent) => {
    if (!dragStart.current) return;
    setPan({ x: dragStart.current.pan.x + event.clientX - dragStart.current.pointer.x, y: dragStart.current.pan.y + event.clientY - dragStart.current.pointer.y });
  };

  return <div className="canvas-shell">
    <div className="canvas-toolbar" role="toolbar" aria-label="画布工具">
      <button className={panning ? "active" : ""} onClick={() => setPanning((value) => !value)} aria-pressed={panning}>抓手</button>
      <button onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))} aria-label="缩小">−</button>
      <button className="zoom-value" onClick={fit} title="适应画布">{Math.round(zoom * 100)}%</button>
      <button onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))} aria-label="放大">＋</button>
      <button onClick={fit}>适应</button>
      <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>100%</button>
    </div>
    <div ref={viewportRef} className={`canvas-viewport${panning ? " is-panning" : ""}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={() => { dragStart.current = undefined; }} onPointerCancel={() => { dragStart.current = undefined; }}>
      <div className="canvas-page" style={{ width: canvas.width, height: canvas.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <iframe ref={attachFrame} onLoad={loaded} title="SVG 页面" src={`/api/slides/${slideId}/raw?tool=${encodeURIComponent(tool)}&revision=${encodeURIComponent(revision)}`}/>
      </div>
      {panning && <div className="canvas-pan-capture" aria-hidden="true"/>}
    </div>
  </div>;
}
