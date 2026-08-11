import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  formatResult,
  PapertrailClient,
  type Json,
  type PapertrailService,
} from "./papertrail.js";

const primitiveQueryValue = z.union([z.string(), z.number(), z.boolean()]);
const queryValue = z.union([primitiveQueryValue, z.array(primitiveQueryValue)]);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

function textResult(value: Json) {
  return {
    content: [{ type: "text" as const, text: formatResult(value) }],
  };
}

export function createServer(service: PapertrailService = new PapertrailClient()): McpServer {
  const server = new McpServer({
    name: "papertrail",
    version: "0.1.0",
  });

  server.registerTool(
    "papertrail_list_environments",
    {
      title: "List Papertrail environments",
      description:
        "List configured Papertrail credential environments without exposing their API tokens or URLs.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => textResult(await service.listEnvironments()),
  );

  server.registerTool(
    "papertrail_get",
    {
      title: "Get Papertrail logs",
      description:
        "Make one authenticated GET request to the migrated Papertrail logs API at /v1/logs. This tool is read-only and may truncate large output.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Site-relative logs API path beginning with /v1/logs. It may include the exact query from pageInfo.nextPage.",
          ),
        environment: z
          .string()
          .default("prod")
          .describe(
            "Credential environment. Use papertrail_list_environments to discover configured values. Defaults to prod.",
          ),
        query: z
          .record(z.string(), queryValue)
          .optional()
          .describe(
            "Optional query parameters. Array values are encoded as repeated parameters.",
          ),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ path, environment, query }) =>
      textResult(await service.get(path, environment, query)),
  );

  return server;
}
