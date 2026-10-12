import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import { constants } from "node:fs";

export const MAX_JSON_BYTES = 1_048_576;

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export async function assertSafePath(
  root: string,
  candidate: string,
): Promise<void> {
  root = path.resolve(root);
  candidate = path.resolve(candidate);
  if (!isInside(root, candidate))
    throw new Error("Path must remain inside the project root.");
  const segments = path
    .relative(root, candidate)
    .split(path.sep)
    .filter(Boolean);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink())
        throw new Error(
          "Project paths must not contain symbolic links or junctions.",
        );
      if (current !== candidate && !stats.isDirectory())
        throw new Error("Parent path must be a directory.");
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }
}

export async function readProjectFile(
  root: string,
  file: string,
  limit = MAX_JSON_BYTES,
): Promise<string> {
  await assertSafePath(root, file);
  const expected = await lstat(file);
  if (!expected.isFile()) throw new Error("Input path must be a regular file.");
  const handle = await open(
    file,
    constants.O_RDONLY |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const stats = await handle.stat();
    await assertSafePath(root, file);
    const current = await lstat(file);
    if (
      stats.ino !== expected.ino ||
      stats.dev !== expected.dev ||
      stats.ino !== current.ino ||
      stats.dev !== current.dev
    )
      throw new Error("Input path changed while opening the file.");
    if (!stats.isFile()) throw new Error("Input path must be a regular file.");
    if (stats.size > limit)
      throw new Error("Input file exceeds the size limit.");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new Error("Input file exceeds the size limit.");
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function listProjectFiles(
  root: string,
  ignores: readonly string[],
  dot = true,
): Promise<string[]> {
  if (ignores.length > 128)
    throw new Error("Too many ignore patterns (maximum 128).");
  for (const pattern of ignores) {
    if (
      pattern.length > 1024 ||
      [...pattern].some((character) => character.charCodeAt(0) < 32) ||
      path.isAbsolute(pattern) ||
      pattern.replaceAll("\\", "/").split("/").includes("..")
    ) {
      throw new Error(
        "Ignore patterns must be relative to the project root, contain no parent traversal, and be at most 1024 characters.",
      );
    }
    const nesting: string[] = [];
    for (const character of pattern) {
      if ("{([".includes(character)) {
        nesting.push(character);
        if (nesting.length > 8)
          throw new Error("Ignore pattern nesting exceeds the limit.");
      } else if (
        (character === "}" && nesting.at(-1) === "{") ||
        (character === ")" && nesting.at(-1) === "(") ||
        (character === "]" && nesting.at(-1) === "[")
      ) {
        nesting.pop();
      }
    }
  }
  let ignored: (file: string) => boolean;
  try {
    ignored = picomatch([...ignores], { dot: true, maxLength: 1024 });
  } catch {
    throw new Error("Invalid ignore pattern.");
  }
  const files: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  let entriesSeen = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (next.depth > 64)
      throw new Error("Project directory nesting exceeds the limit.");
    await assertSafePath(root, next.directory);
    const directory = await readdir(next.directory, { withFileTypes: true });
    for (const entry of directory) {
      if (++entriesSeen > 50_000)
        throw new Error("Project exceeds the 50000-entry scan limit.");
      if (entry.isSymbolicLink() || (!dot && entry.name.startsWith(".")))
        continue;
      const absolute = path.join(next.directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (ignored(relative) || (entry.isDirectory() && ignored(`${relative}/`)))
        continue;
      if (entry.isDirectory())
        pending.push({ directory: absolute, depth: next.depth + 1 });
      else if (entry.isFile()) files.push(relative);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}
