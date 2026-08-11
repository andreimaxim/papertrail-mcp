import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PapertrailService } from "../src/papertrail.js";
import { createServer } from "../src/server.js";

let client: Client | undefined;
let server: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function connect(service: PapertrailService): Promise<Client> {
  server = createServer(service);
  client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

function mockService() {
  const listEnvironments = vi
    .fn<PapertrailService["listEnvironments"]>()
    .mockResolvedValue({ defaultEnvironment: "prod", environments: ["prod"] });
  const get = vi
    .fn<PapertrailService["get"]>()
    .mockResolvedValue({ logs: [{ id: "123" }] });
  return { listEnvironments, get };
}

describe("Papertrail MCP server", () => {
  it("exposes exactly two read-only tools", async () => {
    const connected = await connect(mockService());

    const { tools } = await connected.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "papertrail_list_environments",
      "papertrail_get",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it("routes environment discovery and returns formatted text", async () => {
    const service = mockService();
    const connected = await connect(service);

    const result = await connected.callTool({
      name: "papertrail_list_environments",
      arguments: {},
    });

    expect(service.listEnvironments).toHaveBeenCalledOnce();
    expect(result.content).toEqual([
      {
        type: "text",
        text: '{\n  "defaultEnvironment": "prod",\n  "environments": [\n    "prod"\n  ]\n}',
      },
    ]);
  });

  it("routes log requests and applies the default environment", async () => {
    const service = mockService();
    const connected = await connect(service);

    const result = await connected.callTool({
      name: "papertrail_get",
      arguments: {
        path: "/v1/logs",
        query: {
          filter: "host:checkout error",
          pageSize: 25,
        },
      },
    });

    expect(service.get).toHaveBeenCalledWith("/v1/logs", "prod", {
      filter: "host:checkout error",
      pageSize: 25,
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: '{\n  "logs": [\n    {\n      "id": "123"\n    }\n  ]\n}',
      },
    ]);
  });

  it("rejects invalid query values before calling the service", async () => {
    const service = mockService();
    const connected = await connect(service);

    const result = await connected.callTool({
      name: "papertrail_get",
      arguments: {
        path: "/v1/logs",
        query: {
          filter: { unsupported: true },
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(service.get).not.toHaveBeenCalled();
  });
});
