import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { startServer } from "../server.js";
import path from "node:path";

const canonicalSchema = "https://spec.soustack.org/soustack.schema.json";

test("ingest.document emits canonical recipes and validates each one", async () => {
  const previousIngestModule = process.env.SOUSTACK_INGEST_MODULE;
  const previousSoustackModule = process.env.SOUSTACK_VALIDATOR_MODULE;
  process.env.SOUSTACK_INGEST_MODULE = new URL("./fixtures/soustack-ingest.js", import.meta.url).href;
  process.env.SOUSTACK_VALIDATOR_MODULE = new URL("./fixtures/soustack.js", import.meta.url).href;

  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let buffer = "";

    const readResponse = async () =>
      await new Promise<Record<string, unknown>>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n").filter(Boolean);
          if (lines.length > 0) {
            buffer = lines.slice(1).join("\n");
            output.off("data", onData);
            try {
              resolve(JSON.parse(lines[0]));
            } catch (error) {
              reject(error);
            }
          }
        };

        output.on("data", onData);
        output.on("error", reject);
      });

    startServer({ input, output });

    const inputPath = path.resolve(process.cwd(), "src/tests/fixtures/sample-document.txt");

    input.write(
      `${JSON.stringify({
        id: "document-test",
        tool: "ingest.document",
        input: {
          inputPath,
          options: {
            returnRecipes: true,
            strictValidation: true
          }
        }
      })}\n`
    );

    const documentResponse = (await readResponse()) as {
      ok: boolean;
      output?: {
        source: { inputPath: string };
        recipes?: Array<{ name: string; slug: string; recipe: Record<string, unknown> }>;
        errors?: string[];
      };
    };

    assert.equal(documentResponse.ok, true);
    assert.ok(documentResponse.output);
    assert.ok(documentResponse.output.recipes);
    assert.equal(documentResponse.output.recipes.length, 1);

    const [recipeEntry] = documentResponse.output.recipes;
    assert.equal(recipeEntry.slug, "simple-recipe");
    assert.equal(recipeEntry.name, "Simple recipe");

    const recipe = recipeEntry.recipe;
    assert.equal(recipe.$schema, canonicalSchema);
    assert.equal(recipe.profile, "soustack/recipe-lite");
    assert.deepEqual(recipe.stacks, { "simple-recipe": true });

    input.write(
      `${JSON.stringify({
        id: "validate-simple-recipe",
        tool: "ingest.validate",
        input: { recipe }
      })}\n`
    );

    const validateResponse = (await readResponse()) as {
      ok: boolean;
      output?: { ok: boolean; errors: string[] };
    };

    assert.equal(validateResponse.ok, true);
    assert.ok(validateResponse.output);
    assert.equal(validateResponse.output.ok, true);
    assert.deepEqual(validateResponse.output.errors, []);

    input.end();
  } finally {
    if (previousIngestModule === undefined) {
      delete process.env.SOUSTACK_INGEST_MODULE;
    } else {
      process.env.SOUSTACK_INGEST_MODULE = previousIngestModule;
    }

    if (previousSoustackModule === undefined) {
      delete process.env.SOUSTACK_VALIDATOR_MODULE;
    } else {
      process.env.SOUSTACK_VALIDATOR_MODULE = previousSoustackModule;
    }
  }
});
