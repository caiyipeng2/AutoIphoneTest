const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;
const ENCODED_PATH_CHARACTER_PATTERN = /%[0-9a-f]{2}/i;

/** Escapes a value before placing it in an HTML text node. */
export function escapeHtmlText(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ENTITIES[character] ?? character);
}

/** Escapes a value before placing it inside a quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value);
}

/**
 * Validates a report-local href and returns its canonical forward-slash form.
 * URL syntax is intentionally narrower than general browser navigation so a
 * hostile value cannot turn an evidence link into a network or filesystem URL.
 */
export function toSafeRelativeHref(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError("Evidence link must be a non-empty relative path.");
  }
  if (containsControlCharacter(value)) {
    throw new TypeError("Evidence link cannot contain control characters.");
  }
  if (value.includes("\\")) {
    throw new TypeError("Evidence link must use local relative path separators.");
  }
  if (value.startsWith("/") || value.startsWith("//") || SCHEME_PATTERN.test(value)) {
    throw new TypeError("Evidence link must be a local relative path.");
  }
  if (value.includes("?") || value.includes("#")) {
    throw new TypeError("Evidence link cannot contain a query or fragment.");
  }
  if (ENCODED_PATH_CHARACTER_PATTERN.test(value)) {
    throw new TypeError("Evidence link cannot contain encoded path characters.");
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError("Evidence link must remain inside the local relative path.");
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}
