export function assertJsonNesting(text: string): void {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if ((character === "{" || character === "[") && ++depth > 128) {
      throw new Error("JSON nesting exceeds the 128-level input limit.");
    } else if (character === "}" || character === "]") depth--;
  }
}
