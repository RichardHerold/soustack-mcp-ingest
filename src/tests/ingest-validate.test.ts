import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("ingest.validate returns ok false for invalid recipe", async () => {
  const previousModule = process.env.SOUSTACK_INGEST_MODULE;
  process.env.SOUSTACK_INGEST_MODULE = new URL("./fixtures/soustack-ingest.js", import.meta.url).href;

  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let buffer = "";

    startServer({ input, output });

    const request = {
      id: "validate-test",
      tool: "ingest.validate",
      input: { recipe: {} }
    };
    input.write(`${JSON.stringify(request)}\n`);
    input.end();

    const response = await new Promise<{
      ok: boolean;
      output?: {
        ok: boolean;
        errors: string[];
      };
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
    assert.equal(response.output.ok, false);
    assert.deepEqual(response.output.errors, ["Recipe name is required."]);
  } finally {
    if (previousModule === undefined) {
      delete process.env.SOUSTACK_INGEST_MODULE;
    } else {
      process.env.SOUSTACK_INGEST_MODULE = previousModule;
    }
  }
});
