export function redactSecrets(value: string): string {
  return value
    .replace(
      /\b((?:proxy-)?authorization|cookie|set-cookie)(["']?\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi,
      "$1$2[redacted]",
    )
    .replace(
      /\b(password|passwd|token|secret|api[_-]?key)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2[redacted]",
    );
}

export function safeDiagnosticText(value: string): string {
  return redactSecrets(value).replace(
    /[\p{Cc}\p{Cf}]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
