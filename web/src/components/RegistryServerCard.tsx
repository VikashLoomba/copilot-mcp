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

type RegistryPackage = {
  registry_type?: string;
  identifier?: string;
  version?: string;
  runtime_hint?: string;
  runtime_arguments?: Array<any> | null;
  package_arguments?: Array<any> | null;
  environment_variables?: Array<any> | null;
  transport?: { type?: string } | null;
};

type RegistryRemote = {
  type?: string;
  url: string;
  headers?: Array<{
    name?: string;
    value?: string;
    description?: string;
    is_secret?: boolean;
    is_required?: boolean;
  }> | null;
};

interface RegistryServerCardProps {
  server: any;
}

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({ server }) => {
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  const [isInstallingLocal, setIsInstallingLocal] = useState(false);
  const [isInstallingRemote, setIsInstallingRemote] = useState(false);
  const packages: RegistryPackage[] = server?.packages || [];
  const remotes: RegistryRemote[] = server?.remotes || [];
  const hasLocal = Array.isArray(packages) && packages.length > 0;
  const hasRemote = Array.isArray(remotes) && remotes.length > 0;

  // Prefer stdio package for default selection
  const defaultPackage = packages.find((p) => p?.transport?.type === 'stdio') || packages[0];
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(defaultPackage?.identifier);
  const [selectedRemoteIdx, setSelectedRemoteIdx] = useState<string | undefined>(hasRemote ? '0' : undefined);

  useEffect(() => {
    messenger.start();
  }, [messenger]);

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
        const valueHint = a?.value_hint as string | undefined;
        const isSecret = !!a?.is_secret;
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
    pushArgList(pkg?.runtime_arguments ?? undefined);
    pushArgList(pkg?.package_arguments ?? undefined);
    return { args, inputs: argInputs };
  };

  const buildEnvAndInputs = (pkg?: RegistryPackage) => {
    const env: Record<string, string> = {};
    const inputs: Array<{ type: 'promptString'; id: string; description?: string; password?: boolean }>= [];
    if (Array.isArray(pkg?.environment_variables)) {
      for (const v of pkg!.environment_variables!) {
        const key = v?.name as string | undefined;
        const isSecret = !!v?.is_secret;
        const def = v?.default as string | undefined;
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
    if (pkg.runtime_hint) return { command: pkg.runtime_hint };
    const type = (pkg.registry_type || '').toLowerCase();
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
      const addInput = (id: string, description?: string, password?: boolean) => {
        // Avoid duplicates
        if (!headerInputs.find((i) => i.id === id)) headerInputs.push({ type: 'promptString', id, description, password });
      };
      const sanitizeId = (s: string) => s.replace(/[^a-zA-Z0-9_]+/g, '_');

      if (Array.isArray(remote.headers)) {
        for (const h of remote.headers) {
          const name = h.name || '';
          let value = h.value || '';
          const desc = h.description || undefined;
          const isSecret = !!h.is_secret;

          // Find placeholders like {var}
          const placeholderRegex = /\{([^}]+)\}/g;
          const matches = [...value.matchAll(placeholderRegex)].map(m => m[1]);
          if (matches.length > 0) {
            for (const id of matches) addInput(id, desc, isSecret);
            // Replace {id} with ${input:id}
            value = value.replace(placeholderRegex, (_, g1) => `\${input:${g1}}`);
          } else if (isSecret || !value) {
            // Secret OR missing value -> prompt
            const base = name ? sanitizeId(name) : 'value';
            const id = `header_${base}`;
            addInput(id, desc, !!isSecret);
            value = `\${input:${id}}`;
          }

          headers.push({ name, value });
        }
      }

      const payload = {
        name: pkg?.identifier || server?.name || 'server',
        url: remote.url,
        headers,
        inputs: headerInputs,
      };
      await messenger.sendRequest(installFromConfigType, { type: 'extension' }, payload);
    } finally {
      setIsInstallingRemote(false);
    }
  };

  const title = (findSelectedPackage()?.identifier) || server?.name || 'MCP Server';
  const description = server?.description || '';
  const repoUrl = server?.repository?.url;
  const websiteUrl = server?.website_url;

  const selectedPkg = findSelectedPackage();
  const { unsupported } = resolveCommand(selectedPkg);
  const localDisabled = !hasLocal || !selectedPkg || unsupported;
  const remoteDisabled = !hasRemote || (!selectedPkg?.identifier && !server?.name);

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
                    <SelectItem key={`${r.url}-${i}`} value={String(i)}>
                      {r.type || 'remote'} • {r.url}
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
