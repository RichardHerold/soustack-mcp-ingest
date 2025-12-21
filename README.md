# Soustack MCP Ingest

## Usage

Start the server:

```sh
soustack-mcp-ingest
```

Send a ping request:

```json
{"id":"ping-1","tool":"ping","input":{}}
```

Example response:

```json
{"id":"ping-1","ok":true,"output":{"pong":true}}
```

Request ingest meta information:

```json
{"id":"meta-1","tool":"ingest.meta","input":{}}
```

Example response:

```json
{"id":"meta-1","ok":true,"output":{"mcpVersion":"0.1.0","soustackIngestVersion":"1.2.3","soustackVersion":"4.5.6","supportedInputKinds":["text","rtf","rtfd.zip","rtfd-dir"],"timestamp":"2024-05-12T19:22:05.000Z"}}
```
