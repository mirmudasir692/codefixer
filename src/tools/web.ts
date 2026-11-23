import { llm } from "mirascope";
import { z } from "zod";
import { errorMessage, truncate } from "../utils/index.js";

export const webFetchTool = llm.defineTool({
  name: "web_fetch",
  description:
    "Fetch a web page or API endpoint via HTTP GET/POST and return the response body (text or JSON).",
  validator: z.object({
    url: z.string().url().describe("The URL to fetch"),
    method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Optional HTTP headers"),
    body: z.string().optional().describe("Request body for POST requests"),
    timeoutSeconds: z.number().int().default(15).describe("Request timeout in seconds"),
  }),
  tool: async ({ url, method, headers = {}, body, timeoutSeconds }) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": "Codefixer-Agent/1.0",
          ...headers,
        },
        body: method === "POST" ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        contentType,
        data: truncate(text, 10_000),
        error: res.ok ? null : `HTTP ${res.status}: ${res.statusText}`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: 0,
        statusText: "",
        contentType: "",
        data: "",
        error: errorMessage(err),
      };
    }
  },
});

export const httpRequestTool = llm.defineTool({
  name: "http_request",
  description: "Send an arbitrary HTTP request (GET, POST, PUT, DELETE, PATCH) to an API endpoint.",
  validator: z.object({
    url: z.string().url().describe("Full URL"),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH"])
      .default("GET")
      .describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Custom headers"),
    body: z.string().optional().describe("Request body (e.g. JSON string)"),
    timeoutMs: z.number().int().default(15_000).describe("Timeout in milliseconds"),
  }),
  tool: async ({ url, method, headers = {}, body, timeoutMs }) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": "Codefixer/1.0",
          ...headers,
        },
        body: ["POST", "PUT", "PATCH"].includes(method) ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const text = await res.text();

      let isJson = false;
      try {
        JSON.parse(text);
        isJson = true;
      } catch {}

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        isJson,
        body: truncate(text, 5000),
        error: res.ok ? null : `HTTP ${res.status} ${res.statusText}`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: 0,
        statusText: "",
        headers: {},
        isJson: false,
        body: "",
        error: errorMessage(err),
      };
    }
  },
});

export const webSearchTool = llm.defineTool({
  name: "web_search",
  description:
    "Search the web using a search engine query. Returns top result titles, snippets, and URLs.",
  validator: z.object({
    query: z.string().describe("Search query string"),
    limit: z.number().int().positive().default(5).describe("Max results (default: 5)"),
  }),
  tool: async ({ query, limit }) => {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        return {
          ok: false,
          query,
          count: 0,
          results: [],
          error: `Search request failed with status ${res.status}`,
        };
      }

      const html = await res.text();
      const results: Array<{ title: string; snippet: string; url: string }> = [];

      // Extract results from DuckDuckGo html
      const regex =
        /<a class="result__url"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null && results.length < limit) {
        const rawUrl = match[1].trim();
        const snippet = match[2].replace(/<[^>]+>/g, "").trim();
        results.push({
          title: query,
          snippet,
          url: rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl,
        });
      }

      if (results.length === 0) {
        const linkRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let snippetMatch;
        while ((snippetMatch = linkRegex.exec(html)) !== null && results.length < limit) {
          results.push({
            title: `Result #${results.length + 1}`,
            snippet: snippetMatch[1].replace(/<[^>]+>/g, "").trim(),
            url: `https://duckduckgo.com/?q=${encoded}`,
          });
        }
      }

      return {
        ok: true,
        query,
        count: results.length,
        results,
        error: null,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        query,
        count: 0,
        results: [],
        error: errorMessage(err),
      };
    }
  },
});
