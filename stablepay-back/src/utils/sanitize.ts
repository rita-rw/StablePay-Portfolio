import sanitizeHtml from "sanitize-html";
import { getAddress } from "viem";

/**
 * Strips all HTML tags and returns plain text.
 * sanitize-html escapes <, > and & in the text it keeps ("->" becomes "-&gt;"), so we decode
 * those back — the DB stores plain text, and React escapes it when it renders.
 * &amp; is decoded last, otherwise "&amp;lt;" would turn into "<" instead of "&lt;".
 */
export function sanitize(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}
