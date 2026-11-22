import { readFile, writeFile, unlink, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { assertInsideProject } from "../utils/index.js";
const execAsync = promisify(exec);
export class HistoryManager {
    rootDir;
    baseDir;
    blobsDir;
    manifestPath;
    initialized = false;
    currentMessageId = null;
    currentMessageText = null;
    constructor(rootDir = process.cwd()) {
        this.rootDir = rootDir;
        this.baseDir = path.join(this.rootDir, ".codefixer", "history");
        this.blobsDir = path.join(this.baseDir, "blobs");
        this.manifestPath = path.join(this.baseDir, "checkpoints.json");
    }
    async init() {
        if (this.initialized)
            return;
        await mkdir(this.blobsDir, { recursive: true });
        try {
            await stat(this.manifestPath);
        }
        catch {
            await writeFile(this.manifestPath, JSON.stringify([]), "utf-8");
        }
        this.initialized = true;
    }
    async getCheckpoints() {
        await this.init();
        try {
            const raw = await readFile(this.manifestPath, "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    async saveCheckpoints(checkpoints) {
        await this.init();
        await writeFile(this.manifestPath, JSON.stringify(checkpoints, null, 2), "utf-8");
    }
    beginMessage(messageId, messageText) {
        this.currentMessageId = messageId;
        this.currentMessageText = messageText?.trim() || null;
    }
    async snapshot(filePath, description) {
        await this.init();
        const resolved = assertInsideProject(filePath, this.rootDir);
        const relPath = path.relative(this.rootDir, resolved);
        let exists = false;
        let content = "";
        try {
            content = await readFile(resolved, "utf-8");
            exists = true;
        }
        catch { }
        let blobName = null;
        if (exists) {
            const hash = crypto.createHash("sha256").update(content).digest("hex");
            blobName = hash;
            const blobPath = path.join(this.blobsDir, blobName);
            try {
                await stat(blobPath);
            }
            catch {
                await writeFile(blobPath, content, "utf-8");
            }
        }
        const snapshot = {
            path: relPath,
            state: exists ? "modified" : "created",
            backupBlobPath: blobName,
            timestamp: new Date().toISOString(),
        };
        const checkpoints = await this.getCheckpoints();
        const checkpointId = `cp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
        const newCheckpoint = {
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
    async revertLast() {
        const checkpoints = await this.getCheckpoints();
        if (checkpoints.length === 0) {
            return { ok: false, filesReverted: [], error: "No checkpoints available to revert." };
        }
        const last = checkpoints.pop();
        const filesReverted = [];
        for (const snap of last.files) {
            await this.restoreSnapshot(snap);
            filesReverted.push(snap.path);
        }
        await this.saveCheckpoints(checkpoints);
        return { ok: true, checkpointId: last.id, filesReverted };
    }
    async revertToCheckpoint(checkpointId) {
        const checkpoints = await this.getCheckpoints();
        const targetIdx = checkpoints.findIndex((c) => c.id === checkpointId || c.id.startsWith(checkpointId));
        if (targetIdx === -1) {
            return { ok: false, filesReverted: [], error: `Checkpoint "${checkpointId}" not found.` };
        }
        const toRevert = checkpoints.slice(targetIdx).reverse();
        const filesRevertedSet = new Set();
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
    async revertToMessage(messageId) {
        const checkpoints = await this.getCheckpoints();
        const targetIdx = checkpoints.findIndex((c) => c.messageId !== undefined && c.messageId >= messageId);
        if (targetIdx === -1) {
            return {
                ok: false,
                messageId,
                filesReverted: [],
                error: `No changes recorded for message ${messageId} or later.`,
            };
        }
        const toRevert = checkpoints.slice(targetIdx).reverse();
        const filesRevertedSet = new Set();
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
    async revertFile(filePath) {
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
    async restoreSnapshot(snap) {
        const resolved = path.resolve(this.rootDir, snap.path);
        if (snap.state === "created") {
            try {
                await unlink(resolved);
            }
            catch { }
        }
        else if (snap.backupBlobPath) {
            const blobPath = path.join(this.blobsDir, snap.backupBlobPath);
            const original = await readFile(blobPath, "utf-8");
            await mkdir(path.dirname(resolved), { recursive: true });
            await writeFile(resolved, original, "utf-8");
        }
    }
    async listCheckpoints(limit = 10) {
        const checkpoints = await this.getCheckpoints();
        return checkpoints.slice(-limit).reverse();
    }
    async isGitRepo() {
        try {
            const { stdout } = await execAsync("git rev-parse --is-inside-work-tree", {
                cwd: this.rootDir,
            });
            return stdout.trim() === "true";
        }
        catch {
            return false;
        }
    }
    async gitCommitCheckpoint(message) {
        if (!(await this.isGitRepo()))
            return null;
        try {
            await execAsync("git add -A", { cwd: this.rootDir });
            const { stdout } = await execAsync(`git commit -m "codefixer checkpoint: ${message}" --no-verify`, {
                cwd: this.rootDir,
            });
            return stdout.trim();
        }
        catch {
            return null;
        }
    }
}
export const historyManager = new HistoryManager();
