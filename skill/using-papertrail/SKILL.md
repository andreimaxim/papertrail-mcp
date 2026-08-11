---
name: using-papertrail
description: Investigates migrated Papertrail logs through the read-only SolarWinds Observability logs API. Use for production log searches, incident triage, request tracing, and log correlation.
mcpServers:
  papertrail:
    command: npx
    args: ["-y", "@andreimaxim/papertrail-mcp"]
    env:
      PAPERTRAIL_QA_API_TOKEN: "${PAPERTRAIL_QA_API_TOKEN}"
      PAPERTRAIL_QA_API_BASE_URL: "${PAPERTRAIL_QA_API_BASE_URL}"
      PAPERTRAIL_STAGING_API_TOKEN: "${PAPERTRAIL_STAGING_API_TOKEN}"
      PAPERTRAIL_STAGING_API_BASE_URL: "${PAPERTRAIL_STAGING_API_BASE_URL}"
      PAPERTRAIL_PROD_API_TOKEN: "${PAPERTRAIL_PROD_API_TOKEN}"
      PAPERTRAIL_PROD_API_BASE_URL: "${PAPERTRAIL_PROD_API_BASE_URL}"
    includeTools: ["papertrail_list_environments", "papertrail_get"]
---

# Using Papertrail

Search migrated Papertrail logs with `papertrail_list_environments` and `papertrail_get`. The MCP server can only make authenticated `GET` requests to `/v1/logs`; it cannot write data or call other SolarWinds Observability endpoints.

## Choose the credential environment

Call `papertrail_list_environments` before the first request when the environment is not already established. Use the user-requested environment when it is listed. Otherwise use `prod` only when it is listed; if not, ask which configured environment to use.

Keep the top-level `environment` consistent across a paginated search. It selects the token and regional API origin; it is not a log filter.

## Search logs

Start with a narrow time range, a focused filter, and a bounded page size:

```json
{
  "path": "/v1/logs",
  "environment": "prod",
  "query": {
    "filter": "host:\"checkout\" error",
    "startTime": "2026-08-05T10:00:00Z",
    "endTime": "2026-08-05T10:15:00Z",
    "direction": "backward",
    "pageSize": 100
  }
}
```

The API accepts these query parameters:

- `filter`: the complete SolarWinds Observability log search expression.
- `group`: a log group name.
- `entityId`: an entity identifier.
- `startTime` and `endTime`: ISO-8601 UTC timestamps such as `2026-08-05T10:00:00Z`.
- `direction`: `backward`, `forward`, or `tail`; default is `backward`.
- `pageSize`: number of events requested for one page.
- `skipToken`: opaque pagination token. Prefer the returned `nextPage` path rather than constructing this value.

Build timestamps and the complete `filter` before calling the tool. Do not expect the server to parse relative times or combine search terms. Do not poll `tail`; the server intentionally performs one request per tool call.

## Follow pagination exactly

Successful responses contain `logs` and `pageInfo`. When `pageInfo.nextPage` is non-empty:

1. Parse the returned URL.
2. Copy its `/v1/logs` pathname and complete query string exactly into the next call's `path`.
3. Reuse the same top-level credential `environment`.
4. Do not also pass `query`, because replacing parameters can corrupt the opaque continuation.

For example:

```json
{
  "path": "/v1/logs?filter=host%3A%22checkout%22%20error&startTime=2026-08-05T10%3A00%3A00Z&skipToken=opaque-value",
  "environment": "prod"
}
```

An empty `logs` array is not proof that the search is complete. Continue while `pageInfo.nextPage` is non-empty, including through empty intermediate pages. Stop when `nextPage` is empty or when enough evidence has been collected; do not fetch unbounded pages.

## Investigate with bounded evidence

1. Establish the environment and UTC time window.
2. Search for the smallest discriminating signal available, such as a request ID, trace ID, hostname, program, deployment identifier, or exact error fragment.
3. Inspect a small result set before widening the filter or time range.
4. Follow pagination only as far as the investigation requires.
5. Correlate `time`, `message`, `hostname`, `severity`, `program`, and `id` with source and deployment evidence.
6. Separate what the logs directly show from inferred causes.

Logs can contain credentials, authorization headers, session values, email addresses, personal data, and request payloads. Quote only the minimum evidence needed and redact secrets or personal data in responses.

Responses may be truncated at 2,000 lines or 50 KiB. When the truncation notice appears, narrow the query or reduce `pageSize`; continue with `nextPage` only when its complete value is visible. Never treat omitted output as evidence that an event or field is absent.
