import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadConfiguredModels,
  saveConfiguredModel,
  deleteConfiguredModel,
  getConfiguredModel,
  normalizeModelUrl,
  getProviderLabel,
  getActiveModelName,
  setActiveModelName,
} from "../src/core/models.js";
import {
  activateConfiguredModel,
  getActiveConfiguredModel,
  getActiveConfiguredModelName,
  setModel,
  codeAgent,
} from "../src/core/agent.js";

describe("Model Tests", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codefixer-models-test-"));
    tmpFile = path.join(tmpDir, "models.json");
    process.env.CODEFIXER_MODELS_PATH = tmpFile;
  });

  afterEach(async () => {
    delete process.env.CODEFIXER_MODELS_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("Model Storage and Configuration", () => {
    test("loads empty list when models.json does not exist", async () => {
      const models = await loadConfiguredModels();
      assert.deepEqual(models, []);
    });

    test("saves and loads a configured model with url, api-key and name", async () => {
      const saved = await saveConfiguredModel({
        name: "qwen2.5:7b",
        url: "http://localhost:11434/v1",
        apiKey: "ollama",
      });

      assert.equal(saved.name, "qwen2.5:7b");
      assert.equal(saved.url, "http://localhost:11434/v1");
      assert.equal(saved.apiKey, "ollama");

      const models = await loadConfiguredModels();
      assert.equal(models.length, 1);
      assert.equal(models[0].name, "qwen2.5:7b");
      assert.equal(models[0].url, "http://localhost:11434/v1");
      assert.equal(models[0].apiKey, "ollama");
    });

    test("updates an existing model when saving with the same name (case-insensitive)", async () => {
      await saveConfiguredModel({
        name: "qwen2.5:7b",
        url: "http://localhost:11434/v1",
        apiKey: "key1",
      });

      await saveConfiguredModel({
        name: "QWEN2.5:7B",
        url: "http://127.0.0.1:11434/v1",
        apiKey: "key2",
      });

      const models = await loadConfiguredModels();
      assert.equal(models.length, 1);
      assert.equal(models[0].url, "http://127.0.0.1:11434/v1");
      assert.equal(models[0].apiKey, "key2");
    });

    test("getConfiguredModel finds model by name", async () => {
      await saveConfiguredModel({
        name: "gpt-4o",
        url: "https://api.openai.com/v1",
        apiKey: "sk-test",
      });

      const found = await getConfiguredModel("GPT-4O");
      assert.ok(found);
      assert.equal(found?.name, "gpt-4o");
      assert.equal(found?.apiKey, "sk-test");

      const notFound = await getConfiguredModel("non-existent");
      assert.equal(notFound, undefined);
    });

    test("deletes a configured model", async () => {
      await saveConfiguredModel({
        name: "model-a",
        url: "http://localhost:11434/v1",
      });
      await saveConfiguredModel({
        name: "model-b",
        url: "http://localhost:11434/v1",
      });

      const deleted = await deleteConfiguredModel("model-a");
      assert.equal(deleted, true);

      const models = await loadConfiguredModels();
      assert.equal(models.length, 1);
      assert.equal(models[0].name, "model-b");
    });

    test("persists active model name", async () => {
      await setActiveModelName("custom-coder");
      const active = await getActiveModelName();
      assert.equal(active, "custom-coder");
    });
  });

  describe("Model URL Normalization and Provider Labels", () => {
    test("normalizes local Ollama URL without /v1", () => {
      assert.equal(normalizeModelUrl("http://localhost:11434"), "http://localhost:11434/v1");
      assert.equal(normalizeModelUrl("localhost:11434"), "http://localhost:11434/v1");
      assert.equal(normalizeModelUrl("http://localhost:11434/"), "http://localhost:11434/v1");
    });

    test("preserves URL that already has /v1", () => {
      assert.equal(normalizeModelUrl("http://localhost:11434/v1"), "http://localhost:11434/v1");
      assert.equal(normalizeModelUrl("https://api.openai.com/v1"), "https://api.openai.com/v1");
    });

    test("normalizes provider hostnames to /v1", () => {
      assert.equal(normalizeModelUrl("https://api.openai.com"), "https://api.openai.com/v1");
      assert.equal(
        normalizeModelUrl("https://openrouter.ai/api/v1"),
        "https://openrouter.ai/api/v1",
      );
    });

    test("getProviderLabel detects provider from URL", () => {
      assert.equal(getProviderLabel("http://localhost:11434/v1"), "Ollama");
      assert.equal(getProviderLabel("https://api.openai.com/v1"), "OpenAI");
      assert.equal(getProviderLabel("https://api.anthropic.com/v1"), "Anthropic");
      assert.equal(getProviderLabel("https://openrouter.ai/api/v1"), "OpenRouter");
      assert.equal(getProviderLabel("https://api.together.xyz/v1"), "Together");
      assert.equal(getProviderLabel("https://api.groq.com/openai/v1"), "Groq");
      assert.equal(getProviderLabel("https://api.deepseek.com/v1"), "DeepSeek");
    });
  });

  describe("Model Activation", () => {
    test("activateConfiguredModel registers provider and updates active model", () => {
      const model = {
        name: "qwen2.5-coder:7b",
        url: "http://localhost:11434/v1",
        apiKey: "ollama",
      };

      const formattedId = activateConfiguredModel(model);

      assert.ok(formattedId.includes("qwen2.5-coder:7b"));
      assert.equal(getActiveConfiguredModelName(), "qwen2.5-coder:7b");
      assert.equal(getActiveConfiguredModel()?.name, "qwen2.5-coder:7b");
      assert.equal(getActiveConfiguredModel()?.url, "http://localhost:11434/v1");
      assert.ok(typeof codeAgent === "function");
    });

    test("setModel switches to ollama model and clears activeConfiguredModel", () => {
      const res = setModel("llama3.2:3b");
      assert.equal(res, "ollama/llama3.2:3b");
      assert.equal(getActiveConfiguredModel(), null);
      assert.equal(getActiveConfiguredModelName(), null);
    });

    test("full flow: save multiple models and select one", async () => {
      await saveConfiguredModel({
        name: "qwen2.5:7b",
        url: "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      await saveConfiguredModel({
        name: "gpt-4o",
        url: "https://api.openai.com/v1",
        apiKey: "sk-proj-test",
      });

      const models = await loadConfiguredModels();
      assert.equal(models.length, 2);

      // Choose model 2 (gpt-4o)
      activateConfiguredModel(models[1]);
      assert.equal(getActiveConfiguredModelName(), "gpt-4o");
      assert.equal(getActiveConfiguredModel()?.url, "https://api.openai.com/v1");
      assert.equal(getActiveConfiguredModel()?.apiKey, "sk-proj-test");
    });
  });
});
