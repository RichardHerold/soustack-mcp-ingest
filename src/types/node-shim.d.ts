declare namespace NodeJS {
  interface ReadableStream {
    on(event: string, listener: (...args: any[]) => void): this;
  }

  interface WritableStream {
    write(chunk: any): any;
  }
}

declare const process: {
  env: Record<string, string | undefined>;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  cwd(): string;
};

declare class Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare module "node:fs/promises" {
  export function readFile(path: string | URL, options?: any): Promise<string>;
  export function mkdir(path: string | URL, options?: any): Promise<void>;
  export function rm(path: string | URL, options?: any): Promise<void>;
}

declare module "node:module" {
  export type NodeRequire = ((id: string) => any) & {
    resolve(id: string): string;
  };

  export function createRequire(path: string | URL): NodeRequire;
}

declare module "node:readline" {
  export type Interface = {
    on(event: "line", listener: (line: string) => void): void;
  };

  export function createInterface(options: { input: NodeJS.ReadableStream; crlfDelay?: number }): Interface;

  const readline: {
    createInterface: typeof createInterface;
  };

  export default readline;
}

declare module "node:stream" {
  export class PassThrough {
    constructor();
    write(chunk: any): void;
    end(chunk?: any): void;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
  }
}

declare module "node:test" {
  export default function test(name: string, fn: () => Promise<void> | void): void;
}

declare module "node:assert/strict" {
  export interface Assert {
    (value: any, message?: string): asserts value;
    equal(actual: any, expected: any, message?: string): asserts actual is typeof expected;
    ok(value: any, message?: string): asserts value;
    deepEqual(actual: any, expected: any, message?: string): void;
  }

  const assert: Assert;
  export default assert;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;

  const path: {
    resolve: typeof resolve;
    dirname: typeof dirname;
    join: typeof join;
  };

  export default path;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
