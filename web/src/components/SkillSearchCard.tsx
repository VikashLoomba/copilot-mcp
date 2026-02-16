import React, { useMemo, useState } from 'react';
import type { Messenger } from 'vscode-messenger-webview';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  skillsInstallType,
  skillsListFromSourceType,
  type ListedSkillDto,
  type SkillAgentOptionDto,
  type SkillsInstallResponse,
  type SkillsInstallScope,
  type SkillsSearchItemDto,
} from '../../../src/shared/types/rpcTypes.ts';

type AgentId = SkillAgentOptionDto['id'];

interface SkillSearchCardProps {
  messenger: Messenger;
  item: SkillsSearchItemDto;
  installScope: SkillsInstallScope;
  installAllAgents: boolean;
  selectedAgents: AgentId[];
  compatibleAgents: SkillAgentOptionDto[];
}

const FALLBACK_SKILL_DESCRIPTION = 'Fallback selection when sub-skills could not be listed.';

function normalizeListedSkills(skills: ListedSkillDto[], fallbackName: string): ListedSkillDto[] {
  const filtered = skills
    .filter((skill) => skill && typeof skill.name === 'string' && skill.name.trim().length > 0)
    .map((skill) => ({
      name: skill.name.trim(),
      description: typeof skill.description === 'string' ? skill.description : '',
      path: typeof skill.path === 'string' ? skill.path : '',
    }));

  const unique = Array.from(
    filtered.reduce<Map<string, ListedSkillDto>>((acc, skill) => {
      if (!acc.has(skill.name)) {
        acc.set(skill.name, skill);
      }
      return acc;
    }, new Map()),
  ).map((entry) => entry[1]);

  if (unique.length > 0) {
    return unique;
  }

  return [
    {
      name: fallbackName,
      description: FALLBACK_SKILL_DESCRIPTION,
      path: '',
    },
  ];
}

