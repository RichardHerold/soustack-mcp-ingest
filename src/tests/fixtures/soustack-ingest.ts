type SegmentOptions = {
  maxChunks?: number | null;
};

type SegmentChunk = {
  startLine: number;
  endLine: number;
  titleGuess?: string;
  confidence: number;
  evidence?: string;
};

type ExtractChunk = {
  startLine: number;
  endLine: number;
  titleGuess?: string;
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

type ToSoustackOptions = {
  sourcePath?: string;
};

const resolveText = (input: string | { text: string }): string =>
  typeof input === "string" ? input : input.text;

export const normalize = (input: string | { text: string }): string => {
  const text = resolveText(input);
  return text.replace(/\r\n/g, "\n").trim();
};

export const segment = (
  input: string | { text: string; options?: SegmentOptions },
  options?: SegmentOptions
): { chunks: SegmentChunk[] } => {
  const text = typeof input === "string" ? input : input.text;
  const resolvedOptions = typeof input === "string" ? options : input.options;
  const lines = text.split("\n");
  const chunks: SegmentChunk[] = [];
  let startLine: number | null = null;
  let firstLine = "";

  const flush = (endLine: number) => {
    if (startLine === null) {
      return;
    }
    const chunk: SegmentChunk = {
      startLine,
      endLine,
      confidence: 0.95
    };
    if (firstLine) {
      chunk.titleGuess = firstLine;
      chunk.evidence = firstLine;
    }
    chunks.push(chunk);
    startLine = null;
    firstLine = "";
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) {
      flush(lineNumber - 1);
      return;
    }

    if (startLine === null) {
      startLine = lineNumber;
      firstLine = line.trim();
    }
  });

  flush(lines.length);

  if (resolvedOptions?.maxChunks != null) {
    return { chunks: chunks.slice(0, resolvedOptions.maxChunks) };
  }

  return { chunks };
};

const stripListPrefix = (value: string): string => value.replace(/^([-*]|\d+\.)\s*/, "");

export const extract = (chunk: ExtractChunk, lines: string[]): IntermediateRecipe => {
  const chunkLines = lines.slice(chunk.startLine - 1, chunk.endLine);
  const title = chunk.titleGuess ?? (chunkLines[0]?.trim() ?? "");
  const ingredients: string[] = [];
  const instructions: string[] = [];
  let mode: "ingredients" | "instructions" | null = null;

  chunkLines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (/^ingredients:?$/i.test(trimmed)) {
      mode = "ingredients";
      return;
    }
    if (/^instructions:?$/i.test(trimmed)) {
      mode = "instructions";
      return;
    }
    if (mode === "ingredients") {
      ingredients.push(stripListPrefix(trimmed));
      return;
    }
    if (mode === "instructions") {
      instructions.push(stripListPrefix(trimmed));
    }
  });

  return {
    title,
    ingredients,
    instructions,
    source: {
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      evidence: chunk.titleGuess
    }
  };
};

export const toSoustack = (
  intermediate: IntermediateRecipe,
  options?: ToSoustackOptions
): {
  name: string;
  ingredients: string[];
  instructions: string[];
  "x-ingest": {
    sourcePath?: string;
    source: IntermediateRecipe["source"];
  };
} => ({
  name: intermediate.title,
  ingredients: [...intermediate.ingredients],
  instructions: [...intermediate.instructions],
  "x-ingest": {
    sourcePath: options?.sourcePath,
    source: intermediate.source
  }
});

export const validate = (
  recipe: { name?: string | null }
): {
  ok: boolean;
  errors: string[];
} => {
  if (!recipe.name || !recipe.name.trim()) {
    return {
      ok: false,
      errors: ["name is required."]
    };
  }

  return {
    ok: true,
    errors: []
  };
};

export default {
  normalize,
  segment,
  extract,
  toSoustack,
  validate
};
