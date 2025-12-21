import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("ingest.segment returns chunks for multiple recipes", async () => {
  const previousModule = process.env.SOUSTACK_INGEST_MODULE;
  process.env.SOUSTACK_INGEST_MODULE = new URL("./fixtures/soustack-ingest.js", import.meta.url).href;

  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let buffer = "";

    startServer({ input, output });

    const sample = [
      "Pancakes",
      "Ingredients:",
      "- Flour",
      "",
      "Tomato Soup",
      "Ingredients:",
      "- Tomatoes"
    ].join("\n");

    const request = { id: "segment-test", tool: "ingest.segment", input: { text: sample } };
    input.write(`${JSON.stringify(request)}\n`);
    input.end();

    const response = await new Promise<{
      ok: boolean;
      output?: {
        chunks: Array<{
          startLine: number;
          endLine: number;
          titleGuess?: string;
          confidence: number;
          evidence?: string;
        }>;
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
    assert.equal(response.output.chunks.length, 2);
    assert.deepEqual(response.output.chunks[0], {
      startLine: 1,
      endLine: 3,
      titleGuess: "Pancakes",
      confidence: 0.95,
      evidence: "Pancakes"
    });
    assert.equal(response.output.chunks[1].startLine, 5);
    assert.equal(response.output.chunks[1].endLine, 7);
    assert.equal(response.output.chunks[1].titleGuess, "Tomato Soup");
  } finally {
    if (previousModule === undefined) {
      delete process.env.SOUSTACK_INGEST_MODULE;
    } else {
      process.env.SOUSTACK_INGEST_MODULE = previousModule;
    }
  }
});
