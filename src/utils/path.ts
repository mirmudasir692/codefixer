import path from "node:path";

// Ensures targeted file path stays safely within project root
export function assertInsideProject(target: string): string {
  const root = process.cwd();
  const cleaned = (!target || target === "project-root" || target === "root" || target === "./") ? "." : target;
  const resolved = path.resolve(root, cleaned);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path "${target}" is outside project root.`);
  }
  return resolved;
}

