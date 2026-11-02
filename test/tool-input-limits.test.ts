import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bank-limits-"));
process.env.BASE_URL = "http://127.0.0.1:8080";
process.env.EB_APP_ID = "11111111-2222-3333-4444-555555555555";
process.env.EB_PRIVATE_KEY = Buffer.from(pem).toString("base64");
process.env.ADMIN_PASSWORD = "a-long-password!";
delete process.env.BANKMCP_LOCAL;
delete process.env.SETUP_TOKEN;

const { createServer } = await import("../src/mcp.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

async function withClient(fn: (client: Client) => Promise<void>) {
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

test("search_transactions with 106 counted argument elements is rejected with -32602", async () => {
  // 100 account refs + query + accounts key + four extra keys → 106 elements (> cap 105).
  const accounts = Array.from({ length: 100 }, (_, i) => `uid-${i}`);
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "search_transactions",
      arguments: { query: "coffee", accounts, extra1: "a", extra2: "b", extra3: "c", extra4: "d" },
    });
    assert.equal(result.isError, true);
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /-32602/);
    assert.match(text, /maximum of 105 elements/);
  });
});

test("list_accounts still works under the element cap", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /"accounts"\s*:\s*\[\]/);
  });
});
