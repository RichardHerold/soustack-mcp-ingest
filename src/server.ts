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

type ExtractChunk = {
  startLine: number;
  endLine: number;
  titleGuess?: string;
};

type ExtractInput = {
  text: string;
  chunk: ExtractChunk;
};

type IntermediateRecipe = {
  title: string;
  ingredients: string[];
  instructions: string[];
  source: {
    startLine: number;
    endLine: number;
    evidence?: string;
  };
};

type IntermediateRecipeInput = {
  title: string;
  ingredients: string[];
  instructions: string[];
  source?: {
    startLine?: number;
    endLine?: number;
    evidence?: string;
  };
};

type ToSoustackOptions = {
  sourcePath?: string;
};

type ToSoustackInput = {
  intermediate: IntermediateRecipeInput;
  options?: ToSoustackOptions;
};

type ToSoustackOutput = {
  recipe: object;
};

type ValidateInput = {
  recipe: object;
};

type ValidationResult = {
  ok: boolean;
  errors: string[];
};

type SoustackValidator = (recipe: object) => Promise<unknown> | unknown;

const supportedInputKinds = ["text", "rtf", "rtfd.zip", "rtfd-dir"] as const;
const canonicalSchema = "https://spec.soustack.org/soustack.schema.json";
const profileLite = "soustack/recipe-lite";
const defaultStackKey = "default";

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

const resolveSoustackModuleName = (): string =>
  process.env.SOUSTACK_VALIDATOR_MODULE ?? process.env.SOUSTACK_MODULE ?? "soustack";

const buildErrorList = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }

  const errors = value.errors;
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.map((error) => String(error)).sort((left, right) => left.localeCompare(right));
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

const resolveSoustackValidator = (soustackModule: Record<string, unknown>): SoustackValidator => {
  const defaultExport = soustackModule.default;
  const candidates = [
    soustackModule.validateRecipe,
    soustackModule.validate,
    soustackModule.validateRecipePayload,
    isRecord(defaultExport) ? defaultExport.validateRecipe : undefined,
    isRecord(defaultExport) ? defaultExport.validate : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack did not expose a validator.");
  }

  return handler as SoustackValidator;
};

const sortObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = sortObjectKeys(value[key]);
      return accumulator;
    }, {});
};

const resolveStacksMap = (value: unknown, slug?: string): Record<string, unknown> => {
  if (isRecord(value)) {
    return sortObjectKeys(value) as Record<string, unknown>;
  }

  if (Array.isArray(value)) {
    const map: Record<string, unknown> = {};
    value.map((entry) => String(entry)).forEach((entry) => {
      map[entry] = true;
    });
    return sortObjectKeys(map) as Record<string, unknown>;
  }

  const key = slug && slug.trim() ? slug : defaultStackKey;
  return { [key]: true };
};

const canonicalizeRecipe = (recipe: object, slug?: string): Record<string, unknown> => {
  const record = isRecord(recipe) ? recipe : {};
  const normalized: Record<string, unknown> = {};

  normalized.$schema = canonicalSchema;

  normalized.profile =
    typeof record.profile === "string" && record.profile.trim() ? record.profile : profileLite;

  normalized.stacks = resolveStacksMap(record.stacks, slug);

  const remainingEntries = Object.entries(record).filter(
    ([key]) => key !== "$schema" && key !== "profile" && key !== "stacks"
  );

  Object.assign(normalized, sortObjectKeys(Object.fromEntries(remainingEntries)) as object);
  return normalized;
};

const ensureSlug = (slug: unknown, name: unknown, sourcePath: string): string => {
  const slugify = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  if (typeof slug === "string" && slug.trim()) {
    const normalized = slugify(slug);
    if (normalized) {
      return normalized;
    }
  }

  if (typeof name === "string" && name.trim()) {
    const normalized = slugify(name);
    if (normalized) {
      return normalized;
    }
  }

  const match = sourcePath.split(/[\\/]/).filter(Boolean).pop();
  if (match) {
    const normalized = slugify(match.replace(/\.[^.]+$/, ""));
    if (normalized) {
      return normalized;
    }
  }

  return "recipe";
};

