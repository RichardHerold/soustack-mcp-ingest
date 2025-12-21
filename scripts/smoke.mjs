import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/cli.js"], {
  stdio: ["pipe", "pipe", "inherit"]
});

const request = { id: "smoke", tool: "ping", input: {} };

child.stdin.write(`${JSON.stringify(request)}\n`);
child.stdin.end();

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});

const exitCode = await new Promise((resolve) => {
  child.on("close", resolve);
});

if (exitCode !== 0) {
  throw new Error(`Smoke test failed with exit code ${exitCode}.`);
}

const lines = output.trim().split("\n").filter(Boolean);
if (lines.length === 0) {
  throw new Error("Smoke test produced no output.");
}

const response = JSON.parse(lines[lines.length - 1]);
if (!response.ok || !response.output || response.output.pong !== true) {
  throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
}

console.log("Smoke test passed.");
