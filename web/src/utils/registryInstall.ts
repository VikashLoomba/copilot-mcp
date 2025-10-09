import type {
  InstallCommandPayload,
  InstallInput,
  InstallMode,
  InstallTransport,
} from "../../../src/shared/types/rpcTypes";
import type {
  RegistryArgument,
  RegistryPackage,
  RegistryServer,
  RegistryTransport,
} from "@/types/registry";

export type ProgramTarget = "vscode" | "claude";

export interface RegistryInstallBuildResult {
  payload?: InstallCommandPayload;
  missingInputs: InstallInput[];
  unavailableReason?: string;
  transport?: InstallTransport;
  mode: InstallMode;
}

const PLACEHOLDER_REGEX = /\\?\${input:([^}]+)}/g;

const sanitizeId = (value: string) => value.replace(/^--?/, "").replace(/[^a-zA-Z0-9_]+/g, "_");

function replacePlaceholders(value: string, resolver: (id: string) => string): string {
  return value.replace(PLACEHOLDER_REGEX, (_, rawId) => {
    const id = String(rawId ?? "").trim();
    if (!id) {
      return "";
    }
    return resolver(id);
  });
}

function applyPlaceholderResolver(
  payload: InstallCommandPayload,
  resolver: (id: string) => string,
): InstallCommandPayload {
  const mappedArgs = payload.args?.map((arg) => replacePlaceholders(arg, resolver));
  const mappedEnvEntries = payload.env ? Object.entries(payload.env) : [];
  const mappedEnv = mappedEnvEntries.length
    ? mappedEnvEntries.reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = replacePlaceholders(value, resolver);
        return acc;
      }, {})
    : undefined;
  const mappedHeaders = payload.headers?.map((header) => ({
    name: header.name,
    value: header.value !== undefined ? replacePlaceholders(header.value, resolver) : header.value,
  }));

  return {
    ...payload,
    args: mappedArgs,
    env: mappedEnv,
    headers: mappedHeaders,
  };
}

function buildClaudeConfig(
  payload: InstallCommandPayload,
  transport: InstallTransport,
): Record<string, unknown> {
  const config: Record<string, unknown> = { type: transport };

  if (transport === "stdio") {
    if (payload.command) {
      config.command = payload.command;
    }
    if (payload.args && payload.args.length > 0) {
      config.args = payload.args;
    }
    if (payload.env && Object.keys(payload.env).length > 0) {
      config.env = payload.env;
    }
  } else {
    if (payload.url) {
      config.url = payload.url;
    }
    if (payload.headers && payload.headers.length > 0) {
      const headerMap = payload.headers.reduce<Record<string, string>>((acc, header) => {
        if (header.name) {
          acc[header.name] = header.value ?? "";
        }
        return acc;
      }, {});
      if (Object.keys(headerMap).length > 0) {
        config.headers = headerMap;
      }
    }
  }

  return config;
}

function collectArgumentInputs(pkg: RegistryPackage | undefined) {
  const args: string[] = [];
  const inputs: InstallInput[] = [];
  let positionalIndex = 0;

  const pushArgList = (list?: RegistryArgument[] | null) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const type = entry?.type;
      const name = entry?.name;
      const value = entry?.value;
      const valueHint = entry?.valueHint ?? entry?.default;
      const isSecret = Boolean(entry?.isSecret);
      const description = entry?.description;

      if (type === "positional") {
        if (value) {
          args.push(value);
        } else if (valueHint) {
          args.push(valueHint);
        } else {
          const id = `arg_${positionalIndex++}`;
          inputs.push({ type: "promptString", id, description: description || "Provide value", password: isSecret });
          args.push(`\\${input:${id}}`);
        }
      } else if (type === "named") {
        if (name) {
          args.push(name);
        }
        if (value) {
          args.push(value);
        } else if (valueHint) {
          args.push(valueHint);
        } else {
          const base = name ? sanitizeId(name) : `arg_${positionalIndex++}`;
          const id = `arg_${base}`;
          inputs.push({
            type: "promptString",
            id,
            description: description || `Value for ${name || "argument"}`,
            password: isSecret,
          });
          args.push(`\\${input:${id}}`);
        }
      }
    }
  };

  pushArgList(pkg?.runtimeArguments ?? undefined);
  pushArgList(pkg?.packageArguments ?? undefined);

  return { args, inputs };
}

