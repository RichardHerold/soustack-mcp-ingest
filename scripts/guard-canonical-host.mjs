#!/usr/bin/env node

/**
 * Guard script to prevent legacy schema URLs from being introduced.
 * Fails if the repository contains any legacy schema host references.
 */

import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const legacyPatterns = [
  /https:\/\/soustack\.spec\//g,
  /https:\/\/soustack\.ai\/schemas\//g
];

const scanDirs = ["src", "test", "README.md"];

async function scanFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const matches = [];
    
    for (const pattern of legacyPatterns) {
      const patternMatches = [...content.matchAll(pattern)];
      if (patternMatches.length > 0) {
        matches.push({
          pattern: pattern.source,
          count: patternMatches.length,
          file: filePath
        });
      }
    }
    
    return matches;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isTestFixture(filePath) {
  // Allow legacy schema URLs in test fixtures since they test legacy acceptance
  return filePath.includes("/fixtures/") || filePath.includes("\\fixtures\\");
}

async function scanDirectory(dirPath, relativePath = "") {
  const matches = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relPath = relativePath ? join(relativePath, entry.name) : entry.name;
    
    if (entry.isDirectory()) {
      // Skip node_modules and other common ignore patterns
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      const subMatches = await scanDirectory(fullPath, relPath);
      matches.push(...subMatches);
    } else if (entry.isFile()) {
      // Skip test fixtures - they may contain legacy URLs for testing legacy acceptance
      if (isTestFixture(fullPath)) {
        continue;
      }
      // Only scan text files
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const textExts = ["md", "ts", "js", "mjs", "json", "txt", "yml", "yaml"];
      if (textExts.includes(ext) || entry.name === "README.md") {
        const fileMatches = await scanFile(fullPath);
        if (fileMatches.length > 0) {
          matches.push(...fileMatches);
        }
      }
    }
  }
  
  return matches;
}

async function main() {
  const allMatches = [];
  
  for (const scanDir of scanDirs) {
    const scanPath = join(repoRoot, scanDir);
    try {
      const stat = await import("node:fs/promises").then(m => m.stat(scanPath));
      if (stat.isFile()) {
        // Skip test fixtures
        if (!isTestFixture(scanPath)) {
          const matches = await scanFile(scanPath);
          allMatches.push(...matches);
        }
      } else if (stat.isDirectory()) {
        const matches = await scanDirectory(scanPath, scanDir);
        allMatches.push(...matches);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  
  if (allMatches.length > 0) {
    console.error("❌ Legacy schema URLs found:");
    console.error("");
    
    const filesByPath = new Map();
    for (const match of allMatches) {
      if (!filesByPath.has(match.file)) {
        filesByPath.set(match.file, []);
      }
      filesByPath.get(match.file).push(match);
    }
    
    for (const [file, matches] of filesByPath.entries()) {
      const relPath = file.replace(repoRoot + "/", "");
      console.error(`  ${relPath}:`);
      for (const match of matches) {
        console.error(`    - Pattern: ${match.pattern} (${match.count} occurrence(s))`);
      }
    }
    
    console.error("");
    console.error("Please update all references to use the canonical schema:");
    console.error("  https://spec.soustack.org/soustack.schema.json");
    process.exit(1);
  }
  
  console.log("✅ No legacy schema URLs found.");
}

main().catch((error) => {
  console.error("Error running guard script:", error);
  process.exit(1);
});

