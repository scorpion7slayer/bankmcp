import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bank-base-"));
process.env.EB_API_BASE = "https://evil.example/api";
process.env.EB_CP_BASE = "https://evil.example/cp";
process.env.EB_PROFILE_BASE = "https://evil.example/profiles";

const { config } = await import("../src/config.ts");
const { checkApplication } = await import("../src/enablebanking.ts");
const { profileApplications, requestSignInLink } = await import("../src/controlpanel.ts");

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("Enable Banking bases cannot be overridden from the environment", async () => {
  assert.equal(config.apiBase, "https://api.enablebanking.com");

  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    seen.push(urlOf(input));
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  };
  try {
    await checkApplication("11111111-2222-3333-4444-555555555555", pem).catch(() => {});
    await requestSignInLink("a@b.c", "https://localhost/cb", async (input) => {
      seen.push(urlOf(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await profileApplications("token", "uid", async (input) => {
      seen.push(urlOf(input));
      return new Response("{}", { status: 404 });
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(seen[0], "https://api.enablebanking.com/application");
  assert.equal(new URL(seen[1]!).origin, "https://enablebanking.com");
  assert.equal(new URL(seen[2]!).origin, "https://firestore.googleapis.com");
  assert.match(seen[2]!, /\/projects\/enablebanking\/databases\/\(default\)\/documents\/users\/uid$/);
  assert.equal(seen.some((u) => u.includes("evil.example")), false);
});