const SkillSearchCard: React.FC<SkillSearchCardProps> = ({
  messenger,
  item,
  installScope,
  installAllAgents,
  selectedAgents,
  compatibleAgents,
}) => {
  const source = useMemo(() => ((item.source ?? '').trim() || item.id.trim()), [item.id, item.source]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingSubSkills, setIsLoadingSubSkills] = useState(false);
  const [subSkillsError, setSubSkillsError] = useState<string | null>(null);
  const [subSkills, setSubSkills] = useState<ListedSkillDto[] | null>(null);
  const [selectedSkillNames, setSelectedSkillNames] = useState<Set<string>>(new Set());
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<SkillsInstallResponse | null>(null);

  const selectedSkillList = useMemo(() => Array.from(selectedSkillNames), [selectedSkillNames]);
  const targetAgentCount = installAllAgents ? compatibleAgents.length : selectedAgents.length;

  const loadSubSkills = async (): Promise<ListedSkillDto[]> => {
    setIsLoadingSubSkills(true);
    setSubSkillsError(null);

    try {
      const response = await messenger.sendRequest(skillsListFromSourceType, { type: 'extension' }, { source });
      const normalized = normalizeListedSkills(Array.isArray(response?.skills) ? response.skills : [], item.name);
      setSubSkills(normalized);
      setSelectedSkillNames(new Set(normalized.map((skill) => skill.name)));
      setSelectionInitialized(true);
      return normalized;
    } catch (error) {
      const fallback = normalizeListedSkills([], item.name);
      const message = error instanceof Error ? error.message : 'Failed to list sub-skills';
      setSubSkills(fallback);
      setSelectedSkillNames(new Set(fallback.map((skill) => skill.name)));
      setSelectionInitialized(true);
      setSubSkillsError(message);
      return fallback;
    } finally {
      setIsLoadingSubSkills(false);
    }
  };

  const toggleExpanded = () => {
    setIsExpanded((previous) => {
      const nextValue = !previous;
      if (nextValue && subSkills === null && !isLoadingSubSkills && source.length > 0) {
        void loadSubSkills();
      }
      return nextValue;
    });
  };

  const setSkillChecked = (skillName: string, checked: boolean) => {
    setSelectedSkillNames((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(skillName);
      } else {
        next.delete(skillName);
      }
      return next;
    });
    setSelectionInitialized(true);
  };

  const selectAllSkills = () => {
    if (!subSkills) {
      return;
    }
    setSelectedSkillNames(new Set(subSkills.map((skill) => skill.name)));
    setSelectionInitialized(true);
  };

  const clearSelectedSkills = () => {
    setSelectedSkillNames(new Set());
    setSelectionInitialized(true);
  };

  const handleInstall = async () => {
    setInstallError(null);
    setInstallResult(null);

    if (!source) {
      setInstallError('This search result is missing a valid source.');
      return;
    }

    if (!installAllAgents && selectedAgents.length === 0) {
      setInstallError('Select at least one target agent or enable "Install to all agents".');
      return;
    }

    setIsInstalling(true);
    try {
      let loadedSkills = subSkills;
      if (!loadedSkills) {
        loadedSkills = await loadSubSkills();
      }

      let selectedNames = selectedSkillList;
      if (selectedNames.length === 0 && !selectionInitialized) {
        selectedNames = loadedSkills.map((skill) => skill.name);
      }

      if (selectedNames.length === 0) {
        setInstallError('Select at least one sub-skill to install.');
        return;
      }

      const response = await messenger.sendRequest(skillsInstallType, { type: 'extension' }, {
        searchItem: item,
        source,
        selectedSkillNames: selectedNames,
        installScope,
        installAllAgents,
        selectedAgents,
      });
      setInstallResult(response as SkillsInstallResponse);
    } catch (error) {
      console.error(error);
      setInstallError(error instanceof Error ? error.message : 'Install failed');
    } finally {
      setIsInstalling(false);
    }
  };

  const canInstall =
    !isInstalling &&
    source.length > 0 &&
    targetAgentCount > 0 &&
    (selectedSkillList.length > 0 || !selectionInitialized);
  const installsText = Number.isFinite(item.installs) ? item.installs.toLocaleString() : '0';

  return (
    <Card className="h-full flex flex-col shadow-sm bg-[var(--vscode-editor-background)] border-[var(--vscode-editorWidget-border)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg break-all">{item.name}</CardTitle>
        <CardDescription className="text-xs pt-1 break-all">
          {source}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{installsText} installs</Badge>
          <Badge variant="outline">{targetAgentCount} target agents</Badge>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={toggleExpanded}
            className="w-full justify-between text-xs"
          >
            <span>Sub-skills ({selectedSkillNames.size} selected)</span>
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>

          {isExpanded && (
            <div className="rounded border border-[var(--vscode-editorWidget-border)] p-2 space-y-2">
              {isLoadingSubSkills && <p className="text-xs text-muted-foreground">Loading sub-skills...</p>}
              {!isLoadingSubSkills && (
                <>
                  {subSkillsError && (
                    <p className="text-xs text-red-500">
                      Sub-skill discovery issue: {subSkillsError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={selectAllSkills} className="text-xs h-7">
                      Select all
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearSelectedSkills} className="text-xs h-7">
                      Select none
                    </Button>
                  </div>
                  {(subSkills ?? []).map((skill, index) => {
                    const checkboxId = `${item.id}-${skill.name}-${index}`;
                    const checked = selectedSkillNames.has(skill.name);
                    return (
                      <label
                        key={checkboxId}
                        htmlFor={checkboxId}
                        className="flex items-start gap-2 rounded border border-[var(--vscode-editorWidget-border)] px-2 py-1.5 cursor-pointer"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(value) => setSkillChecked(skill.name, value === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium break-all">{skill.name}</p>
                          {skill.description && (
                            <p className="text-[11px] text-muted-foreground break-words">{skill.description}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {installError && <p className="text-xs text-red-500">Install error: {installError}</p>}

        {installResult && (
          <div className="rounded border border-[var(--vscode-editorWidget-border)] p-2 space-y-1">
            <p className="text-xs">
              Installed: {installResult.installed.length} | Failed: {installResult.failed.length}
            </p>
            {installResult.failed.length > 0 && (
              <div className="space-y-1">
                {installResult.failed.slice(0, 5).map((record, index) => (
                  <p key={`${record.agent}-${record.skillName}-${index}`} className="text-[11px] text-red-500 break-words">
                    {record.skillName}
                    {' -> '}
                    {record.agent}: {record.error ?? 'Unknown failure'}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 pb-3 border-t">
        <Button
          onClick={() => void handleInstall()}
          disabled={!canInstall}
          className="w-full bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)]"
        >
          {isInstalling ? 'Installing...' : 'Install Selected Skills'}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default SkillSearchCard;
