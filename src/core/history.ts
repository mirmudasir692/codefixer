import { readFile, writeFile, unlink, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Checkpoint, FileSnapshot, RevertResult } from "../types/index.js";
import { assertInsideProject } from "../utils/index.js";

const execAsync = promisify(exec);

// Persistent History and Checkpoint Manager
export class HistoryManager {
  private rootDir: string;
  private baseDir: string;
  private blobsDir: string;
  private manifestPath: string;
  private initialized = false;
  private currentMessageId: number | null = null;
  private currentMessageText: string | null = null;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
    this.baseDir = path.join(this.rootDir, ".codefixer", "history");
    this.blobsDir = path.join(this.baseDir, "blobs");
    this.manifestPath = path.join(this.baseDir, "checkpoints.json");
  }

  // Ensures history directories and manifest file exist
  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.blobsDir, { recursive: true });
    try {
      await stat(this.manifestPath);
    } catch {
      await writeFile(this.manifestPath, JSON.stringify([]), "utf-8");
    }
    this.initialized = true;
  }

  // Load all recorded checkpoints
  async getCheckpoints(): Promise<Checkpoint[]> {
    await this.init();
    try {
      const raw = await readFile(this.manifestPath, "utf-8");
      return JSON.parse(raw) as Checkpoint[];
    } catch {
      return [];
    }
  }

  // Save checkpoints to disk
  private async saveCheckpoints(checkpoints: Checkpoint[]): Promise<void> {
    await this.init();
    await writeFile(this.manifestPath, JSON.stringify(checkpoints, null, 2), "utf-8");
  }

  // Tags subsequently recorded checkpoints with a conversation message number
  beginMessage(messageId: number, messageText?: string): void {
    this.currentMessageId = messageId;
    this.currentMessageText = messageText?.trim() || null;
  }

  // Snapshot a file before it gets modified or deleted
  async snapshot(filePath: string, description: string): Promise<string> {
    await this.init();
    const resolved = assertInsideProject(filePath, this.rootDir);
    const relPath = path.relative(this.rootDir, resolved);

    let exists = false;
    let content = "";
    try {
      content = await readFile(resolved, "utf-8");
      exists = true;
    } catch {
      // File does not exist yet (create operation)
    }

    let blobName: string | null = null;
    if (exists) {
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      blobName = hash;
      const blobPath = path.join(this.blobsDir, blobName);
      try {
        await stat(blobPath);
      } catch {
        await writeFile(blobPath, content, "utf-8");
      }
    }

    const snapshot: FileSnapshot = {
      path: relPath,
      state: exists ? "modified" : "created",
      backupBlobPath: blobName,
      timestamp: new Date().toISOString(),
    };

    const checkpoints = await this.getCheckpoints();
    const checkpointId = `cp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const newCheckpoint: Checkpoint = {
      id: checkpointId,
      timestamp: new Date().toISOString(),
      description,
      ...(this.currentMessageId !== null ? { messageId: this.currentMessageId } : {}),
      ...(this.currentMessageText !== null ? { messageText: this.currentMessageText } : {}),
      files: [snapshot],
    };

    checkpoints.push(newCheckpoint);
    await this.saveCheckpoints(checkpoints);
    return checkpointId;
  }

  // Revert the most recent change
  async revertLast(): Promise<RevertResult> {
    const checkpoints = await this.getCheckpoints();
    if (checkpoints.length === 0) {
      return { ok: false, filesReverted: [], error: "No checkpoints available to revert." };
    }

    const last = checkpoints.pop()!;
    const filesReverted: string[] = [];

    for (const snap of last.files) {
      await this.restoreSnapshot(snap);
      filesReverted.push(snap.path);
    }

    await this.saveCheckpoints(checkpoints);
    return { ok: true, checkpointId: last.id, filesReverted };
  }

  // Revert all changes back to a specific checkpoint ID
  async revertToCheckpoint(checkpointId: string): Promise<RevertResult> {
    const checkpoints = await this.getCheckpoints();
    const targetIdx = checkpoints.findIndex((c) => c.id === checkpointId || c.id.startsWith(checkpointId));

    if (targetIdx === -1) {
      return { ok: false, filesReverted: [], error: `Checkpoint "${checkpointId}" not found.` };
    }

    const toRevert = checkpoints.slice(targetIdx).reverse();
    const filesRevertedSet = new Set<string>();

    for (const cp of toRevert) {
      for (const snap of cp.files) {
        await this.restoreSnapshot(snap);
        filesRevertedSet.add(snap.path);
      }
    }

    const remaining = checkpoints.slice(0, targetIdx);
    await this.saveCheckpoints(remaining);
    return { ok: true, checkpointId, filesReverted: Array.from(filesRevertedSet) };
  }

  // Revert all file changes recorded from a specific message onward
  async revertToMessage(messageId: number): Promise<RevertResult> {
    const checkpoints = await this.getCheckpoints();
    const targetIdx = checkpoints.findIndex(
      (c) => c.messageId !== undefined && c.messageId >= messageId,
    );

    if (targetIdx === -1) {
      return {
        ok: false,
        messageId,
        filesReverted: [],
        error: `No changes recorded for message ${messageId} or later.`,
      };
    }

    const toRevert = checkpoints.slice(targetIdx).reverse();
    const filesRevertedSet = new Set<string>();

    for (const cp of toRevert) {
      for (const snap of cp.files) {
        await this.restoreSnapshot(snap);
        filesRevertedSet.add(snap.path);
      }
    }

    await this.saveCheckpoints(checkpoints.slice(0, targetIdx));
    return {
      ok: true,
      checkpointId: checkpoints[targetIdx].id,
      messageId,
      filesReverted: Array.from(filesRevertedSet),
    };
  }

  // Revert a single file to its previous state
  async revertFile(filePath: string): Promise<RevertResult> {
    const resolved = assertInsideProject(filePath, this.rootDir);
    const relPath = path.relative(this.rootDir, resolved);
    const checkpoints = await this.getCheckpoints();

    for (let i = checkpoints.length - 1; i >= 0; i--) {
      const snap = checkpoints[i].files.find((f) => f.path === relPath);
      if (snap) {
        await this.restoreSnapshot(snap);
        return { ok: true, checkpointId: checkpoints[i].id, filesReverted: [relPath] };
      }
    }

    return { ok: false, filesReverted: [], error: `No previous version recorded for ${relPath}.` };
  }

  // Restores a single file snapshot
  private async restoreSnapshot(snap: FileSnapshot): Promise<void> {
    const resolved = path.resolve(this.rootDir, snap.path);

    if (snap.state === "created") {
      // File was created by the change — remove it on revert
      try {
        await unlink(resolved);
      } catch {}
    } else if (snap.backupBlobPath) {
      // File was modified or deleted — restore backup blob content
      const blobPath = path.join(this.blobsDir, snap.backupBlobPath);
      const original = await readFile(blobPath, "utf-8");
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, original, "utf-8");
    }
  }

  // List recent checkpoints
  async listCheckpoints(limit = 10): Promise<Checkpoint[]> {
    const checkpoints = await this.getCheckpoints();
    return checkpoints.slice(-limit).reverse();
  }

  // Git integration: check if current project is inside a git repo
  async isGitRepo(): Promise<boolean> {
    try {
      const { stdout } = await execAsync("git rev-parse --is-inside-work-tree", { cwd: this.rootDir });
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  // Git integration: create a git checkpoint commit if desired
  async gitCommitCheckpoint(message: string): Promise<string | null> {
    if (!(await this.isGitRepo())) return null;
    try {
      await execAsync("git add -A", { cwd: this.rootDir });
      const { stdout } = await execAsync(`git commit -m "codefixer checkpoint: ${message}" --no-verify`, {
        cwd: this.rootDir,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }
}

// Global default history manager singleton
export const historyManager = new HistoryManager();