function collectEnvInputs(pkg: RegistryPackage | undefined) {
  const env: Record<string, string> = {};
  const inputs: InstallInput[] = [];

  if (Array.isArray(pkg?.environmentVariables)) {
    for (const variable of pkg!.environmentVariables!) {
      const key = variable?.name?.trim();
      if (!key) continue;

      const def = (variable?.value ?? variable?.default) || "";
      const description = variable?.description || undefined;
      const isSecret = Boolean(variable?.isSecret);

      if (def) {
        env[key] = def;
      } else {
        inputs.push({ type: "promptString", id: key, description, password: isSecret });
        env[key] = `\\${input:${key}}`;
      }
    }
  }

  return { env, inputs };
}

function resolveRuntimeCommand(pkg: RegistryPackage | undefined) {
  if (!pkg) {
    return { unsupported: true as const };
  }
  if (pkg.runtimeHint) {
    return { command: pkg.runtimeHint };
  }
  const type = (pkg.registryType || "").toLowerCase();
  if (type === "npm") {
    return { command: "npx" };
  }
  if (type === "pypi") {
    return { command: "uvx" };
  }
  if (type === "oci") {
    return { command: "docker" };
  }
  return { unsupported: true as const };
}

function ensureBaseArgs(command: string | undefined, pkg: RegistryPackage | undefined, args: string[]): string[] {
  if (!command || !pkg?.identifier) {
    return args;
  }

  if (command === "npx") {
    const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
    if (!args.some((arg) => typeof arg === "string" && arg.includes(pkg.identifier!))) {
      return [spec, ...args];
    }
    return args;
  }

  if (command === "uvx") {
    const spec = pkg.version && pkg.version !== "latest" ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
    if (!args.some((arg) => typeof arg === "string" && arg.includes(pkg.identifier!))) {
      return [spec, ...args];
    }
    return args;
  }

  return args;
}

export function buildPackageInstall(
  server: RegistryServer | undefined,
  pkg: RegistryPackage | undefined,
): RegistryInstallBuildResult {
  if (!pkg) {
    return {
      mode: "package",
      missingInputs: [],
      unavailableReason: "No package available",
    };
  }

  const { command, unsupported } = resolveRuntimeCommand(pkg);
  if (!command || unsupported) {
    return {
      mode: "package",
      missingInputs: [],
      unavailableReason: "Package is missing a supported runtime command",
    };
  }

  const { args, inputs: argInputs } = collectArgumentInputs(pkg);
  const { env, inputs: envInputs } = collectEnvInputs(pkg);
  const combinedInputs = [...argInputs, ...envInputs];
  const argsWithBase = ensureBaseArgs(command, pkg, args);

  const payload: InstallCommandPayload = {
    name: pkg.identifier || server?.name || "server",
    command,
    args: argsWithBase.length > 0 ? argsWithBase : undefined,
    env: env && Object.keys(env).length > 0 ? env : undefined,
    inputs: combinedInputs.length > 0 ? combinedInputs : undefined,
  };

  return {
    mode: "package",
    payload,
    missingInputs: combinedInputs,
    transport: "stdio",
  };
}

