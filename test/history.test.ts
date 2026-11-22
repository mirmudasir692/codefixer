import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HistoryManager } from "../src/core/history.js";

describe("Persistent History Management", () => {
  let tempDir: string;
  let manager: HistoryManager;
  let testFile: string;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `codefixer_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });

    testFile = path.join(tempDir, "sample.txt");
    await writeFile(testFile, "initial content v1", "utf-8");

    manager = new HistoryManager(tempDir);
    await manager.init();
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("records checkpoints and restores modified file", async () => {
    // 1. Take snapshot of initial content
    await manager.snapshot(testFile, "modified sample.txt");

    // 2. Modify the file
    await writeFile(testFile, "corrupted content v2", "utf-8");
    assert.equal(await readFile(testFile, "utf-8"), "corrupted content v2");

    // 3. Revert last
    const res = await manager.revertLast();
    assert.equal(res.ok, true);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
  });

  test("removes newly created file on revert", async () => {
    const newFile = path.join(tempDir, "brand_new.txt");

    // 1. Snapshot a non-existent file (create operation)
    await manager.snapshot(newFile, "created brand_new.txt");

    // 2. Write the new file
    await writeFile(newFile, "hello new world", "utf-8");
    assert.equal(await readFile(newFile, "utf-8"), "hello new world");

    // 3. Revert should delete the created file
    const res = await manager.revertLast();
    assert.equal(res.ok, true);

    let exists = true;
    try {
      await readFile(newFile, "utf-8");
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "Expected newly created file to be deleted on revert");
  });

  test("restores deleted file on revert", async () => {
    // 1. Snapshot before deletion
    await manager.snapshot(testFile, "delete sample.txt");

    // 2. Delete file
    await rm(testFile);

    // 3. Revert should restore file
    const res = await manager.revertLast();
    assert.equal(res.ok, true);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
  });

  test("lists checkpoints accurately", async () => {
    await manager.snapshot(testFile, "action 1");
    await manager.snapshot(testFile, "action 2");

    const list = await manager.listCheckpoints(10);
    assert.equal(list.length, 2);
    assert.equal(list[0].description, "action 2");
    assert.equal(list[1].description, "action 1");
  });

  test("revertToCheckpoint restores state at target and drops later checkpoints", async () => {
    // cp1: modify initial v1 to "v2"
    await manager.snapshot(testFile, "cp1");
    await writeFile(testFile, "v2", "utf-8");
    const checkpoints = await manager.getCheckpoints();
    assert.equal(checkpoints.length, 1);
    const targetId = checkpoints[0].id;

    // cp2: modify v2 to "v3"
    await manager.snapshot(testFile, "cp2");
    await writeFile(testFile, "v3", "utf-8");
    assert.equal((await manager.getCheckpoints()).length, 2);

    // Revert to target: undoes cp2 and cp1, file back to "initial content v1"
    const res = await manager.revertToCheckpoint(targetId);
    assert.equal(res.ok, true);
    assert.equal(res.checkpointId, targetId);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
    assert.equal((await manager.getCheckpoints()).length, 0);
  });

  test("revertToCheckpoint returns error for unknown checkpoint id", async () => {
    await manager.snapshot(testFile, "cp1");

    const res = await manager.revertToCheckpoint("nonexistent");
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /not found/i);

    // History left untouched
    assert.equal((await manager.getCheckpoints()).length, 1);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
  });

  test("revertFile restores the most recent previous version of a file", async () => {
    await manager.snapshot(testFile, "edit 1");
    await writeFile(testFile, "version two", "utf-8");

    const res = await manager.revertFile(testFile);
    assert.equal(res.ok, true);
    assert.equal(res.filesReverted.length, 1);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
  });

  test("revertToMessage reverts changes from that message onward", async () => {
    manager.beginMessage(1);
    await manager.snapshot(testFile, "msg1 edit");
    await writeFile(testFile, "after msg1", "utf-8");

    manager.beginMessage(2);
    await manager.snapshot(testFile, "msg2 edit");
    await writeFile(testFile, "after msg2", "utf-8");

    const res = await manager.revertToMessage(2);
    assert.equal(res.ok, true);
    assert.equal(res.messageId, 2);
    // Message 2's change is undone; message 1's change is kept
    assert.equal(await readFile(testFile, "utf-8"), "after msg1");

    const remaining = await manager.getCheckpoints();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].messageId, 1);
  });

  test("revertToMessage(1) reverts every message", async () => {
    manager.beginMessage(1);
    await manager.snapshot(testFile, "msg1 edit");
    await writeFile(testFile, "v2", "utf-8");

    manager.beginMessage(2);
    await manager.snapshot(testFile, "msg2 edit");
    await writeFile(testFile, "v3", "utf-8");

    const res = await manager.revertToMessage(1);
    assert.equal(res.ok, true);
    assert.equal(await readFile(testFile, "utf-8"), "initial content v1");
    assert.equal((await manager.getCheckpoints()).length, 0);
  });

  test("revertToMessage returns error when no changes match", async () => {
    manager.beginMessage(1);
    await manager.snapshot(testFile, "msg1 edit");
    await writeFile(testFile, "v2", "utf-8");

    const res = await manager.revertToMessage(2);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /no changes/i);

    // Nothing reverted
    assert.equal((await manager.getCheckpoints()).length, 1);
    assert.equal(await readFile(testFile, "utf-8"), "v2");
  });
});
