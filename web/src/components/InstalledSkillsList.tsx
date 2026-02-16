import React, { useMemo, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InstalledSkillDto, SkillAgentOptionDto } from '../../../src/shared/types/rpcTypes.ts';

type AgentId = SkillAgentOptionDto['id'];

interface InstalledSkillsListProps {
  skills: InstalledSkillDto[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onUninstall: (skill: InstalledSkillDto, selectedAgents: AgentId[]) => Promise<void>;
  agents: SkillAgentOptionDto[];
}

const InstalledSkillsList: React.FC<InstalledSkillsListProps> = ({
  skills,
  isLoading,
  error,
  onRefresh,
  onUninstall,
  agents,
}) => {
  const agentNameMap = useMemo(
    () =>
      new Map(
        agents.map((agent) => [agent.id, agent.displayName] as const),
      ),
    [agents],
  );
  const [skillToUninstall, setSkillToUninstall] = useState<InstalledSkillDto | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set());
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);

  const closeUninstallDialog = (force = false) => {
    if (isUninstalling && !force) {
      return;
    }

    setSkillToUninstall(null);
    setSelectedAgents(new Set());
    setUninstallError(null);
  };

  const openUninstallDialog = (skill: InstalledSkillDto) => {
    setSkillToUninstall(skill);
    setSelectedAgents(new Set(skill.agents));
    setUninstallError(null);
  };

  const toggleSelectedAgent = (agentId: AgentId, checked: boolean) => {
    if (skillToUninstall?.uninstallPolicy === 'all-agents') {
      return;
    }

    setSelectedAgents((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return next;
    });
  };

  const confirmUninstall = async () => {
    if (!skillToUninstall) {
      return;
    }

    const selected = Array.from(selectedAgents);
    if (selected.length === 0) {
      setUninstallError('Select at least one agent to uninstall from.');
      return;
    }

    if (skillToUninstall.uninstallPolicy === 'all-agents' && selected.length !== skillToUninstall.agents.length) {
      setUninstallError(skillToUninstall.uninstallPolicyReason ?? 'This skill must be removed from all listed agents at once.');
      return;
    }

    setIsUninstalling(true);
    setUninstallError(null);
    try {
      await onUninstall(skillToUninstall, selected);
      closeUninstallDialog(true);
    } catch (uninstallActionError) {
      setUninstallError(
        uninstallActionError instanceof Error ? uninstallActionError.message : 'Uninstall failed',
      );
    } finally {
      setIsUninstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editor-background)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Installed Skills</p>
            <p className="text-xs text-muted-foreground">
              Manage the skills currently available to your agents.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Refresh List
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading installed skills...</p>}
      {!isLoading && error && <p className="text-sm text-red-500">Unable to load installed skills: {error}</p>}
      {!isLoading && !error && skills.length === 0 && (
        <p className="text-sm text-muted-foreground">No installed skills yet. Search skills.sh above to install your first one.</p>
      )}

      {!isLoading && !error && skills.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {skills.map((skill) => {
            const agentsForSkill = skill.agents.map((agentId) => agentNameMap.get(agentId) ?? agentId);
            return (
              <Card
                key={`${skill.scope}:${skill.name}:${skill.path}`}
                className="bg-[var(--vscode-editor-background)] border-[var(--vscode-editorWidget-border)]"
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-base break-all">{skill.name}</CardTitle>
                  <CardDescription className="text-xs break-words">
                    {skill.description || 'No description available'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{skill.scope === 'project' ? 'Project' : 'Global'}</Badge>
                    <Badge variant="secondary">
                      {agentsForSkill.length} {agentsForSkill.length === 1 ? 'agent' : 'agents'}
                    </Badge>
                  </div>

                  {agentsForSkill.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {agentsForSkill.map((agentName) => (
                        <Badge key={`${skill.scope}:${skill.name}:${agentName}`} variant="outline" className="text-[11px]">
                          {agentName}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-3 pt-1">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] text-muted-foreground">Location</p>
                      <p className="text-[11px] font-mono break-all text-[var(--vscode-descriptionForeground)]">{skill.path}</p>
                      {skill.uninstallPolicy === 'all-agents' && (
                        <p className="text-[11px] text-muted-foreground">
                          Uninstalling requires all listed agents.
                        </p>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2.5"
                      onClick={() => openUninstallDialog(skill)}
                    >
                      <Trash2 className="size-3.5" />
                      Uninstall
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(skillToUninstall)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            closeUninstallDialog();
          }
        }}
      >
        <DialogContent className="max-w-[460px] bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)]">
          <DialogHeader>
            <DialogTitle>Uninstall Skill</DialogTitle>
            <DialogDescription>
              {skillToUninstall
                ? `Choose where to remove "${skillToUninstall.name}".`
                : 'Choose where to remove this skill.'}
            </DialogDescription>
          </DialogHeader>

          {skillToUninstall && (
            <div className="space-y-3">
              <div className="rounded border border-[var(--vscode-editorWidget-border)] p-2">
                <p className="text-xs text-muted-foreground">
                  Scope: {skillToUninstall.scope === 'project' ? 'Project' : 'Global'}
                </p>
              </div>

              {skillToUninstall.uninstallPolicy === 'all-agents' && (
                <div className="rounded border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editor-inactiveSelectionBackground)] p-2">
                  <p className="text-xs">
                    {skillToUninstall.uninstallPolicyReason ?? 'This skill is in a shared location and must be removed from all listed agents together.'}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Installed agents</p>
                <div className="max-h-44 overflow-y-auto pr-1 space-y-1.5">
                  {skillToUninstall.agents.map((agentId) => {
                    const checked = selectedAgents.has(agentId);
                    const checkboxId = `uninstall-skill-${skillToUninstall.scope}-${skillToUninstall.name}-${agentId}`;
                    return (
                      <label
                        key={checkboxId}
                        htmlFor={checkboxId}
                        className="flex items-center gap-2 rounded border border-[var(--vscode-editorWidget-border)] px-2 py-1.5 text-xs cursor-pointer"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          disabled={isUninstalling || skillToUninstall.uninstallPolicy === 'all-agents'}
                          onCheckedChange={(value) => toggleSelectedAgent(agentId, value === true)}
                        />
                        <span>{agentNameMap.get(agentId) ?? agentId}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {uninstallError && <p className="text-xs text-red-500">{uninstallError}</p>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => closeUninstallDialog()}
              disabled={isUninstalling}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmUninstall()}
              disabled={isUninstalling || selectedAgents.size === 0}
            >
              {isUninstalling ? 'Uninstalling...' : 'Uninstall Skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InstalledSkillsList;
