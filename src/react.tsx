"use client";

import { useEffect, useRef } from "react";
import { WisteriaEngine, type WisteriaOptions } from "./engine";

/** Glyphs come from the canvas's font-family, so give it (or a parent) a monospace font. */
export function AsciiWisteria({ className, options }: { className?: string; options?: WisteriaOptions }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new WisteriaEngine(canvas, options);
    return () => engine.destroy();
    // Options are fixed for the life of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`ascii-wisteria ${className ?? ""}`} />;
}
