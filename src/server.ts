import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import readline from "node:readline";
import type { ErrorDetails, ErrorResponse, Request, Response, SuccessResponse } from "./protocol.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

type ServerOptions = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

type IngestDocumentOptions = {
  emitFiles?: boolean;
  returnRecipes?: boolean;
  maxRecipes?: number | null;
  strictValidation?: boolean;
};

type IngestDocumentInput = {
  inputPath: string;
  outDir?: string;
  options?: IngestDocumentOptions;
};

type IngestDocumentEmitted = {
  outDir: string;
  indexPath: string;
  recipesDir: string;
  count: number;
};

type IngestDocumentRecipe = {
  name: string;
  slug: string;
  recipe: object;
};

type IngestDocumentOutput = {
  ok: boolean;
  source: { inputPath: string };
  recipes?: IngestDocumentRecipe[];
  emitted?: IngestDocumentEmitted;
  errors: string[];
};

type SegmentOptions = {
  maxChunks?: number | null;
};

type SegmentInput = {
  text: string;
  options?: SegmentOptions;
};

type SegmentChunk = {
  startLine: number;
  endLine: number;
  titleGuess?: string;
  confidence: number;
  evidence?: string;
};

type SegmentOutput = {
  chunks: SegmentChunk[];
  errors?: string[];
};

type ToSoustackSource = {
  startLine?: number;
  endLine?: number;
  evidence?: string;
};

type ToSoustackIntermediate = {
  title: string;
  ingredients: string[];
  instructions: string[];
  source?: ToSoustackSource;
};

type ToSoustackOptions = {
  sourcePath?: string;
};

type ToSoustackInput = {
  intermediate: ToSoustackIntermediate;
  options?: ToSoustackOptions;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const resolveIngestModuleName = (): string =>
  process.env.SOUSTACK_INGEST_MODULE ?? "soustack-ingest";

const buildErrorList = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }

  const errors = value.errors;
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.map((error) => String(error));
};

const isEmitted = (value: unknown): value is IngestDocumentEmitted => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.outDir === "string" &&
    typeof value.indexPath === "string" &&
    typeof value.recipesDir === "string" &&
    typeof value.count === "number"
  );
};

const extractEmitted = (value: unknown): IngestDocumentEmitted | undefined => {
  if (isRecord(value) && isEmitted(value.emitted)) {
    return value.emitted;
  }

  if (isEmitted(value)) {
    return value;
  }

  return undefined;
};

const extractRecipes = (value: unknown): IngestDocumentRecipe[] => {
  if (!isRecord(value) || !Array.isArray(value.recipes)) {
    return [];
  }

  return value.recipes as IngestDocumentRecipe[];
};

const resolveIngestHandler = (
  ingestModule: Record<string, unknown>
): ((input: Record<string, unknown>) => Promise<unknown>) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.ingestDocument,
    ingestModule.ingest,
    ingestModule.runIngest,
    ingestModule.run,
    defaultExport,
    isRecord(defaultExport) ? defaultExport.ingestDocument : undefined,
    isRecord(defaultExport) ? defaultExport.ingest : undefined,
    isRecord(defaultExport) ? defaultExport.runIngest : undefined,
    isRecord(defaultExport) ? defaultExport.run : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a usable ingest function.");
  }

  return handler as (input: Record<string, unknown>) => Promise<unknown>;
};

const normalizeIngestResult = (
  result: unknown,
  request: IngestDocumentInput
): IngestDocumentOutput => {
  const source = { inputPath: request.inputPath };
  const emitFiles = request.options?.emitFiles ?? Boolean(request.outDir);
  const returnRecipes = request.options?.returnRecipes ?? true;
  const errors = buildErrorList(result);

  if (isRecord(result) && result.ok === false) {
    return {
      ok: false,
      source,
      errors: errors.length > 0 ? errors : ["Ingest pipeline reported failure."]
    };
  }

  const output: IngestDocumentOutput = {
    ok: true,
    source,
    errors
  };

  if (returnRecipes) {
    output.recipes = extractRecipes(result);
  }

  if (emitFiles) {
    const emitted = extractEmitted(result);
    if (emitted) {
      output.emitted = emitted;
    }
  }

  return output;
};

