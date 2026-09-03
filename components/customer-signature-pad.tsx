"use client";

import { Eraser } from "lucide-react";
import { useEffect, useRef } from "react";

export function CustomerSignaturePad({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = Math.max(320, Math.floor(canvas.clientWidth));
    const cssHeight = 220;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.2 * dpr;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (!value) {
      hasStrokeRef.current = false;
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      hasStrokeRef.current = true;
    };
    image.src = value;
  }, [value]);

  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const point = position(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawingRef.current = true;
    hasStrokeRef.current = true;
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const point = position(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function end(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already have been released.
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(hasStrokeRef.current ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || disabled) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    onChange(null);
  }

  return (
    <div className="field full" style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <label>Customer signature</label>
          <p>Have the customer sign on the device before confirming the booking.</p>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={clear}
          disabled={disabled}
        >
          <Eraser size={15} />
          Clear
        </button>
      </div>
      <div style={{ position: "relative", border: "1px solid #d7dde8", borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
        <canvas
          ref={canvasRef}
          className="signature-pad-canvas" style={{ display: "block", width: "100%", height: "220px", touchAction: "none", cursor: disabled ? "not-allowed" : "crosshair" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => end()}
          aria-label="Customer signature"
        />
        <div style={{ position: "absolute", left: "24px", right: "24px", bottom: "34px", borderBottom: "1px solid #9aa4b2", pointerEvents: "none" }} aria-hidden="true" />
      </div>
    </div>
  );
}
