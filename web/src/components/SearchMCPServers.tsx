import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SearchGitHubServers from './SearchGitHubServers';
import SearchRegistryServers from './SearchRegistryServers';

const SearchMCPServers: React.FC = () => {
  const [provider, setProvider] = React.useState<'registry' | 'github'>('registry');
  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Provider:</span>
        <ToggleGroup
          type="single"
          value={provider}
          onValueChange={(v) => setProvider((v as any) || 'registry')}
          className="gap-2"
        >
          <ToggleGroupItem
            value="registry"
            aria-label="Official MCP Registry"
            className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
          >
            Official MCP Registry
          </ToggleGroupItem>
          <ToggleGroupItem
            value="github"
            aria-label="GitHub"
            className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
          >
            GitHub (AI Assisted)
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {provider === 'registry' ? <SearchRegistryServers /> : <SearchGitHubServers />}
    </div>
  );
};

export default SearchMCPServers;
