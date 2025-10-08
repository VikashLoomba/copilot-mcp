import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVscodeApi } from "@/contexts/VscodeApiContext";
import { Messenger } from "vscode-messenger-webview";
import { installFromConfigType } from "../../../src/shared/types/rpcTypes";
import type {
  RegistryKeyValueInput,
  RegistryPackage,
  RegistryServer,
  RegistryServerResponse,
  RegistryTransport,
} from "@/types/registry";

interface RegistryServerCardProps {
  serverResponse: RegistryServerResponse;
}

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({ serverResponse }) => {
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  const [isInstallingLocal, setIsInstallingLocal] = useState(false);
  const [isInstallingRemote, setIsInstallingRemote] = useState(false);
  const server = (serverResponse?.server ?? serverResponse) as RegistryServer | undefined;
  const packages: RegistryPackage[] = Array.isArray(server?.packages) ? server?.packages ?? [] : [];
  const remotes: RegistryTransport[] = Array.isArray(server?.remotes)
    ? (server?.remotes ?? []).filter((r): r is RegistryTransport => typeof r?.url === 'string' && r.url.length > 0)
    : [];
  const hasLocal = packages.length > 0;
  const hasRemote = remotes.length > 0;

  // Prefer stdio package for default selection
  const defaultPackage = packages.find((p) => p?.transport?.type === 'stdio') || packages[0];
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(defaultPackage?.identifier);
  const [selectedRemoteIdx, setSelectedRemoteIdx] = useState<string | undefined>(hasRemote ? '0' : undefined);

  useEffect(() => {
    messenger.start();
  }, [messenger]);

  useEffect(() => {
    if (!packages.find((p) => p.identifier === selectedPackageId)) {
      setSelectedPackageId(defaultPackage?.identifier);
    }
  }, [packages, defaultPackage?.identifier, selectedPackageId]);

  useEffect(() => {
    if (!hasRemote) {
      if (selectedRemoteIdx !== undefined) setSelectedRemoteIdx(undefined);
      return;
    }
    const currentIndex = Number(selectedRemoteIdx ?? '0');
    if (
      Number.isNaN(currentIndex) ||
      currentIndex < 0 ||
      currentIndex >= remotes.length
    ) {
      setSelectedRemoteIdx('0');
    }
  }, [hasRemote, remotes, selectedRemoteIdx]);

  const findSelectedPackage = (): RegistryPackage | undefined =>
    packages.find((p) => p.identifier === selectedPackageId);

  const buildArgsAndInputs = (pkg?: RegistryPackage) => {
    const args: string[] = [];
    const argInputs: Array<{ type: 'promptString'; id: string; description?: string; password?: boolean }> = [];
    let positionalIndex = 0;
    const sanitizeId = (s: string) => s.replace(/^--?/, '').replace(/[^a-zA-Z0-9_]+/g, '_');

    const pushArgList = (list?: Array<any> | null) => {
      if (!Array.isArray(list)) return;
      for (const a of list) {
        const t = a?.type as string | undefined;
        const name = a?.name as string | undefined;
        const value = a?.value as string | undefined;
        const valueHint = (a?.valueHint ?? a?.default) as string | undefined;
        const isSecret = !!a?.isSecret;
        const description = a?.description as string | undefined;

        if (t === 'positional') {
          if (value) {
            args.push(value);
          } else if (valueHint) {
            args.push(valueHint);
          } else {
            const id = `arg_${positionalIndex++}`;
            argInputs.push({ type: 'promptString', id, description: description || 'Provide value', password: !!isSecret });
            args.push(`\${input:${id}}`);
          }
        } else if (t === 'named') {
          if (name) args.push(name);
          if (value) {
            args.push(value);
          } else if (valueHint) {
            args.push(valueHint);
          } else {
            const base = name ? sanitizeId(name) : `arg_${positionalIndex++}`;
            const id = `arg_${base}`;
            argInputs.push({ type: 'promptString', id, description: description || `Value for ${name || 'argument'}`, password: !!isSecret });
            args.push(`\${input:${id}}`);
          }
        }
      }
    };
    pushArgList(pkg?.runtimeArguments ?? undefined);
    pushArgList(pkg?.packageArguments ?? undefined);
    return { args, inputs: argInputs };
  };

  const buildEnvAndInputs = (pkg?: RegistryPackage) => {
    const env: Record<string, string> = {};
    const inputs: Array<{ type: 'promptString'; id: string; description?: string; password?: boolean }>= [];
    if (Array.isArray(pkg?.environmentVariables)) {
      for (const v of pkg!.environmentVariables!) {
        const key = v?.name as string | undefined;
        const isSecret = !!v?.isSecret;
        const def = (v?.value ?? v?.default) as string | undefined;
        const description = v?.description as string | undefined;
        if (!key) continue;
        // If no default, always prompt. Use password for secrets
        if (typeof def === 'string' && def.length > 0) {
          env[key] = def;
        } else {
          inputs.push({ type: 'promptString', id: key, description, password: !!isSecret });
          env[key] = `\${input:${key}}`;
        }
      }
    }
    return { env, inputs };
  };

  const resolveCommand = (pkg?: RegistryPackage): { command?: string; unsupported?: boolean } => {
    if (!pkg) return { command: undefined };
    if (pkg.runtimeHint) return { command: pkg.runtimeHint };
    const type = (pkg.registryType || '').toLowerCase();
    if (type === 'npm') return { command: 'npx' };
    if (type === 'pypi') return { command: 'uvx' };
    if (type === 'oci') return { command: 'docker' };
    // Per requirements, do not auto-map nuget or mcpb without hint
    return { command: undefined, unsupported: true };
  };

  const onInstallLocal = async () => {
    const pkg = findSelectedPackage();
    if (!pkg) return;
    const { command, unsupported } = resolveCommand(pkg);
    if (unsupported || !command) {
      // Basic guard; disable button in UI too
      return;
    }
    setIsInstallingLocal(true);
    try {
      const { args, inputs: argInputs } = buildArgsAndInputs(pkg);
      const { env, inputs: envInputs } = buildEnvAndInputs(pkg);
      // Ensure base package spec is included for commands like npx/uvx
      const baseArgs: string[] = [];
      if (command === 'npx' && pkg.identifier) {
        const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
        // Avoid duplicating if already present in args
        if (!args.some((a) => typeof a === 'string' && a.includes(pkg.identifier!))) {
          baseArgs.push(spec);
        }
      } else if (command === 'uvx' && pkg.identifier) {
        const spec = pkg.version && pkg.version !== 'latest' ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
        if (!args.some((a) => typeof a === 'string' && a.includes(pkg.identifier!))) {
          baseArgs.push(spec);
        }
      }
      const payload = {
        name: pkg.identifier || server?.name || 'server',
        command,
        args: [...baseArgs, ...args],
        env,
        inputs: [...argInputs, ...envInputs],
      };
      await messenger.sendRequest(installFromConfigType, { type: 'extension' }, payload);
    } finally {
      setIsInstallingLocal(false);
    }
  };

  const onInstallRemote = async () => {
    if (!hasRemote) return;
    const idx = Number(selectedRemoteIdx || '0');
    const remote = remotes[idx];
    const pkg = findSelectedPackage();
    if (!remote) return;
    setIsInstallingRemote(true);
    try {
      const headerInputs: Array<{ type: 'promptString'; id: string; description?: string; password?: boolean }> = [];
      const headers: Array<{ name: string; value: string }> = [];
      const sanitizeId = (s: string) => s.replace(/[^a-zA-Z0-9_]+/g, '_');

      const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (Array.isArray(remote.headers)) {
        for (const rawHeader of remote.headers as RegistryKeyValueInput[]) {
          const name = rawHeader.name?.trim();
          if (!name) continue;
          const desc = rawHeader.description || undefined;
          const isSecret = !!rawHeader.isSecret;
          const isRequired = !!rawHeader.isRequired;
          const variableRecord = rawHeader.variables && typeof rawHeader.variables === 'object'
            ? rawHeader.variables
            : {};
          const template = (rawHeader.value ?? rawHeader.default ?? '') as string;
          const placeholders = new Set<string>();

          for (const key of Object.keys(variableRecord)) {
            if (key) placeholders.add(key);
          }

          const placeholderPattern = /\{([^{}]+)\}|\$\{([^{}]+)\}/g;
          let match: RegExpExecArray | null;
          while ((match = placeholderPattern.exec(template)) !== null) {
            const key = (match[1] ?? match[2])?.trim();
            if (key) placeholders.add(key);
          }

          let value = template;
          const ensureInput = (id: string, descriptionText?: string, password?: boolean) => {
            if (!id) return;
            if (!headerInputs.some((i) => i.id === id)) {
              headerInputs.push({ type: 'promptString', id, description: descriptionText, password });
            }
          };

          for (const id of placeholders) {
            const variable = variableRecord[id];
            const descriptionText = variable?.description || desc;
            const password = variable?.isSecret ?? isSecret;
            ensureInput(id, descriptionText, password);
            const escapedId = escapeRegExp(id);
            value = value.replace(new RegExp(`\\{${escapedId}\\}`, 'g'), `\${input:${id}}`);
            value = value.replace(new RegExp(`\\$\\{${escapedId}\\}`, 'g'), `\${input:${id}}`);
          }

          if (!value && placeholders.size > 0) {
            const [first] = Array.from(placeholders);
            if (first) {
              const variable = variableRecord[first];
              ensureInput(first, variable?.description || desc, variable?.isSecret ?? isSecret);
              value = `\${input:${first}}`;
            }
          }

          const needsPrompt = (isSecret && !value?.includes('${input:')) || (!value && (isSecret || isRequired));

          if (needsPrompt) {
            const baseId = sanitizeId(name) || 'value';
            const fallbackId = `header_${baseId}`;
            ensureInput(fallbackId, desc, isSecret);
            value = `\${input:${fallbackId}}`;
          }

          headers.push({ name, value: value ?? '' });
        }
      }

      const payload = {
        name: pkg?.identifier || server?.name || 'server',
        url: remote.url,
        headers: headers.length > 0 ? headers : undefined,
        inputs: headerInputs.length > 0 ? headerInputs : undefined,
      };
      await messenger.sendRequest(installFromConfigType, { type: 'extension' }, payload);
    } finally {
      setIsInstallingRemote(false);
    }
  };

  const title = (findSelectedPackage()?.identifier) || server?.name || 'MCP Server';
  const description = server?.description || '';
  const repoUrl = server?.repository?.url;
  const websiteUrl = server?.websiteUrl;

  const selectedPkg = findSelectedPackage();
  const remoteIndex = Number(selectedRemoteIdx ?? '0');
  const selectedRemote = hasRemote && Number.isInteger(remoteIndex) ? remotes[remoteIndex] : undefined;
  const { unsupported } = resolveCommand(selectedPkg);
  const localDisabled = !hasLocal || !selectedPkg || unsupported;
  const remoteDisabled = !hasRemote || !server?.name || !selectedRemote?.url;

  return (
    <Card className="h-full flex flex-col shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out bg-[var(--vscode-editor-background)] border-[var(--vscode-editorWidget-border)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg break-all">{title}</CardTitle>
        <CardDescription className="text-xs pt-1">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        <div className="text-xs space-x-3">
          {repoUrl && (
            <a className="text-blue-500 hover:underline" href={repoUrl} target="_blank" rel="noreferrer">Repository</a>
          )}
          {websiteUrl && (
            <a className="text-blue-500 hover:underline" href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          )}
        </div>
        {hasLocal && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm text-muted-foreground flex-shrink-0">Package:</span>
            <div className="flex-1 min-w-0">
              <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                <SelectTrigger className="w-full max-w-full truncate" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-4rem)]">
                  {packages.map((p) => (
                    <SelectItem key={p.identifier || ''} value={p.identifier || ''}>
                      {p.identifier} {p.version ? `@${p.version}` : ''} {p.transport?.type ? `• ${p.transport?.type}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {hasRemote && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm text-muted-foreground flex-shrink-0">Remote:</span>
            <div className="flex-1 min-w-0">
              <Select value={selectedRemoteIdx} onValueChange={setSelectedRemoteIdx}>
                <SelectTrigger className="w-full max-w-full truncate" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-4rem)]">
                  {remotes.map((r, i) => (
                    <SelectItem key={`${r.url ?? i}-${i}`} value={String(i)}>
                      {r.type || 'remote'}{r.url ? ` • ${r.url}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 pb-3 border-t space-x-2">
        <Button
          variant={"outline"}
          onClick={onInstallLocal}
          disabled={localDisabled || isInstallingLocal}
          className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isInstallingLocal ? 'Installing…' : 'Install Local'}
        </Button>
        <Button
          variant={"outline"}
          onClick={onInstallRemote}
          disabled={remoteDisabled || isInstallingRemote}
          className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isInstallingRemote ? 'Installing…' : 'Install Remote'}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default RegistryServerCard;
