import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bank-err-"));
process.env.BASE_URL = "http://127.0.0.1:8080";
process.env.EB_APP_ID = "11111111-2222-3333-4444-555555555555";
process.env.EB_PRIVATE_KEY = Buffer.from(pem).toString("base64");
process.env.ADMIN_PASSWORD = "a-long-password!";
delete process.env.BANKMCP_LOCAL;
delete process.env.SETUP_TOKEN;

const { EnableBankingError, logSafeDetail, publicEnableBankingError } = await import("../src/enablebanking.ts");
const { createApp } = await import("../src/app.ts");
const { createServer } = await import("../src/mcp.ts");
const { store } = await import("../src/store.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const SECRET = "sekret-body-token-do-not-show";

test("client and log text keep the status and drop the Enable Banking body", () => {
  const err = new EnableBankingError(502, `{"access_token":"${SECRET}","iban":"BE71096123456769"}`);
  assert.equal(publicEnableBankingError(err), "Enable Banking returned 502.");
  assert.equal(err.message.includes(SECRET), false);
  assert.equal(logSafeDetail(err), "HTTP 502");
  assert.equal(logSafeDetail(new Error("connect ECONNREFUSED")), "connect ECONNREFUSED");
  assert.equal(logSafeDetail(new Error(`bearer ${SECRET}`)), "request failed");
});

test("the callback page does not echo the Enable Banking body", async () => {
  const original = globalThis.fetch;
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://127.0.0.1")) return original(input, init);
    return new Response(JSON.stringify({ error: SECRET, access_token: SECRET }), { status: 400 });
  };
  const app = createApp({ remote: false });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    store().addPendingAuth({ state: "state-1", bank: { name: "Belfius", country: "BE" }, started: new Date().toISOString() });
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=state-1`);
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.match(text, /Enable Banking returned 400/);
    assert.equal(text.includes(SECRET), false);
    const logged = lines.join("\n");
    assert.match(logged, /HTTP 400/);
    assert.equal(logged.includes(SECRET), false);
  } finally {
    console.log = origLog;
    globalThis.fetch = original;
    server.close();
  }
});

test("a tool error returned to the assistant omits the Enable Banking body", async () => {
  const original = globalThis.fetch;
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: SECRET }), { status: 500 });
  try {
    const server = createServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const result = await client.callTool({ name: "list_banks", arguments: { country: "BE" } });
    const text = JSON.stringify(result);
    assert.match(text, /Enable Banking returned 500/);
    assert.equal(text.includes(SECRET), false);
    assert.match(lines.join("\n"), /HTTP 500/);
    assert.equal(lines.join("\n").includes(SECRET), false);
    await client.close();
  } finally {
    console.log = origLog;
    globalThis.fetch = original;
  }
});
