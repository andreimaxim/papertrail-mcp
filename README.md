# Papertrail MCP

A focused, read-only Model Context Protocol server for searching migrated Papertrail logs through the SolarWinds Observability API. It runs locally over stdio and works with any stdio-capable MCP client.

## Tools

- `papertrail_list_environments` lists complete credential profiles without exposing API tokens or origins.
- `papertrail_get` performs one bearer-authenticated `GET` request to `/v1/logs` for a selected profile.

The server does not expose writes, other SolarWinds Observability endpoints, relative-time parsing, filter composition, terminal formatting, or live-tail polling. Tool output is limited to 2,000 lines or 50 KiB.

## Requirements

- Node.js 20 or newer.
- A SolarWinds Observability API Access token and regional public API origin for each Papertrail environment.

Configure profiles with environment variables:

```bash
export PAPERTRAIL_QA_API_TOKEN="your-qa-api-access-token"
export PAPERTRAIL_QA_API_BASE_URL="https://api.eu-01.cloud.solarwinds.com"

export PAPERTRAIL_STAGING_API_TOKEN="your-staging-api-access-token"
export PAPERTRAIL_STAGING_API_BASE_URL="https://api.na-02.cloud.solarwinds.com"

export PAPERTRAIL_PROD_API_TOKEN="your-prod-api-access-token"
export PAPERTRAIL_PROD_API_BASE_URL="https://api.na-01.cloud.solarwinds.com"
```

The segment between `PAPERTRAIL_` and the suffix becomes the lower-case profile name. Each profile needs both `_API_TOKEN` and `_API_BASE_URL`. The base URL must be a bare HTTPS origin for the account's SolarWinds Observability region, not a log-ingestion endpoint. The default profile is `prod`.

SolarWinds Observability API Access tokens currently have broader account access than this server exposes. Use a distinct token per environment where possible, store tokens as secrets, and never commit them to source control.

Run the published package with:

```bash
npx -y @andreimaxim/papertrail-mcp
```

The process communicates over stdio, so running it directly waits for an MCP client and may appear idle.

## Client configuration

Register the server as a stdio MCP server that runs `npx -y @andreimaxim/papertrail-mcp`. Many clients accept a JSON configuration like this:

```json
{
  "mcpServers": {
    "papertrail": {
      "command": "npx",
      "args": ["-y", "@andreimaxim/papertrail-mcp"],
      "env": {
        "PAPERTRAIL_PROD_API_TOKEN": "${PAPERTRAIL_PROD_API_TOKEN}",
        "PAPERTRAIL_PROD_API_BASE_URL": "${PAPERTRAIL_PROD_API_BASE_URL}"
      }
    }
  }
}
```

The exact file location and syntax depend on the client. Make sure the client forwards both `PAPERTRAIL_<ENVIRONMENT>_API_TOKEN` and `PAPERTRAIL_<ENVIRONMENT>_API_BASE_URL` for every profile you want to use, and store each `_API_TOKEN` value in the client's secret storage where available.

## Skill

The optional [`using-papertrail` skill](skill/using-papertrail/) teaches an agent how to search logs, follow pagination, and handle sensitive output. Its `mcp.json` declares the server for clients that let skills bundle MCP servers, so the server starts only when the skill is loaded. Copy the complete `skill/using-papertrail` directory into your client's skills directory. The bundled configuration forwards the conventional `qa`, `staging`, and `prod` profiles. Add another variable pair to the `papertrail.env` map in `mcp.json` when using a custom profile name.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Repository layout:

- `src/papertrail.ts`: profile discovery, URL validation, HTTP transport, redirect safety, and bounded output.
- `src/server.ts`: MCP schemas, read-only annotations, and tool handlers.
- `src/index.ts`: stdio executable.
- `test/`: client and MCP protocol tests.
- `skill/using-papertrail/`: optional agent skill.
