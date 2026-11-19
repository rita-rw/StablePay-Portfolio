"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

const MAX_HEIGHT_PX = 160;

/** Textarea that grows with its content up to 160px, then scrolls. */
export function GrowingTextarea({
  value,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      {...props}
      className={`max-h-40 resize-none break-words ${className ?? ""}`}
    />
  );
}
