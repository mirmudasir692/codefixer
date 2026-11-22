import path from "node:path";
import { readdirSync } from "node:fs";

// Ensures targeted file path stays safely within project root
export function assertInsideProject(target: string, rootDir: string = process.cwd()): string {
  const root = rootDir;
  const cleaned = (!target || target === "project-root" || target === "root" || target === "./") ? "." : target;
  const resolved = path.resolve(root, cleaned);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path "${target}" is outside project root.`);
  }
  return resolved;
}

export interface FileSuggestion {
  name: string;
  path: string;
  isDir: boolean;
}

const IGNORE_PATTERNS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".gemini",
  "package-lock.json",
]);

let cachedFiles: FileSuggestion[] = [];
let lastScanTime = 0;
const CACHE_TTL_MS = 2000;

/**
 * Fast recursive scan of project files and directories, ignoring build/vcs artifacts.
 */
export function getProjectFiles(
  rootDir: string = process.cwd(),
  forceRefresh = false,
): FileSuggestion[] {
  const now = Date.now();
  if (!forceRefresh && cachedFiles.length > 0 && now - lastScanTime < CACHE_TTL_MS) {
    return cachedFiles;
  }

  try {
    const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
    const results: FileSuggestion[] = [];

    for (const e of entries) {
      const full = path.join(e.parentPath || rootDir, e.name);
      const rel = path.relative(rootDir, full);
      const parts = rel.split(path.sep);

      let skip = false;
      for (const p of parts) {
        if (IGNORE_PATTERNS.has(p) || p.startsWith(".")) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      results.push({
        name: e.name,
        path: e.isDirectory() ? `${rel}/` : rel,
        isDir: e.isDirectory(),
      });
    }

    results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    cachedFiles = results;
    lastScanTime = now;
    return results;
  } catch {
    return [];
  }
}
