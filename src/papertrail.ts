export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type QueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>;

export interface PapertrailService {
  listEnvironments(): Promise<Json>;
  get(
    path: string,
    environment?: string,
    query?: Record<string, QueryValue>,
  ): Promise<Json>;
}

interface PapertrailCredentials {
  apiBaseUrl: string;
  token: string;
}

const LOGS_PATH = "/v1/logs";
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;
const MAX_REDIRECTS = 5;

function environmentVariables(
  env: NodeJS.ProcessEnv,
  suffix: string,
): Map<string, string> {
  const variables = new Map<string, string>();
  const pattern = new RegExp(`^PAPERTRAIL_([A-Z0-9_]+)_${suffix}$`, "i");
  for (const name of Object.keys(env)) {
    const match = pattern.exec(name);
    if (match?.[1]) variables.set(match[1].toLowerCase(), name);
  }
  return variables;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizedApiBaseUrl(value: string, environment: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Papertrail environment ${environment} API base URL must be a valid HTTPS origin`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(`Papertrail environment ${environment} API base URL must use HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(
      `Papertrail environment ${environment} API base URL must not contain credentials`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `Papertrail environment ${environment} API base URL must contain only an HTTPS origin`,
    );
  }
  return url.origin;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatResult(value: Json): string {
  const output = JSON.stringify(value, null, 2);
  const allLines = output.split("\n");
  const totalBytes = Buffer.byteLength(output);
  if (allLines.length <= MAX_OUTPUT_LINES && totalBytes <= MAX_OUTPUT_BYTES) return output;

  const lineLimited = allLines.slice(0, MAX_OUTPUT_LINES).join("\n");
  const encoded = new TextEncoder().encode(lineLimited);
  let end = Math.min(encoded.length, MAX_OUTPUT_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let content: string | undefined;
  while (content === undefined) {
    try {
      content = decoder.decode(encoded.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  const outputLines = content.split("\n").length;
  return `${content}\n\n[Output truncated: ${outputLines} of ${allLines.length} lines (${formatSize(end)} of ${formatSize(totalBytes)}).]`;
}

function validatedLogsPath(path: string): URL {
  const sentinelOrigin = "https://papertrail.invalid";
  if (!path.startsWith("/")) {
    throw new Error("Papertrail API path must begin with /");
  }
  const url = new URL(path, sentinelOrigin);
  if (url.origin !== sentinelOrigin) {
    throw new Error("Papertrail API path must be relative to the configured origin");
  }
  if (url.pathname !== LOGS_PATH) {
    throw new Error(`Papertrail API path must be ${LOGS_PATH}`);
  }
  if (url.hash) {
    throw new Error("Papertrail API path must not contain a fragment");
  }
  return url;
}

export class PapertrailClient implements PapertrailService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;

  constructor(
    options: {
      env?: NodeJS.ProcessEnv;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#env = options.env ?? process.env;
    this.#fetch = options.fetch ?? fetch;
  }

  async listEnvironments(): Promise<Json> {
    const tokenVariables = environmentVariables(this.#env, "API_TOKEN");
    const apiBaseUrlVariables = environmentVariables(this.#env, "API_BASE_URL");
    const candidates = new Set<string>([
      ...tokenVariables.keys(),
      ...apiBaseUrlVariables.keys(),
    ]);
    const environments = [...candidates]
      .filter((environment) => {
        const tokenVariable = tokenVariables.get(environment);
        const apiBaseUrlVariable = apiBaseUrlVariables.get(environment);
        return Boolean(
          text(tokenVariable ? this.#env[tokenVariable] : undefined) &&
            text(apiBaseUrlVariable ? this.#env[apiBaseUrlVariable] : undefined),
        );
      })
      .sort();

    return {
      defaultEnvironment: "prod",
      environments,
    };
  }

  async get(
    path: string,
    environment = "prod",
    query?: Record<string, QueryValue>,
  ): Promise<Json> {
    const url = validatedLogsPath(path);
    for (const [name, rawValue] of Object.entries(query ?? {})) {
      url.searchParams.delete(name);
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) url.searchParams.append(name, String(value));
    }
    return this.request(`${url.pathname}${url.search}`, environment);
  }

  private credentials(environment: string): PapertrailCredentials {
    if (!/^[a-z0-9_]+$/.test(environment)) {
      throw new Error(
        "Papertrail credential environment must contain only lowercase letters, numbers, and underscores",
      );
    }

    const tokenVariables = environmentVariables(this.#env, "API_TOKEN");
    const apiBaseUrlVariables = environmentVariables(this.#env, "API_BASE_URL");
    const tokenVariable = tokenVariables.get(environment);
    const apiBaseUrlVariable = apiBaseUrlVariables.get(environment);
    const token = text(tokenVariable ? this.#env[tokenVariable] : undefined);
    const configuredBaseUrl = text(
      apiBaseUrlVariable ? this.#env[apiBaseUrlVariable] : undefined,
    );

    if (!token) {
      throw new Error(
        `Configure PAPERTRAIL_${environment.toUpperCase()}_API_TOKEN with a SolarWinds Observability API Access token`,
      );
    }
    if (!configuredBaseUrl) {
      throw new Error(
        `Configure PAPERTRAIL_${environment.toUpperCase()}_API_BASE_URL with the environment's regional SolarWinds Observability API origin`,
      );
    }
    return {
      apiBaseUrl: normalizedApiBaseUrl(configuredBaseUrl, environment),
      token,
    };
  }

  private async request(path: string, environment: string): Promise<Json> {
    const { apiBaseUrl, token } = this.credentials(environment);
    const allowedOrigin = new URL(apiBaseUrl).origin;
    let url = new URL(path, apiBaseUrl);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        redirect: "manual",
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (location) {
          if (redirects === MAX_REDIRECTS) {
            throw new Error(`Papertrail API exceeded ${MAX_REDIRECTS} redirects`);
          }
          const nextUrl = new URL(location, url);
          if (nextUrl.origin !== allowedOrigin) {
            throw new Error(
              "Papertrail API refused a redirect outside the configured origin",
            );
          }
          if (nextUrl.pathname !== LOGS_PATH) {
            throw new Error(`Papertrail API refused a redirect outside ${LOGS_PATH}`);
          }
          await response.body?.cancel();
          url = nextUrl;
          continue;
        }
      }

      const raw = await response.text();
      let body: Json = null;
      if (raw) {
        try {
          body = JSON.parse(raw) as Json;
        } catch {
          body = raw;
        }
      }
      if (!response.ok) {
        throw new Error(
          `Papertrail API ${response.status} ${response.statusText}: ${formatResult(body)}`,
        );
      }
      return body;
    }

    throw new Error(`Papertrail API exceeded ${MAX_REDIRECTS} redirects`);
  }
}
