import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("ingest.extract returns intermediate recipe for a chunk", async () => {
  const previousModule = process.env.SOUSTACK_INGEST_MODULE;
  process.env.SOUSTACK_INGEST_MODULE = new URL("./fixtures/soustack-ingest.js", import.meta.url).href;

  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let buffer = "";

    startServer({ input, output });

    const sample = [
      "Test Salad",
      "Ingredients:",
      "- Lettuce",
      "- Tomato",
      "Instructions:",
      "1. Chop",
      "2. Serve"
    ].join("\n");

    const request = {
      id: "extract-test",
      tool: "ingest.extract",
      input: {
        text: sample,
        chunk: {
          startLine: 1,
          endLine: 7,
          titleGuess: "Test Salad"
        }
      }
    };
    input.write(`${JSON.stringify(request)}\n`);
    input.end();

    const response = await new Promise<{
      ok: boolean;
      output?: {
        intermediate: {
          title: string;
          ingredients: string[];
          instructions: string[];
          source: {
            startLine: number;
            endLine: number;
            evidence?: string;
          };
        };
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
    assert.deepEqual(response.output.intermediate, {
      title: "Test Salad",
      ingredients: ["Lettuce", "Tomato"],
      instructions: ["Chop", "Serve"],
      source: {
        startLine: 1,
        endLine: 7,
        evidence: "Test Salad"
      }
    });
  } finally {
    if (previousModule === undefined) {
      delete process.env.SOUSTACK_INGEST_MODULE;
    } else {
      process.env.SOUSTACK_INGEST_MODULE = previousModule;
    }
  }
});
