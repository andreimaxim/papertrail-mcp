# Papertrail MCP

A focused, read-only Model Context Protocol server for searching migrated Papertrail logs through the SolarWinds Observability API. It runs locally over stdio and works with Amp, Claude Code, Codex, and other stdio-capable MCP clients.

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

## Amp

The distributable [`using-papertrail` skill](skill/using-papertrail/SKILL.md) starts the MCP server only when Papertrail work loads the skill. Copy it into a project's skill directory:

```bash
mkdir -p .agents/skills/using-papertrail
cp skill/using-papertrail/SKILL.md .agents/skills/using-papertrail/SKILL.md
```

In Amp, add the corresponding variables under personal, project, or workspace **Secrets & Env Vars**, storing each `_API_TOKEN` value as a secret. The bundled skill forwards conventional `qa`, `staging`, and `prod` profiles. Add another variable pair to its `mcpServers.papertrail.env` map when using a custom profile name.

Amp discovers the skill, launches the MCP process, and keeps its two tools hidden until the skill is loaded. The previous `amp.papertrail.*` settings are not read by this portable server.

## Claude Code

Register the server at user scope:

```bash
claude mcp add --scope user --transport stdio papertrail -- \
  npx -y @andreimaxim/papertrail-mcp
```

Launch Claude Code with the desired `PAPERTRAIL_<ENVIRONMENT>_API_TOKEN` and `PAPERTRAIL_<ENVIRONMENT>_API_BASE_URL` variables available. A project `.mcp.json` can declare the equivalent command while referring to securely managed environment variables.

## Codex

Add the server to `~/.codex/config.toml` or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.papertrail]
command = "npx"
args = ["-y", "@andreimaxim/papertrail-mcp"]
env_vars = [
  "PAPERTRAIL_PROD_API_TOKEN",
  "PAPERTRAIL_PROD_API_BASE_URL",
]
enabled_tools = ["papertrail_list_environments", "papertrail_get"]
```

Add both variable names for every additional profile that Codex should forward.

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
- `skill/using-papertrail/`: optional Amp skill.
