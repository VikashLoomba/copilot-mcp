import React, { useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useDebounce } from '@/hooks/useDebounce';
import { useVscodeApi } from '@/contexts/VscodeApiContext';
import { Messenger } from 'vscode-messenger-webview';
import {
  skillsGetAgentsType,
  skillsSearchType,
  type SkillAgentOptionDto,
  type SkillsGetAgentsResponse,
  type SkillsInstallScope,
  type SkillsSearchItemDto,
} from '../../../src/shared/types/rpcTypes';
import SkillSearchCard from './SkillSearchCard';

const ITEMS_PER_PAGE = 10;
type AgentId = SkillAgentOptionDto['id'];

const SearchSkills: React.FC = () => {
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce<string>(searchTerm, 400);
  const [results, setResults] = useState<SkillsSearchItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [installScope, setInstallScope] = useState<SkillsInstallScope>('project');
  const [installAllAgents, setInstallAllAgents] = useState(false);
  const [showInstallOptions, setShowInstallOptions] = useState(false);
  const [agents, setAgents] = useState<SkillAgentOptionDto[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([]);
  const [isAgentsLoading, setIsAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    messenger.start();
  }, [messenger]);

  const compatibleAgents = useMemo(
    () => (installScope === 'global' ? agents.filter((agent) => agent.supportsGlobal) : agents),
    [agents, installScope],
  );
  const detectedCompatibleAgents = useMemo(
    () => compatibleAgents.filter((agent) => agent.detected),
    [compatibleAgents],
  );

  useEffect(() => {
    const loadAgents = async () => {
      setIsAgentsLoading(true);
      setAgentsError(null);
      try {
        const response = (await messenger.sendRequest(skillsGetAgentsType, { type: 'extension' })) as SkillsGetAgentsResponse;
        const list = Array.isArray(response?.agents) ? response.agents : [];
        const detected = Array.isArray(response?.detectedAgents) ? response.detectedAgents : [];

        setAgents(list);
        setSelectedAgents(() => {
          const detectedValid = detected.filter((agent) => list.some((entry) => entry.id === agent));
          return detectedValid;
        });
      } catch (agentLoadError) {
        console.error(agentLoadError);
        setAgentsError(agentLoadError instanceof Error ? agentLoadError.message : 'Failed to load agents');
      } finally {
        setIsAgentsLoading(false);
      }
    };

    void loadAgents();
  }, [messenger]);

  useEffect(() => {
    if (detectedCompatibleAgents.length === 0) {
      setSelectedAgents([]);
      return;
    }

    setSelectedAgents((previous) => {
      const detectedIds = new Set(detectedCompatibleAgents.map((agent) => agent.id));
      const filtered = previous.filter((agent) => detectedIds.has(agent));
      if (filtered.length > 0) {
        return filtered;
      }

      return detectedCompatibleAgents.map((agent) => agent.id);
    });
  }, [detectedCompatibleAgents]);

  const performSearch = async (page: number, term: string = debouncedSearchTerm) => {
    if (!term.trim()) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      setHasMore(false);
      setCurrentPage(1);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await messenger.sendRequest(skillsSearchType, { type: 'extension' }, {
        query: term.trim(),
        page,
        pageSize: ITEMS_PER_PAGE,
      });

      setResults(Array.isArray(response?.items) ? response.items : []);
      setHasMore(Boolean(response?.hasMore));
      setCurrentPage(response?.page ?? page);
    } catch (searchError) {
      console.error(searchError);
      setError(searchError instanceof Error ? searchError.message : 'Search failed');
      setResults([]);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setHasMore(false);
    void performSearch(1, debouncedSearchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]);

  const toggleSelectedAgent = (agentId: AgentId, checked: boolean) => {
    setSelectedAgents((previous) => {
      if (checked) {
        if (previous.includes(agentId)) {
          return previous;
        }
        return [...previous, agentId];
      }
      return previous.filter((value) => value !== agentId);
    });
  };

  const showNoResults = !isLoading && !error && debouncedSearchTerm && results.length === 0;
  const canGoPrevious = !isLoading && currentPage > 1;
  const canGoNext = !isLoading && hasMore;
  const hasDetectedCompatibleAgents = detectedCompatibleAgents.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Search skills.sh..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="flex-1"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowInstallOptions((current) => !current)}
          aria-label={showInstallOptions ? 'Hide install options' : 'Show install options'}
          title={showInstallOptions ? 'Hide install options' : 'Show install options'}
        >
          <Settings2 className="size-4" />
        </Button>
      </div>

      {showInstallOptions && (
        <div className="rounded border border-[var(--vscode-editorWidget-border)] p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Install scope:</span>
            <ToggleGroup
              type="single"
              value={installScope}
              onValueChange={(value) => {
                if (value === 'project' || value === 'global') {
                  setInstallScope(value);
                }
              }}
              className="gap-2"
            >
              <ToggleGroupItem
                value="project"
                aria-label="Project scope"
                className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
              >
                Project
              </ToggleGroupItem>
              <ToggleGroupItem
                value="global"
                aria-label="Global scope"
                className="text-xs px-2 py-1 rounded border border-transparent data-[state=on]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=on]:text-[var(--vscode-list-activeSelectionForeground)] data-[state=on]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus-visible:ring-0 ring-0"
              >
                Global
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="skills-install-all-agents"
              checked={installAllAgents}
              onCheckedChange={(value) => setInstallAllAgents(value === true)}
            />
            <label htmlFor="skills-install-all-agents" className="text-sm cursor-pointer">
              Install to all detected agents
            </label>
          </div>

          {isAgentsLoading && <p className="text-xs text-muted-foreground">Loading agents...</p>}
          {agentsError && <p className="text-xs text-red-500">Unable to load agents: {agentsError}</p>}

          {!isAgentsLoading && !installAllAgents && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Choose target agents:</p>
              {hasDetectedCompatibleAgents ? (
                <div className="max-h-44 overflow-y-auto pr-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {detectedCompatibleAgents.map((agent) => {
                      const checked = selectedAgents.includes(agent.id);
                      const id = `skill-agent-${agent.id}`;
                      return (
                        <label
                          key={agent.id}
                          htmlFor={id}
                          className="flex items-center gap-2 rounded border border-[var(--vscode-editorWidget-border)] px-2 py-1.5 text-xs cursor-pointer"
                        >
                          <Checkbox
                            id={id}
                            checked={checked}
                            onCheckedChange={(value) => toggleSelectedAgent(agent.id, value === true)}
                          />
                          <span className="flex-1">{agent.displayName}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No detected agents are available for {installScope} installs.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && <p>Loading...</p>}
      {error && <p className="text-red-500">Error: {error}</p>}
      {showNoResults && <p>No skills found for "{debouncedSearchTerm}".</p>}

      {!isLoading && !error && results.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4">
            {results.map((item) => (
              <SkillSearchCard
                key={`${item.id}-${item.name}`}
                messenger={messenger}
                item={item}
                installScope={installScope}
                installAllAgents={installAllAgents}
                selectedAgents={selectedAgents}
                compatibleAgents={detectedCompatibleAgents}
              />
            ))}
          </div>
          <div className="flex justify-between items-center mt-4">
            <Button onClick={() => void performSearch(currentPage - 1)} disabled={!canGoPrevious}>
              Previous
            </Button>
            <Button onClick={() => void performSearch(currentPage + 1)} disabled={!canGoNext}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default SearchSkills;
