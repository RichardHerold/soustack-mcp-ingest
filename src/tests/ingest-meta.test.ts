import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("ingest.meta returns expected shape", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let buffer = "";

  startServer({ input, output });

  const request = { id: "meta-test", tool: "ingest.meta", input: {} };
  input.write(`${JSON.stringify(request)}\n`);
  input.end();

  const response = await new Promise<{
    ok: boolean;
    output?: Record<string, unknown>;
  }>((resolve, reject) => {
    output.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n").filter(Boolean);
      if (lines.length > 0) {
        try {
          resolve(JSON.parse(lines[0]));
        } catch (error) {
          reject(error);
        }
      }
    });
    output.on("error", reject);
  });
  assert.equal(response.ok, true);
  assert.ok(response.output);
  assert.equal(typeof response.output.mcpVersion, "string");
  assert.ok("soustackIngestVersion" in response.output);
  assert.ok("soustackVersion" in response.output);
  assert.deepEqual(response.output.supportedInputKinds, ["text", "rtf", "rtfd.zip", "rtfd-dir"]);
  assert.equal(response.output.canonicalSchema, "https://spec.soustack.org/soustack.schema.json");
  assert.equal(typeof response.output.timestamp, "string");
});