const parseIngestInput = (
  input: Record<string, unknown>
): { value?: IngestDocumentInput; errors: string[]; source: { inputPath: string } } => {
  const errors: string[] = [];
  const inputPath = typeof input.inputPath === "string" ? input.inputPath : "";
  const source = { inputPath };

  if (!inputPath) {
    errors.push("inputPath must be a non-empty string.");
  }

  let outDir: string | undefined;
  if ("outDir" in input) {
    if (typeof input.outDir === "string") {
      outDir = input.outDir;
    } else if (input.outDir !== undefined) {
      errors.push("outDir must be a string when provided.");
    }
  }

  let options: IngestDocumentOptions | undefined;
  if ("options" in input && input.options !== undefined) {
    if (!isRecord(input.options)) {
      errors.push("options must be an object when provided.");
    } else {
      options = {};

      if ("emitFiles" in input.options) {
        if (typeof input.options.emitFiles === "boolean") {
          options.emitFiles = input.options.emitFiles;
        } else if (input.options.emitFiles !== undefined) {
          errors.push("options.emitFiles must be a boolean when provided.");
        }
      }

      if ("returnRecipes" in input.options) {
        if (typeof input.options.returnRecipes === "boolean") {
          options.returnRecipes = input.options.returnRecipes;
        } else if (input.options.returnRecipes !== undefined) {
          errors.push("options.returnRecipes must be a boolean when provided.");
        }
      }

      if ("maxRecipes" in input.options) {
        const value = input.options.maxRecipes;
        if (value === null || typeof value === "number") {
          options.maxRecipes = value as number | null;
        } else if (value !== undefined) {
          errors.push("options.maxRecipes must be a number or null when provided.");
        }
      }

      if ("strictValidation" in input.options) {
        if (typeof input.options.strictValidation === "boolean") {
          options.strictValidation = input.options.strictValidation;
        } else if (input.options.strictValidation !== undefined) {
          errors.push("options.strictValidation must be a boolean when provided.");
        }
      }
    }
  }

  if (errors.length > 0) {
    return { errors, source };
  }

  return {
    errors,
    source,
    value: {
      inputPath,
      outDir,
      options
    }
  };
};

const buildIngestRequest = (input: IngestDocumentInput): Record<string, unknown> => {
  const emitFiles = input.options?.emitFiles ?? Boolean(input.outDir);
  const returnRecipes = input.options?.returnRecipes ?? true;

  const request: Record<string, unknown> = {
    inputPath: input.inputPath,
    emitFiles,
    returnRecipes
  };

  if (input.outDir) {
    request.outDir = input.outDir;
  }

  if (input.options && "maxRecipes" in input.options) {
    request.maxRecipes = input.options.maxRecipes;
  }

  if (input.options && "strictValidation" in input.options) {
    request.strictValidation = input.options.strictValidation;
  }

  return request;
};

const parseSegmentInput = (input: Record<string, unknown>): { value?: SegmentInput; errors: string[] } => {
  const errors: string[] = [];
  const text = typeof input.text === "string" ? input.text : "";

  if (!text) {
    errors.push("text must be a non-empty string.");
  }

  let options: SegmentOptions | undefined;
  if ("options" in input && input.options !== undefined) {
    if (!isRecord(input.options)) {
      errors.push("options must be an object when provided.");
    } else {
      options = {};

      if ("maxChunks" in input.options) {
        const value = input.options.maxChunks;
        if (value === null || typeof value === "number") {
          options.maxChunks = value as number | null;
        } else if (value !== undefined) {
          errors.push("options.maxChunks must be a number or null when provided.");
        }
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      text,
      options
    }
  };
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const parseToSoustackInput = (
  input: Record<string, unknown>
): { value?: ToSoustackInput; errors: string[] } => {
  const errors: string[] = [];

  if (!isRecord(input.intermediate)) {
    errors.push("intermediate must be an object.");
  }

  const intermediateRecord = isRecord(input.intermediate) ? input.intermediate : {};
  const title = typeof intermediateRecord.title === "string" ? intermediateRecord.title : "";

  if (!title) {
    errors.push("intermediate.title must be a non-empty string.");
  }

  if (!isStringArray(intermediateRecord.ingredients)) {
    errors.push("intermediate.ingredients must be an array of strings.");
  }

  if (!isStringArray(intermediateRecord.instructions)) {
    errors.push("intermediate.instructions must be an array of strings.");
  }

  let source: ToSoustackSource | undefined;
  if ("source" in intermediateRecord && intermediateRecord.source !== undefined) {
    if (!isRecord(intermediateRecord.source)) {
      errors.push("intermediate.source must be an object when provided.");
    } else {
      source = {};

      if ("startLine" in intermediateRecord.source) {
        if (typeof intermediateRecord.source.startLine === "number") {
          source.startLine = intermediateRecord.source.startLine;
        } else if (intermediateRecord.source.startLine !== undefined) {
          errors.push("intermediate.source.startLine must be a number when provided.");
        }
      }

      if ("endLine" in intermediateRecord.source) {
        if (typeof intermediateRecord.source.endLine === "number") {
          source.endLine = intermediateRecord.source.endLine;
        } else if (intermediateRecord.source.endLine !== undefined) {
          errors.push("intermediate.source.endLine must be a number when provided.");
        }
      }

      if ("evidence" in intermediateRecord.source) {
        if (typeof intermediateRecord.source.evidence === "string") {
          source.evidence = intermediateRecord.source.evidence;
        } else if (intermediateRecord.source.evidence !== undefined) {
          errors.push("intermediate.source.evidence must be a string when provided.");
        }
      }
    }
  }

  let options: ToSoustackOptions | undefined;
  if ("options" in input && input.options !== undefined) {
    if (!isRecord(input.options)) {
      errors.push("options must be an object when provided.");
    } else if ("sourcePath" in input.options) {
      if (typeof input.options.sourcePath === "string" && input.options.sourcePath.length > 0) {
        options = { sourcePath: input.options.sourcePath };
      } else if (input.options.sourcePath !== undefined) {
        errors.push("options.sourcePath must be a non-empty string when provided.");
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      intermediate: {
        title,
        ingredients: intermediateRecord.ingredients as string[],
        instructions: intermediateRecord.instructions as string[],
        source
      },
      options
    }
  };
};

const resolveNormalizeStage = (
  ingestModule: Record<string, unknown>
): ((input: unknown) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.normalize,
    ingestModule.normalizeText,
    ingestModule.normalizeInput,
    isRecord(defaultExport) ? defaultExport.normalize : undefined,
    isRecord(defaultExport) ? defaultExport.normalizeText : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a normalize stage.");
  }

  return handler as (input: unknown) => Promise<unknown> | unknown;
};

const resolveSegmentStage = (
  ingestModule: Record<string, unknown>
): ((input: unknown, options?: SegmentOptions) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.segment,
    ingestModule.segmentText,
    ingestModule.segmentLines,
    isRecord(defaultExport) ? defaultExport.segment : undefined,
    isRecord(defaultExport) ? defaultExport.segmentText : undefined,
    isRecord(defaultExport) && isRecord(defaultExport.stages) ? defaultExport.stages.segment : undefined,
    isRecord(ingestModule.stages) ? ingestModule.stages.segment : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a segment stage.");
  }

  return handler as (input: unknown, options?: SegmentOptions) => Promise<unknown> | unknown;
};

const resolveToSoustackStage = (
  ingestModule: Record<string, unknown>
): ((intermediate: ToSoustackIntermediate, options?: ToSoustackOptions) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.toSoustack,
    isRecord(defaultExport) ? defaultExport.toSoustack : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a toSoustack stage.");
  }

  return handler as (intermediate: ToSoustackIntermediate, options?: ToSoustackOptions) => Promise<unknown> | unknown;
};

