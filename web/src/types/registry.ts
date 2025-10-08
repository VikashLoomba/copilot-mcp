// Shared types for the Official MCP Registry responses, aligned with registry_api_spec.yaml
export type RegistryInput = {
	description?: string;
	default?: string;
	format?: string;
	isRequired?: boolean;
	isSecret?: boolean;
	value?: string;
	choices?: string[] | null;
};

export type RegistryArgument = {
	type?: string;
	name?: string;
	value?: string;
	valueHint?: string;
	description?: string;
	isRequired?: boolean;
	isSecret?: boolean;
	choices?: string[] | null;
	default?: string;
	format?: string;
	isRepeated?: boolean;
	variables?: Record<string, RegistryInput> | null;
};

export type RegistryKeyValueInput = {
	name?: string;
	value?: string;
	default?: string;
	description?: string;
	isSecret?: boolean;
	isRequired?: boolean;
	format?: string;
	choices?: string[] | null;
	variables?: Record<string, RegistryInput> | null;
};

export type RegistryTransport = {
	type?: string;
	url?: string;
	headers?: RegistryKeyValueInput[] | null;
};

export type RegistryPackage = {
	identifier?: string;
	version?: string;
	registryType?: string;
	runtimeHint?: string;
	runtimeArguments?: RegistryArgument[] | null;
	packageArguments?: RegistryArgument[] | null;
	environmentVariables?: RegistryKeyValueInput[] | null;
	transport?: RegistryTransport | null;
};

export type RegistryServer = {
	name?: string;
	description?: string;
	repository?: { url?: string };
	websiteUrl?: string;
	packages?: RegistryPackage[] | null;
	remotes?: RegistryTransport[] | null;
	version?: string;
};

export type RegistryServerResponse = {
	server?: RegistryServer;
	_meta?: Record<string, unknown>;
};

export type RegistrySearchResponse = {
	servers?: RegistryServerResponse[] | any[];
	metadata?: { nextCursor?: string; next_cursor?: string; count?: number } | null;
};

export type RegistryMetadata = {
	count?: number;
	nextCursor?: string;
};

export function normalizeRegistryInput(input: any): RegistryInput {
	return {
		description: input?.description,
		default: input?.default,
		format: input?.format,
		isRequired: input?.isRequired ?? input?.is_required,
		isSecret: input?.isSecret ?? input?.is_secret,
		value: input?.value,
		choices: Array.isArray(input?.choices) ? input.choices : null,
	};
}

function normalizeInputMap(vars: any): Record<string, RegistryInput> | null {
	if (!vars || typeof vars !== "object") return null;
	return Object.entries(vars).reduce<Record<string, RegistryInput>>((acc, [key, value]) => {
		acc[key] = normalizeRegistryInput(value);
		return acc;
	}, {});
}

export function normalizeRegistryArgument(arg: any): RegistryArgument {
	return {
		type: arg?.type,
		name: arg?.name,
		value: arg?.value,
		valueHint: arg?.valueHint ?? arg?.value_hint,
		description: arg?.description,
		isRequired: arg?.isRequired ?? arg?.is_required,
		isSecret: arg?.isSecret ?? arg?.is_secret,
		choices: Array.isArray(arg?.choices) ? arg.choices : null,
		default: arg?.default,
		format: arg?.format,
		isRepeated: arg?.isRepeated ?? arg?.is_repeated,
		variables: normalizeInputMap(arg?.variables),
	};
}

export function normalizeRegistryKeyValueInput(input: any): RegistryKeyValueInput {
	return {
		name: input?.name,
		value: input?.value,
		default: input?.default,
		description: input?.description,
		isSecret: input?.isSecret ?? input?.is_secret,
		isRequired: input?.isRequired ?? input?.is_required,
		format: input?.format,
		choices: Array.isArray(input?.choices) ? input.choices : null,
		variables: normalizeInputMap(input?.variables),
	};
}

export function normalizeRegistryTransport(transport: any): RegistryTransport {
	if (!transport || typeof transport !== "object") return {};
	return {
		type: transport?.type ?? transport?.transport_type,
		url: transport?.url,
		headers: Array.isArray(transport?.headers)
			? transport.headers.map((header: any) => normalizeRegistryKeyValueInput(header))
			: null,
	};
}

export function normalizeRegistryPackage(pkg: any): RegistryPackage {
	if (!pkg || typeof pkg !== "object") return {};
	return {
		identifier: pkg?.identifier,
		version: pkg?.version,
		registryType: pkg?.registryType ?? pkg?.registry_type,
		runtimeHint: pkg?.runtimeHint ?? pkg?.runtime_hint,
		runtimeArguments: Array.isArray(pkg?.runtimeArguments ?? pkg?.runtime_arguments)
			? (pkg?.runtimeArguments ?? pkg?.runtime_arguments).map((arg: any) => normalizeRegistryArgument(arg))
			: null,
		packageArguments: Array.isArray(pkg?.packageArguments ?? pkg?.package_arguments)
			? (pkg?.packageArguments ?? pkg?.package_arguments).map((arg: any) => normalizeRegistryArgument(arg))
			: null,
		environmentVariables: Array.isArray(pkg?.environmentVariables ?? pkg?.environment_variables)
			? (pkg?.environmentVariables ?? pkg?.environment_variables).map((env: any) => normalizeRegistryKeyValueInput(env))
			: null,
		transport: pkg?.transport ? normalizeRegistryTransport(pkg.transport) : null,
	};
}

export function normalizeRegistryServer(server: any): RegistryServer {
	if (!server || typeof server !== "object") return {};
	return {
		name: server?.name,
		description: server?.description,
		repository: server?.repository,
		websiteUrl: server?.websiteUrl ?? server?.website_url,
		packages: Array.isArray(server?.packages)
			? server.packages.map((pkg: any) => normalizeRegistryPackage(pkg))
			: null,
		remotes: Array.isArray(server?.remotes)
			? server.remotes.map((remote: any) => normalizeRegistryTransport(remote))
			: null,
		version: server?.version,
	};
}

export function normalizeRegistryServerResponse(entry: any): RegistryServerResponse {
	if (!entry || typeof entry !== "object") return { server: undefined, _meta: undefined };
	const rawMeta = (entry as any)._meta;
	if (entry.server) {
		return {
			server: normalizeRegistryServer(entry.server),
			_meta: rawMeta,
		};
	}
	const { _meta, ...rest } = entry;
	return {
		server: normalizeRegistryServer(rest),
		_meta: rawMeta ?? _meta,
	};
}

export function normalizeRegistryMetadata(metadata: any): RegistryMetadata {
	return {
		count: typeof metadata?.count === "number" ? metadata.count : undefined,
		nextCursor: metadata?.nextCursor ?? metadata?.next_cursor,
	};
}
