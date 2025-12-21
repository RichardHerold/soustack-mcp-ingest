import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import readline from "node:readline";
import type { ErrorDetails, ErrorResponse, Request, Response, SuccessResponse } from "./protocol.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

type ServerOptions = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

const supportedInputKinds = ["text", "rtf", "rtfd.zip", "rtfd-dir"] as const;

const readPackageVersion = async (packageName?: string): Promise<string | null> => {
  try {
    if (packageName) {
      const require = createRequire(import.meta.url);
      const packagePath = require.resolve(`${packageName}/package.json`);
      const content = await readFile(packagePath, "utf8");
      return JSON.parse(content).version ?? null;
    }

    const content = await readFile(new URL("../package.json", import.meta.url), "utf8");
    return JSON.parse(content).version ?? null;
  } catch {
    return null;
  }
};

const tools: Record<string, ToolHandler> = {
  ping: async () => ({ pong: true }),
  "ingest.meta": async () => {
    const [mcpVersion, soustackIngestVersion, soustackVersion] = await Promise.all([
      readPackageVersion(),
      readPackageVersion("soustack-ingest"),
      readPackageVersion("soustack")
    ]);

    return {
      mcpVersion: mcpVersion ?? "unknown",
      soustackIngestVersion,
      soustackVersion,
      supportedInputKinds: [...supportedInputKinds],
      timestamp: new Date().toISOString()
    };
  }
};

const buildError = (id: string | null, error: ErrorDetails): ErrorResponse => ({
  id,
  ok: false,
  error
});

const buildSuccess = (id: string, output: Record<string, unknown>): SuccessResponse => ({
  id,
  ok: true,
  output
});

const isRequest = (value: unknown): value is Request => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.tool === "string" &&
    typeof record.input === "object" &&
    record.input !== null
  );
};

const writeResponse = (output: NodeJS.WritableStream, response: Response): void => {
  output.write(`${JSON.stringify(response)}\n`);
};

export const startServer = ({ input, output }: ServerOptions): void => {
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      writeResponse(
        output,
        buildError(null, {
          code: "invalid_json",
          message: "Request was not valid JSON.",
          details: { error: error instanceof Error ? error.message : String(error) }
        })
      );
      return;
    }

    if (!isRequest(parsed)) {
      writeResponse(
        output,
        buildError(null, {
          code: "invalid_request",
          message: "Request did not match the expected shape."
        })
      );
      return;
    }

    const { id, tool, input: toolInput } = parsed;
    const handler = tools[tool];
    if (!handler) {
      writeResponse(
        output,
        buildError(id, {
          code: "tool_not_found",
          message: `Tool \"${tool}\" is not available.`
        })
      );
      return;
    }

    try {
      const result = await handler(toolInput);
      writeResponse(output, buildSuccess(id, result));
    } catch (error) {
      writeResponse(
        output,
        buildError(id, {
          code: "tool_error",
          message: "Tool execution failed.",
          details: { error: error instanceof Error ? error.message : String(error) }
        })
      );
    }
  });
};
