import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const dir = mkdtempSync(join(tmpdir(), "bank-guard-"));
process.env.DATA_DIR = dir;
process.env.BASE_URL = "http://127.0.0.1:8080";
delete process.env.BANKMCP_LOCAL;
delete process.env.SETUP_TOKEN;
for (const k of ["EB_APP_ID", "EB_PRIVATE_KEY", "EB_PRIVATE_KEY_PATH", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH"]) delete process.env[k];

const { createApp } = await import("../src/app.ts");
const { SETUP_CLOSED, SETUP_TOKEN_REQUIRED } = await import("../src/setup.ts");

const app = createApp({ remote: false });
const server = await new Promise<Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());

function post(path: string, body: string, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
    redirect: "manual",
  });
}

test("setup is refused when the server is unconfigured and SETUP_TOKEN is unset", async () => {
  delete process.env.SETUP_TOKEN;
  const home = await fetch(base + "/");
  assert.equal(home.status, 403);
  assert.match(await home.text(), /setup over the network is closed/);
  const posted = await post("/setup", "app_id=11111111-2222-3333-4444-555555555555");
  assert.equal(posted.status, 403);
  assert.match(await posted.text(), new RegExp(SETUP_CLOSED.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const register = await post("/setup/register", "email=person@example.com");
  assert.equal(register.status, 403);
  const complete = await fetch(base + "/setup/complete?state=x&oobCode=y");
  assert.equal(complete.status, 403);
  assert.equal(existsSync(join(dir, "settings.json")), false);
  assert.equal(existsSync(join(dir, "enablebanking.pem")), false);
});

test("setup is refused without the token and accepted with the correct one", async () => {
  process.env.SETUP_TOKEN = "correct-setup-token";
  const missing = await fetch(base + "/");
  assert.equal(missing.status, 403);
  assert.match(await missing.text(), /SETUP_TOKEN/);

  const wrong = await post("/setup", "app_id=nope", { "x-setup-token": "nope" });
  assert.equal(wrong.status, 403);
  assert.match(await wrong.text(), new RegExp(SETUP_TOKEN_REQUIRED.slice(0, 24)));

  const page = await fetch(base + "/?setup_token=" + encodeURIComponent("correct-setup-token"));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Application id/);
  assert.match(page.headers.get("set-cookie") ?? "", /setup_token=/);
  assert.doesNotMatch(html, /correct-setup-token/);

  const bad = await post("/setup", "app_id=not-a-uuid&password=a-long-password!&password2=a-long-password!", { "x-setup-token": "correct-setup-token" });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /UUID/);

  const fromForm = await post("/setup", "setup_token=correct-setup-token&app_id=not-a-uuid");
  assert.equal(fromForm.status, 400);
  assert.match(await fromForm.text(), /UUID/);
  assert.equal(existsSync(join(dir, "settings.json")), false);
});

test("a server configured by environment does not ask for SETUP_TOKEN", async () => {
  process.env.EB_APP_ID = "11111111-2222-3333-4444-555555555555";
  process.env.EB_PRIVATE_KEY = "not-a-real-key";
  process.env.ADMIN_PASSWORD = "a-long-password!";
  delete process.env.SETUP_TOKEN;
  try {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Not configured yet|private key/i);
    assert.doesNotMatch(text, /SETUP_TOKEN/);
  } finally {
    delete process.env.EB_APP_ID;
    delete process.env.EB_PRIVATE_KEY;
    delete process.env.ADMIN_PASSWORD;
  }
});
