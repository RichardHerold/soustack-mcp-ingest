import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("ingest.toSoustack maps intermediate recipe to soustack recipe", async () => {
  const previousModule = process.env.SOUSTACK_INGEST_MODULE;
  process.env.SOUSTACK_INGEST_MODULE = new URL("./fixtures/soustack-ingest.js", import.meta.url).href;

  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let buffer = "";

    startServer({ input, output });

    const request = {
      id: "to-soustack-test",
      tool: "ingest.toSoustack",
      input: {
        intermediate: {
          title: "Test Salad",
          ingredients: ["Lettuce", "Tomato"],
          instructions: ["Chop", "Serve"],
          source: {
            startLine: 1,
            endLine: 7,
            evidence: "Test Salad"
          }
        },
        options: {
          sourcePath: "/tmp/sample.txt"
        }
      }
    };

    input.write(`${JSON.stringify(request)}\n`);
    input.end();

    const response = await new Promise<{
      ok: boolean;
      output?: {
        recipe: Record<string, unknown>;
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

    const recipe = response.output.recipe;
    assert.equal(recipe.name, "Test Salad");
    assert.ok(Array.isArray(recipe.ingredients));
    assert.ok(Array.isArray(recipe.instructions));
    assert.ok("x-ingest" in recipe);
    assert.deepEqual(recipe["x-ingest"], {
      sourcePath: "/tmp/sample.txt",
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