const normalizeDocumentRecipes = (
  value: unknown,
  request: IngestDocumentInput
): IngestDocumentRecipe[] => {
  const recipes = extractRecipes(value).map((entry) => {
    const slug = ensureSlug(entry.slug, entry.name, request.inputPath);
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name : slug;
    const recipe = canonicalizeRecipe(entry.recipe, slug);
    return { ...entry, name, slug, recipe } satisfies IngestDocumentRecipe;
  });

  return recipes.sort((left, right) => left.slug.localeCompare(right.slug) || left.name.localeCompare(right.name));
};

const validateDocumentRecipes = async (
  recipes: IngestDocumentRecipe[],
  validator?: SoustackValidator
): Promise<string[]> => {
  if (!validator) {
    return [];
  }

  const errors: string[] = [];

  for (const recipe of recipes) {
    const result = normalizeValidationResult(await validator(recipe.recipe));
    if (!result.ok) {
      const prefix = `[${recipe.slug}] `;
      const messages = result.errors.length > 0 ? result.errors : ["Validation failed."];
      errors.push(...messages.map((message) => `${prefix}${message}`));
    }
  }

  return errors;
};

const normalizeIngestResult = async (
  result: unknown,
  request: IngestDocumentInput,
  validator?: SoustackValidator
): Promise<IngestDocumentOutput> => {
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
    output.recipes = normalizeDocumentRecipes(result, request);
  }

  if (emitFiles) {
    const emitted = extractEmitted(result);
    if (emitted) {
      output.emitted = emitted;
    }
  }

  if (output.recipes) {
    const validationErrors = await validateDocumentRecipes(output.recipes, validator);
    if (validationErrors.length > 0) {
      output.ok = false;
      output.errors = [...output.errors, ...validationErrors];
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

const parseExtractInput = (input: Record<string, unknown>): { value?: ExtractInput; errors: string[] } => {
  const errors: string[] = [];
  const text = typeof input.text === "string" ? input.text : "";

  if (!text) {
    errors.push("text must be a non-empty string.");
  }

  const chunkValue = input.chunk;
  if (!isRecord(chunkValue)) {
    errors.push("chunk must be an object.");
  }

  const startLine = isRecord(chunkValue) ? chunkValue.startLine : undefined;
  const endLine = isRecord(chunkValue) ? chunkValue.endLine : undefined;
  const titleGuess = isRecord(chunkValue) ? chunkValue.titleGuess : undefined;

  if (typeof startLine !== "number" || !Number.isFinite(startLine)) {
    errors.push("chunk.startLine must be a number.");
  } else if (startLine <= 0) {
    errors.push("chunk.startLine must be greater than zero.");
  }

  if (typeof endLine !== "number" || !Number.isFinite(endLine)) {
    errors.push("chunk.endLine must be a number.");
  } else if (endLine <= 0) {
    errors.push("chunk.endLine must be greater than zero.");
  }

  if (
    typeof startLine === "number" &&
    typeof endLine === "number" &&
    Number.isFinite(startLine) &&
    Number.isFinite(endLine) &&
    startLine > endLine
  ) {
    errors.push("chunk.startLine must be less than or equal to chunk.endLine.");
  }

  if (titleGuess !== undefined && typeof titleGuess !== "string") {
    errors.push("chunk.titleGuess must be a string when provided.");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      text,
      chunk: {
        startLine: startLine as number,
        endLine: endLine as number,
        titleGuess: titleGuess as string | undefined
      }
    }
  };
};

const parseIntermediateInput = (
  input: Record<string, unknown>,
  errors: string[]
): IntermediateRecipeInput | undefined => {
  const intermediate = input.intermediate;
  if (!isRecord(intermediate)) {
    errors.push("intermediate must be an object.");
    return undefined;
  }

  const title = intermediate.title;
  if (typeof title !== "string" || !title.trim()) {
    errors.push("intermediate.title must be a non-empty string.");
  }

  const ingredients = intermediate.ingredients;
  if (!Array.isArray(ingredients) || ingredients.some((item) => typeof item !== "string")) {
    errors.push("intermediate.ingredients must be an array of strings.");
  }

  const instructions = intermediate.instructions;
  if (!Array.isArray(instructions) || instructions.some((item) => typeof item !== "string")) {
    errors.push("intermediate.instructions must be an array of strings.");
  }

  const source = intermediate.source;
  if (source !== undefined) {
    if (!isRecord(source)) {
      errors.push("intermediate.source must be an object when provided.");
    } else {
      const startLine = source.startLine;
      const endLine = source.endLine;
      const evidence = source.evidence;

      if (startLine !== undefined && (typeof startLine !== "number" || !Number.isFinite(startLine))) {
        errors.push("intermediate.source.startLine must be a number when provided.");
      }

      if (endLine !== undefined && (typeof endLine !== "number" || !Number.isFinite(endLine))) {
        errors.push("intermediate.source.endLine must be a number when provided.");
      }

      if (typeof startLine === "number" && typeof endLine === "number" && startLine > endLine) {
        errors.push("intermediate.source.startLine must be less than or equal to intermediate.source.endLine.");
      }

      if (evidence !== undefined && typeof evidence !== "string") {
        errors.push("intermediate.source.evidence must be a string when provided.");
      }
    }
  }

  if (errors.length > 0) {
    return undefined;
  }

  return {
    title: title as string,
    ingredients: ingredients as string[],
    instructions: instructions as string[],
    source: source as IntermediateRecipeInput["source"]
  };
};

const parseToSoustackInput = (input: Record<string, unknown>): { value?: ToSoustackInput; errors: string[] } => {
  const errors: string[] = [];
  const intermediate = parseIntermediateInput(input, errors);

  let options: ToSoustackOptions | undefined;
  if ("options" in input && input.options !== undefined) {
    if (!isRecord(input.options)) {
      errors.push("options must be an object when provided.");
    } else {
      options = {};
      if ("sourcePath" in input.options) {
        if (typeof input.options.sourcePath === "string") {
          options.sourcePath = input.options.sourcePath;
        } else if (input.options.sourcePath !== undefined) {
          errors.push("options.sourcePath must be a string when provided.");
        }
      }
    }
  }

  if (errors.length > 0 || !intermediate) {
    return { errors };
  }

  return {
    errors,
    value: {
      intermediate,
      options
    }
  };
};

const parseValidateInput = (input: Record<string, unknown>): { value?: ValidateInput; errors: string[] } => {
  const errors: string[] = [];
  const recipe = input.recipe;

  if (!isRecord(recipe)) {
    errors.push("recipe must be an object.");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      recipe: recipe as object
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

const resolveExtractStage = (
  ingestModule: Record<string, unknown>
): ((chunk: ExtractChunk, lines: string[]) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.extract,
    ingestModule.extractRecipe,
    ingestModule.extractChunk,
    isRecord(defaultExport) ? defaultExport.extract : undefined,
    isRecord(defaultExport) ? defaultExport.extractRecipe : undefined,
    isRecord(defaultExport) ? defaultExport.extractChunk : undefined,
    isRecord(defaultExport) && isRecord(defaultExport.stages) ? defaultExport.stages.extract : undefined,
    isRecord(ingestModule.stages) ? ingestModule.stages.extract : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose an extract stage.");
  }

  return handler as (chunk: ExtractChunk, lines: string[]) => Promise<unknown> | unknown;
};

const resolveToSoustackStage = (
  ingestModule: Record<string, unknown>
): ((intermediate: IntermediateRecipeInput, options?: ToSoustackOptions) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.toSoustack,
    isRecord(defaultExport) ? defaultExport.toSoustack : undefined,
    isRecord(defaultExport) && isRecord(defaultExport.stages) ? defaultExport.stages.toSoustack : undefined,
    isRecord(ingestModule.stages) ? ingestModule.stages.toSoustack : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a toSoustack stage.");
  }

  return handler as (intermediate: IntermediateRecipeInput, options?: ToSoustackOptions) => Promise<unknown> | unknown;
};

const resolveValidateStage = (
  ingestModule: Record<string, unknown>
): ((recipe: object) => Promise<unknown> | unknown) => {
  const defaultExport = ingestModule.default;
  const candidates = [
    ingestModule.validate,
    isRecord(defaultExport) ? defaultExport.validate : undefined,
    isRecord(defaultExport) && isRecord(defaultExport.stages) ? defaultExport.stages.validate : undefined,
    isRecord(ingestModule.stages) ? ingestModule.stages.validate : undefined
  ];

  const handler = candidates.find((candidate) => typeof candidate === "function");
  if (!handler) {
    throw new Error("soustack-ingest did not expose a validate stage.");
  }

  return handler as (recipe: object) => Promise<unknown> | unknown;
};

const runNormalizeStage = async (normalize: (input: unknown) => Promise<unknown> | unknown, text: string) => {
  try {
    return await normalize(text);
  } catch (error) {
    return await normalize({ text });
  }
};

const normalizeValidationResult = (result: unknown): ValidationResult => {
  if (!isRecord(result)) {
    return {
      ok: false,
      errors: ["Validator returned an invalid result."]
    };
  }

  const ok = result.ok === true;
  const errors = buildErrorList(result);

  return {
    ok,
    errors
  };
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

const resolveNormalizedLines = (normalized: unknown): string[] => {
  if (typeof normalized === "string") {
    return normalized.split("\n");
  }

  if (isRecord(normalized) && typeof normalized.text === "string") {
    return normalized.text.split("\n");
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
      canonicalSchema,
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
      const soustackModule = (await import(resolveSoustackModuleName())) as Record<string, unknown>;
      const validator = resolveSoustackValidator(soustackModule);
      const result = await handler(buildIngestRequest(parsed.value));
      return await normalizeIngestResult(result, parsed.value, validator);
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
  "ingest.extract": async (input) => {
    const parsed = parseExtractInput(input);
    if (!parsed.value) {
      return {
        intermediate: null,
        errors: parsed.errors
      };
    }

    try {
      const ingestModule = (await import(resolveIngestModuleName())) as Record<string, unknown>;
      const normalize = resolveNormalizeStage(ingestModule);
      const extract = resolveExtractStage(ingestModule);
      const normalized = await runNormalizeStage(normalize, parsed.value.text);
      const lines = resolveNormalizedLines(normalized);
      const intermediate = await extract(parsed.value.chunk, lines);
      return { intermediate: intermediate as IntermediateRecipe };
    } catch (error) {
      return {
        intermediate: null,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  },
  "ingest.toSoustack": async (input) => {
    const parsed = parseToSoustackInput(input);
    if (!parsed.value) {
      return {
        recipe: null,
        errors: parsed.errors
      };
    }

    try {
      const ingestModule = (await import(resolveIngestModuleName())) as Record<string, unknown>;
      const toSoustack = resolveToSoustackStage(ingestModule);
      const recipe = await toSoustack(parsed.value.intermediate, parsed.value.options);
      const slug = ensureSlug(parsed.value.intermediate.title, parsed.value.intermediate.title, parsed.value.options?.sourcePath ?? "");
      return { recipe: canonicalizeRecipe(recipe as object, slug) } as ToSoustackOutput;
    } catch (error) {
      return {
        recipe: null,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  },
  "ingest.validate": async (input) => {
    const parsed = parseValidateInput(input);
    if (!parsed.value) {
      return {
        ok: false,
        errors: parsed.errors
      };
    }

    try {
      const soustackModule = (await import(resolveSoustackModuleName())) as Record<string, unknown>;
      const validate = resolveSoustackValidator(soustackModule);
      const result = await validate(parsed.value.recipe);
      return normalizeValidationResult(result);
    } catch (error) {
      return {
        ok: false,
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
