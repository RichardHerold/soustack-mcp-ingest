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

export const validate = (recipe: unknown): { ok: boolean; errors: string[] } => {
  if (recipe && typeof recipe === "object" && "name" in recipe && typeof recipe.name === "string") {
    return { ok: true, errors: [] };
  }

  return { ok: false, errors: ["Recipe name is required."] };
};

export default {
  normalize,
  segment,
  validate
};
