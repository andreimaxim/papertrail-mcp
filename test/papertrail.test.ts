import { describe, expect, it, vi } from "vitest";

import { formatResult, PapertrailClient } from "../src/papertrail.js";

const configuredEnv = {
  PAPERTRAIL_PROD_API_TOKEN: "test-token",
  PAPERTRAIL_PROD_API_BASE_URL: "https://api.na-01.cloud.solarwinds.com",
};

describe("PapertrailClient", () => {
  it("lists only complete credential environments without exposing values", async () => {
    const client = new PapertrailClient({
      env: {
        PAPERTRAIL_PROD_API_TOKEN: "prod-token",
        PAPERTRAIL_PROD_API_BASE_URL: "https://api.na-01.cloud.solarwinds.com",
        papertrail_QA_api_token: "qa-token",
        papertrail_QA_api_base_url: "https://api.eu-01.cloud.solarwinds.com",
        PAPERTRAIL_STAGING_API_TOKEN: "incomplete-token",
        PAPERTRAIL_DEV_API_BASE_URL: "https://api.na-02.cloud.solarwinds.com",
      },
    });

    await expect(client.listEnvironments()).resolves.toEqual({
      defaultEnvironment: "prod",
      environments: ["prod", "qa"],
    });
  });

  it("makes an authenticated GET and replaces repeated query parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ logs: [{ id: "123" }] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new PapertrailClient({ env: configuredEnv, fetch: fetchMock });

    await expect(
      client.get("/v1/logs?filter=old&skipToken=opaque", "prod", {
        filter: "host:checkout error",
        severity: ["error", "critical"],
        pageSize: 100,
        enabled: true,
      }),
    ).resolves.toEqual({ logs: [{ id: "123" }] });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [request, options] = fetchMock.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://api.na-01.cloud.solarwinds.com");
    expect(url.pathname).toBe("/v1/logs");
    expect(url.searchParams.get("filter")).toBe("host:checkout error");
    expect(url.searchParams.get("skipToken")).toBe("opaque");
    expect(url.searchParams.getAll("severity")).toEqual(["error", "critical"]);
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.get("enabled")).toBe("true");
    expect(options).toEqual({
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-token",
      },
      redirect: "manual",
    });
  });

  it.each([
    ["v1/logs", "must begin with /"],
    ["//example.com/v1/logs", "must be relative to the configured origin"],
    ["/v1/metrics", "must be /v1/logs"],
    ["/v1/logs#fragment", "must not contain a fragment"],
  ])("rejects unsafe logs path %s", async (path, message) => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new PapertrailClient({ env: configuredEnv, fetch: fetchMock });

    await expect(client.get(path)).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a valid environment name and a complete profile", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      new PapertrailClient({ env: configuredEnv, fetch: fetchMock }).get(
        "/v1/logs",
        "Prod",
      ),
    ).rejects.toThrow("only lowercase letters, numbers, and underscores");

    await expect(
      new PapertrailClient({ env: {}, fetch: fetchMock }).get("/v1/logs"),
    ).rejects.toThrow("Configure PAPERTRAIL_PROD_API_TOKEN");

    await expect(
      new PapertrailClient({
        env: { PAPERTRAIL_PROD_API_TOKEN: "token" },
        fetch: fetchMock,
      }).get("/v1/logs"),
    ).rejects.toThrow("Configure PAPERTRAIL_PROD_API_BASE_URL");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["not a URL", "must be a valid HTTPS origin"],
    ["http://api.example.com", "must use HTTPS"],
    ["https://user:password@api.example.com", "must not contain credentials"],
    ["https://api.example.com/v1", "must contain only an HTTPS origin"],
  ])("rejects unsafe API base URL %s", async (apiBaseUrl, message) => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new PapertrailClient({
      env: {
        PAPERTRAIL_PROD_API_TOKEN: "token",
        PAPERTRAIL_PROD_API_BASE_URL: apiBaseUrl,
      },
      fetch: fetchMock,
    });

    await expect(client.get("/v1/logs")).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows same-origin redirects to the logs path", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/v1/logs?skipToken=next" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ logs: [] })));
    const client = new PapertrailClient({ env: configuredEnv, fetch: fetchMock });

    await expect(client.get("/v1/logs")).resolves.toEqual({ logs: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      "https://api.na-01.cloud.solarwinds.com/v1/logs?skipToken=next",
    );
  });

  it.each([
    [
      "https://example.com/v1/logs",
      "refused a redirect outside the configured origin",
    ],
    ["/v1/metrics", "refused a redirect outside /v1/logs"],
  ])("rejects unsafe redirect %s", async (location, message) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: location },
      }),
    );
    const client = new PapertrailClient({ env: configuredEnv, fetch: fetchMock });

    await expect(client.get("/v1/logs")).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports Papertrail API errors with their response body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "denied" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    const client = new PapertrailClient({ env: configuredEnv, fetch: fetchMock });

    await expect(client.get("/v1/logs")).rejects.toThrow(
      'Papertrail API 401 Unauthorized: {\n  "message": "denied"\n}',
    );
  });
});

describe("formatResult", () => {
  it("truncates large output without splitting UTF-8", () => {
    const result = formatResult({ message: "🙂".repeat(30_000) });

    expect(result).toContain("[Output truncated:");
    expect(result).not.toContain("�");
    expect(Buffer.byteLength(result)).toBeLessThan(52 * 1024);
  });
});