const runNormalizeStage = async (normalize: (input: unknown) => Promise<unknown> | unknown, text: string) => {
  try {
    return await normalize(text);
  } catch (error) {
    return await normalize({ text });
  }
};

const runSegmentStage = async (
  segment: (input: unknown, options?: SegmentOptions) => Promise<unknown> | unknown,
  normalized: unknown,
  options?: SegmentOptions
) => {
  if (options === undefined) {
    return await segment(normalized);
  }

  try {
    return await segment(normalized, options);
  } catch (error) {
    return await segment({ text: normalized, options });
  }
};

const extractSegmentChunks = (value: unknown): SegmentChunk[] => {
  if (Array.isArray(value)) {
    return value as SegmentChunk[];
  }

  if (isRecord(value) && Array.isArray(value.chunks)) {
    return value.chunks as SegmentChunk[];
  }

  return [];
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
  },
  "ingest.document": async (input) => {
    const parsed = parseIngestInput(input);
    if (!parsed.value) {
      return {
        ok: false,
        source: parsed.source,
        errors: parsed.errors
      };
    }

    try {
      const ingestModule = (await import(resolveIngestModuleName())) as Record<string, unknown>;
      const handler = resolveIngestHandler(ingestModule);
      const result = await handler(buildIngestRequest(parsed.value));
      return normalizeIngestResult(result, parsed.value);
    } catch (error) {
      return {
        ok: false,
        source: parsed.source,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  },
  "ingest.segment": async (input) => {
    const parsed = parseSegmentInput(input);
    if (!parsed.value) {
      return {
        chunks: [],
        errors: parsed.errors
      };
    }

    try {
      const ingestModule = (await import(resolveIngestModuleName())) as Record<string, unknown>;
      const normalize = resolveNormalizeStage(ingestModule);
      const segment = resolveSegmentStage(ingestModule);
      const normalized = await runNormalizeStage(normalize, parsed.value.text);
      const segmented = await runSegmentStage(segment, normalized, parsed.value.options);
      const chunks = extractSegmentChunks(segmented);
      return { chunks };
    } catch (error) {
      return {
        chunks: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  },
  "ingest.toSoustack": async (input) => {
    const parsed = parseToSoustackInput(input);
    if (!parsed.value) {
      return {
        recipe: {},
        errors: parsed.errors
      };
    }

    try {
      const ingestModule = (await import(resolveIngestModuleName())) as Record<string, unknown>;
      const toSoustack = resolveToSoustackStage(ingestModule);
      const options = parsed.value.options?.sourcePath
        ? { sourcePath: parsed.value.options.sourcePath }
        : undefined;
      const recipe = await toSoustack(parsed.value.intermediate, options);
      return { recipe: recipe as object };
    } catch (error) {
      return {
        recipe: {},
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
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
