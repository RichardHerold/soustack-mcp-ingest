# Soustack MCP Ingest

## Usage

Start the server:

```sh
soustack-mcp-ingest
```

## Protocol

The server reads newline-delimited JSON requests from stdin and writes newline-delimited JSON responses to stdout. Every request must include:

- `id`: unique request identifier.
- `tool`: the tool name.
- `input`: a JSON object for the tool's input payload.

Request shape:

```json
{"id":"request-1","tool":"<tool-name>","input":{}}
```

Success response shape:

```json
{"id":"request-1","ok":true,"output":{}}
```

Error response shape:

```json
{"id":"request-1","ok":false,"error":{"code":"tool_not_found","message":"Tool \"unknown\" is not available."}}
```

## Tools

### `ping`

Health check for the server.

```json
{"id":"ping-1","tool":"ping","input":{}}
```

### `ingest.meta`

Returns versions and supported input kinds.

```json
{"id":"meta-1","tool":"ingest.meta","input":{}}
```

### `ingest.segment`

Segments raw text into chunks using the `soustack-ingest` module.

```json
{"id":"segment-1","tool":"ingest.segment","input":{"text":"# Title\n\nFirst paragraph.\n\nSecond paragraph.","options":{"maxChunks":2}}}
```

### `ingest.validate`

Validates a Soustack recipe payload.

```json
{"id":"validate-1","tool":"ingest.validate","input":{"recipe":{"name":"Sample","ingredients":[],"instructions":[]}}}
```

### `ingest.document`

Runs the end-to-end ingest pipeline on a file or directory.

```json
{"id":"document-1","tool":"ingest.document","input":{"inputPath":"/data/notes","outDir":"/data/out","options":{"emitFiles":true,"returnRecipes":true,"maxRecipes":50,"strictValidation":true}}}
```

## Workflow example (stage-by-stage + end-to-end)

Below is a full workflow showing how the stages relate. `ingest.extract`, `ingest.toSoustack`, and `ingest.validate` are stages from the `soustack-ingest` module; they are executed inside the `ingest.document` tool and are also exposed as separate MCP tools.

1) **`ingest.segment`** — split text into chunks for downstream processing.

```json
{"id":"workflow-segment-1","tool":"ingest.segment","input":{"text":"# Intro\n\nHello world.\n\n## Details\nMore text here."}}
```

2) **`ingest.extract`** — extract structured data from each chunk.

3) **`ingest.toSoustack`** — convert extracted data into Soustack recipes.

4) **`ingest.validate`** — validate recipes against Soustack rules.

5) **`ingest.document`** — run all stages end-to-end on disk input.

```json
{"id":"workflow-document-1","tool":"ingest.document","input":{"inputPath":"/data/notes","options":{"emitFiles":false,"returnRecipes":true}}}
```
