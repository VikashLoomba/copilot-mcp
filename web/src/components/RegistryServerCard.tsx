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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useVscodeApi } from "@/contexts/VscodeApiContext";
import { Messenger } from "vscode-messenger-webview";
import {
  installClaudeFromConfigType,
  installFromConfigType,
  type InstallMode,
} from "../../../src/shared/types/rpcTypes";
import type {
  RegistryPackage,
  RegistryServer,
  RegistryServerResponse,
  RegistryTransport,
} from "@/types/registry";
import {
  ProgramTarget,
  buildPackageInstall,
  buildRemoteInstall,
  copyClaudeCommand,
  createClaudeAddJsonCommand,
} from "@/utils/registryInstall";

const CLAUDE_DOCS_URL =
  "https://github.com/vikashloomba/copilot-mcp/blob/main/mcp.md#add-mcp-servers-from-json-configuration";

type InstallErrorState = {
  message: string;
  missingCli?: boolean;
  cliCommand?: string;
};

interface RegistryServerCardProps {
  serverResponse: RegistryServerResponse;
}

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({ serverResponse }) => {
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  const server = (serverResponse?.server ?? serverResponse) as RegistryServer | undefined;
  const packages: RegistryPackage[] = Array.isArray(server?.packages) ? server.packages ?? [] : [];
  const remotes: RegistryTransport[] = Array.isArray(server?.remotes)
    ? (server.remotes ?? []).filter((remote): remote is RegistryTransport => Boolean(remote?.url))
    : [];
  const hasLocal = packages.length > 0;
  const hasRemote = remotes.length > 0;

  const defaultPackage = packages.find((pkg) => pkg?.transport?.type === 'stdio') || packages[0];
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(defaultPackage?.identifier);
  const [selectedRemoteIdx, setSelectedRemoteIdx] = useState<string | undefined>(hasRemote ? '0' : undefined);
  const [programTarget, setProgramTarget] = useState<ProgramTarget>('vscode');
  const [installMode, setInstallMode] = useState<InstallMode>(hasLocal ? 'package' : 'remote');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<InstallErrorState | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [lastClaudeCommand, setLastClaudeCommand] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    messenger.start();
  }, [messenger]);

  useEffect(() => {
    if (!packages.find((pkg) => pkg.identifier === selectedPackageId)) {
      setSelectedPackageId(defaultPackage?.identifier);
    }
  }, [packages, defaultPackage?.identifier, selectedPackageId]);

  useEffect(() => {
    if (!hasRemote) {
      if (selectedRemoteIdx !== undefined) setSelectedRemoteIdx(undefined);
      return;
    }
    const currentIndex = Number(selectedRemoteIdx ?? '0');
    if (Number.isNaN(currentIndex) || currentIndex < 0 || currentIndex >= remotes.length) {
      setSelectedRemoteIdx('0');
    }
  }, [hasRemote, remotes, selectedRemoteIdx]);

  useEffect(() => {
    if (installMode === 'package' && !hasLocal && hasRemote) {
      setInstallMode('remote');
    } else if (installMode === 'remote' && !hasRemote && hasLocal) {
      setInstallMode('package');
    }
  }, [installMode, hasLocal, hasRemote]);

  useEffect(() => {
    setInstallError(null);
    setInstallStatus(null);
    setCopyFeedback('idle');
  }, [installMode, programTarget, selectedPackageId, selectedRemoteIdx]);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.identifier === selectedPackageId),
    [packages, selectedPackageId],
  );

  const selectedRemote = useMemo(() => {
    if (!hasRemote || selectedRemoteIdx === undefined) return undefined;
    const index = Number(selectedRemoteIdx);
    if (Number.isNaN(index) || index < 0 || index >= remotes.length) return undefined;
    return remotes[index];
  }, [hasRemote, remotes, selectedRemoteIdx]);

  const packageBuild = useMemo(() => buildPackageInstall(server, selectedPackage), [server, selectedPackage]);
  const remoteBuild = useMemo(() => buildRemoteInstall(server, selectedRemote), [server, selectedRemote]);
  const activeBuild = installMode === 'package' ? packageBuild : remoteBuild;

  const title = selectedPackage?.identifier || server?.name || 'MCP Server';
  const description = server?.description || '';
  const repoUrl = server?.repository?.url;
  const websiteUrl = server?.websiteUrl;

  const programLabel = programTarget === 'vscode' ? 'VS Code' : 'Claude Code';
  const buttonLabel = isInstalling
    ? `Installing in ${programLabel}…`
    : installMode === 'package'
      ? `Install Package in ${programLabel}`
      : programTarget === 'claude'
        ? `Add Remote to ${programLabel}`
        : `Install Remote in ${programLabel}`;

  const isInstallDisabled =
    isInstalling ||
    !activeBuild.payload ||
    Boolean(activeBuild.unavailableReason) ||
    (installMode === 'package' && !selectedPackage) ||
    (installMode === 'remote' && (!hasRemote || !selectedRemote)) ||
    (programTarget === 'claude' && !activeBuild.transport);

  const onInstall = async () => {
    if (!activeBuild.payload) return;

    setIsInstalling(true);
    setInstallError(null);
    setInstallStatus(null);
    setCopyFeedback('idle');
    setLastClaudeCommand(null);

    try {
      if (programTarget === 'vscode') {
        const success = await messenger.sendRequest(installFromConfigType, { type: 'extension' }, activeBuild.payload);
        if (success) {
          setInstallStatus('VS Code is opening the MCP install prompt.');
        } else {
          setInstallError({ message: 'Unable to start the VS Code install flow. Please try again.' });
        }
        return;
      }

      if (!activeBuild.transport) {
        setInstallError({ message: 'This install mode is not supported for Claude Code yet.' });
        return;
      }

      const response = await messenger.sendRequest(installClaudeFromConfigType, { type: 'extension' }, {
        ...activeBuild.payload,
        transport: activeBuild.transport,
        mode: installMode,
      });

      if (response.canceled) {
        setInstallStatus('Claude installation canceled.');
        return;
      }

      if (!response.cliAvailable) {
        const command = createClaudeAddJsonCommand(
          activeBuild.payload.name,
          activeBuild.transport,
          activeBuild.payload,
        );
        setLastClaudeCommand(command);
        setInstallError({
          message: response.errorMessage || 'Claude CLI was not found on your PATH.',
          missingCli: true,
          cliCommand: command,
        });
        return;
      }

      if (!response.success) {
        setInstallError({
          message: response.errorMessage || 'Claude CLI failed to add this MCP server.',
        });
        return;
      }

      setInstallStatus('Claude CLI added this MCP server successfully.');
    } catch (error) {
      console.error('Error during install', error);
      setInstallError({
        message: error instanceof Error ? error.message : 'Unexpected error during install.',
      });
    } finally {
      setIsInstalling(false);
    }
  };

  const onCopyCommand = async () => {
    const commandToCopy = lastClaudeCommand
      ?? (activeBuild.payload && activeBuild.transport
        ? createClaudeAddJsonCommand(activeBuild.payload.name, activeBuild.transport, activeBuild.payload)
        : null);

    if (!commandToCopy) {
      setCopyFeedback('error');
      return;
    }

    const copied = await copyClaudeCommand(commandToCopy);
    setCopyFeedback(copied ? 'copied' : 'error');
  };

  const modeSelectorVisible = hasLocal && hasRemote;

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
        <div className="flex items-center gap-2 w-full">
          <span className="text-sm text-muted-foreground flex-shrink-0">Install to:</span>
          <ToggleGroup
            type="single"
            value={programTarget}
            onValueChange={(value) => {
              if (value === 'vscode' || value === 'claude') {
                setProgramTarget(value);
              }
            }}
            className="gap-2"
          >
            <ToggleGroupItem
              value="vscode"
              aria-label="Install in VS Code"
              className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
            >
              VS Code
            </ToggleGroupItem>
            <ToggleGroupItem
              value="claude"
              aria-label="Install in Claude Code"
              className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
            >
              Claude Code
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {modeSelectorVisible && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm text-muted-foreground flex-shrink-0">Mode:</span>
            <ToggleGroup
              type="single"
              value={installMode}
              onValueChange={(value) => {
                if (value === 'package' || value === 'remote') {
                  setInstallMode(value);
                }
              }}
              className="gap-2"
            >
              <ToggleGroupItem
                value="package"
                aria-label="Install package"
                className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
              >
                Package
              </ToggleGroupItem>
              <ToggleGroupItem
                value="remote"
                aria-label="Install remote endpoint"
                className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
              >
                Remote
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        {installMode === 'package' && hasLocal && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm text-muted-foreground flex-shrink-0">Package:</span>
            <div className="flex-1 min-w-0">
              <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                <SelectTrigger className="w-full max-w-full truncate" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-4rem)]">
                  {packages.map((pkg) => (
                    <SelectItem key={pkg.identifier || ''} value={pkg.identifier || ''}>
                      {pkg.identifier} {pkg.version ? `@${pkg.version}` : ''} {pkg.transport?.type ? `• ${pkg.transport?.type}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {installMode === 'remote' && hasRemote && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm text-muted-foreground flex-shrink-0">Remote:</span>
            <div className="flex-1 min-w-0">
              <Select value={selectedRemoteIdx} onValueChange={setSelectedRemoteIdx}>
                <SelectTrigger className="w-full max-w-full truncate" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-4rem)]">
                  {remotes.map((remote, index) => (
                    <SelectItem key={`${remote.url ?? index}-${index}`} value={String(index)}>
                      {remote.type || 'remote'}{remote.url ? ` • ${remote.url}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {activeBuild.unavailableReason && (
          <div className="text-xs text-[var(--vscode-errorForeground)]">{activeBuild.unavailableReason}</div>
        )}
        {installStatus && !installError && (
          <div className="text-xs text-[var(--vscode-editor-foreground)]">{installStatus}</div>
        )}
        {installError && (
          <div className="space-y-2 text-xs text-[var(--vscode-errorForeground)]">
            <div>{installError.message}</div>
            {installError.missingCli && (
              <div className="space-y-2">
                <div>
                  Install the Claude CLI and try again. See the{' '}
                  <a
                    href={CLAUDE_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    installation guide
                  </a>
                  .
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onCopyCommand}
                    className="bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
                  >
                    Copy CLI Command
                  </Button>
                  {copyFeedback === 'copied' && <span className="text-[var(--vscode-editor-foreground)]">Copied!</span>}
                  {copyFeedback === 'error' && (
                    <span className="text-[var(--vscode-errorForeground)]">Unable to copy. Copy manually from the docs.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 pb-3 border-t">
        <Button
          variant="outline"
          onClick={onInstall}
          disabled={isInstallDisabled}
          className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonLabel}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default RegistryServerCard;
