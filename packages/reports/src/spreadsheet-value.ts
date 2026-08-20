const FORMULA_LEADING = /^[=+\-@]/;
const CONTROL_LEADING = /^[\t\r\n]/;

export interface SpreadsheetTextResult {
  readonly value: string;
  readonly sanitized: boolean;
}

/** Keeps untrusted report text literal when a spreadsheet application opens it. */
export function safeSpreadsheetText(value: string): SpreadsheetTextResult {
  let normalized = "";
  let replacedControl = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isNonPrinting =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;
    normalized += isNonPrinting ? " " : character;
    replacedControl ||= isNonPrinting;
  }
  const needsLiteralPrefix = FORMULA_LEADING.test(normalized) || CONTROL_LEADING.test(normalized);
  return {
    value: needsLiteralPrefix ? `'${normalized}` : normalized,
    sanitized: needsLiteralPrefix || replacedControl,
  };
}
