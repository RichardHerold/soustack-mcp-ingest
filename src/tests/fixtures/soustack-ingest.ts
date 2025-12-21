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

export const toSoustack = (intermediate: ToSoustackIntermediate, options?: ToSoustackOptions): object => {
  const recipe: Record<string, unknown> = {
    name: intermediate.title,
    ingredients: intermediate.ingredients,
    instructions: intermediate.instructions
  };

  if (options?.sourcePath) {
    recipe["x-ingest"] = {
      sourcePath: options.sourcePath,
      source: intermediate.source ?? null
    };
  }

  return recipe;
};

export default {
  normalize,
  segment,
  toSoustack
};