function collectHeaderInputs(remote: RegistryTransport | undefined) {
  const inputs: InstallInput[] = [];
  const headers: Array<{ name: string; value: string }> = [];

  if (!remote?.headers || !Array.isArray(remote.headers)) {
    return { inputs, headers };
  }

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const rawHeader of remote.headers) {
    const name = rawHeader?.name?.trim();
    if (!name) continue;

    const description = rawHeader?.description || undefined;
    const isSecret = Boolean(rawHeader?.isSecret);
    const isRequired = Boolean(rawHeader?.isRequired);
    const template = (rawHeader?.value ?? rawHeader?.default ?? "") as string;
    const variables = rawHeader?.variables && typeof rawHeader.variables === "object" ? rawHeader.variables : undefined;

    const placeholders = new Set<string>();
    if (variables) {
      for (const key of Object.keys(variables)) {
        if (key) {
          placeholders.add(key);
        }
      }
    }

    const placeholderPattern = /\{([^{}]+)\}|\$\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = placeholderPattern.exec(template)) !== null) {
      const key = (match[1] ?? match[2])?.trim();
      if (key) {
        placeholders.add(key);
      }
    }

    let value = template;
    const ensureInput = (id: string, descriptionText?: string, password?: boolean) => {
      if (!id) return;
      if (!inputs.some((input) => input.id === id)) {
        inputs.push({ type: "promptString", id, description: descriptionText, password });
      }
    };

    for (const id of placeholders) {
      const variable = variables?.[id];
      const descriptionText = variable?.description || description;
      const password = variable?.isSecret ?? isSecret;
      ensureInput(id, descriptionText, password);
      const escapedId = escapeRegExp(id);
      value = value.replace(new RegExp(`\\{${escapedId}\\}`, "g"), `\\${input:${id}}`);
      value = value.replace(new RegExp(`\\$\\{${escapedId}\\}`, "g"), `\\${input:${id}}`);
    }

    if (!value && placeholders.size > 0) {
      const [firstPlaceholder] = Array.from(placeholders);
      if (firstPlaceholder) {
        const variable = variables?.[firstPlaceholder];
        ensureInput(firstPlaceholder, variable?.description || description, variable?.isSecret ?? isSecret);
        value = `\\${input:${firstPlaceholder}}`;
      }
    }

    const needsPrompt =
      (isSecret && !value.includes("\\${input:")) || (!value && (isSecret || isRequired));

    if (needsPrompt) {
      const baseId = sanitizeId(name) || "value";
      const fallbackId = `header_${baseId}`;
      ensureInput(fallbackId, description, isSecret);
      value = `\\${input:${fallbackId}}`;
    }

    headers.push({ name, value: value ?? "" });
  }

  return { inputs, headers };
}

export function buildRemoteInstall(
  server: RegistryServer | undefined,
  remote: RegistryTransport | undefined,
): RegistryInstallBuildResult {
  if (!remote) {
    return {
      mode: "remote",
      missingInputs: [],
      unavailableReason: "No remote endpoint available",
    };
  }

  const url = remote.url?.trim();
  if (!url) {
    return {
      mode: "remote",
      missingInputs: [],
      unavailableReason: "Remote endpoint is missing a URL",
    };
  }

  const type = (remote.type || "http").toLowerCase();
  if (type && type !== "http" && type !== "sse") {
    return {
      mode: "remote",
      missingInputs: [],
      unavailableReason: `Remote transport '${remote.type}' is not supported`,
    };
  }

  const transport: InstallTransport = type === "sse" ? "sse" : "http";
  const { inputs, headers } = collectHeaderInputs(remote);

  const payload: InstallCommandPayload = {
    name: server?.name || "server",
    url,
    headers: headers.length > 0 ? headers : undefined,
    inputs: inputs.length > 0 ? inputs : undefined,
  };

  return {
    mode: "remote",
    payload,
    missingInputs: inputs,
    transport,
  };
}

export function createClaudeAddJsonCommand(
  name: string,
  transport: InstallTransport,
  payload: InstallCommandPayload,
): string {
  const substituted = applyPlaceholderResolver(payload, (id) => `<${id}>`);
  const config = buildClaudeConfig(substituted, transport);
  const json = JSON.stringify(config);
  const escapedJson = json.replace(/'/g, "'\"'\"'");
  const needsQuoting = /\s/.test(name);
  const nameArg = needsQuoting ? JSON.stringify(name) : name;
  return `claude mcp add-json ${nameArg} '${escapedJson}'`;
}

export async function copyClaudeCommand(command: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(command);
      return true;
    }
  } catch (error) {
    console.warn("Failed to copy Claude command", error);
    return false;
  }
  return false;
}

export function substitutePlaceholdersForValues(
  payload: InstallCommandPayload,
  resolver: (id: string) => string,
): InstallCommandPayload {
  return applyPlaceholderResolver(payload, resolver);
}

export { PLACEHOLDER_REGEX as registryInstallPlaceholderRegex };
