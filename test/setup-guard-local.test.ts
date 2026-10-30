import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

process.env.BANKMCP_LOCAL = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bank-guard-local-"));
delete process.env.SETUP_TOKEN;
delete process.env.BASE_URL;
for (const k of ["EB_APP_ID", "EB_PRIVATE_KEY", "EB_PRIVATE_KEY_PATH", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH"]) delete process.env[k];

const { createApp } = await import("../src/app.ts");
const { config } = await import("../src/config.ts");

test("local mode still serves setup without SETUP_TOKEN", async () => {
  assert.equal(config.localMode, true);
  const app = createApp({ remote: false });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Application id/);
    const posted = await fetch(base + "/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "app_id=not-a-uuid",
    });
    assert.equal(posted.status, 400);
    assert.match(await posted.text(), /UUID/);
  } finally {
    server.close();
  }
});
