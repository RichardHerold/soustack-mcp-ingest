import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distServerPath = path.resolve(__dirname, "..", "dist", "server.js");
if (!existsSync(distServerPath)) {
  execSync("npm run build", { stdio: "inherit" });
}

const { startServer } = await import(pathToFileURL(distServerPath).href);

const fixturesDir = path.resolve(__dirname, "..", "test", "fixtures");
const inputPath = path.join(fixturesDir, "sample.txt");
const outDir = path.join(fixturesDir, "out");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const input = new PassThrough();
const output = new PassThrough();
let buffer = "";

startServer({ input, output });

const request = {
  id: "smoke-test",
  tool: "ingest.document",
  input: {
    inputPath,
    outDir,
    options: {
      emitFiles: true,
      returnRecipes: true
    }
  }
};

input.write(`${JSON.stringify(request)}\n`);
input.end();

const response = await new Promise((resolve, reject) => {
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

const count =
  response.output?.emitted?.count ??
  (Array.isArray(response.output?.recipes) ? response.output.recipes.length : 0);

assert.ok(count > 0, `Expected recipe count > 0 but got ${count}`);
