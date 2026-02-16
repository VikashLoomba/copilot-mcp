import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import InstalledSkillsList from './InstalledSkillsList';
import type { InstalledSkillDto, SkillAgentOptionDto } from '../../../src/shared/types/rpcTypes.ts';

const mockAgents: SkillAgentOptionDto[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    detected: true,
    supportsGlobal: true
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    detected: true,
    supportsGlobal: true
  }
];

describe('InstalledSkillsList', () => {
  it('uses user-facing copy without implementation-state wording', () => {
    const skills: InstalledSkillDto[] = [];
    const onUninstall = vi.fn().mockResolvedValue(undefined);

    render(
      <InstalledSkillsList
        skills={skills}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
        onUninstall={onUninstall}
        agents={mockAgents}
      />
    );

    expect(screen.getByText('Installed Skills')).toBeInTheDocument();
    expect(screen.getByText('Manage the skills currently available to your agents.')).toBeInTheDocument();
    expect(screen.getByText('No installed skills yet. Search skills.sh above to install your first one.')).toBeInTheDocument();
    expect(
      screen.queryByText('Search is empty, so we are showing skills already installed on this machine.')
    ).not.toBeInTheDocument();
  });

  it('lets users choose specific agents before uninstalling', async () => {
    const skills: InstalledSkillDto[] = [
      {
        name: 'Skill Alpha',
        description: 'Test skill',
        path: '/tmp/skills/skill-alpha',
        canonicalPath: '/tmp/skills/skill-alpha',
        scope: 'project',
        agents: ['codex', 'cursor'],
        uninstallPolicy: 'agent-select',
      }
    ];
    const onUninstall = vi.fn().mockResolvedValue(undefined);

    render(
      <InstalledSkillsList
        skills={skills}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
        onUninstall={onUninstall}
        agents={mockAgents}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    fireEvent.click(screen.getByLabelText('Codex'));
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall Skill' }));

    await waitFor(() => {
      expect(onUninstall).toHaveBeenCalledWith(skills[0], ['cursor']);
    });
  });

  it('disables partial agent selection when uninstall requires all agents', async () => {
    const skills: InstalledSkillDto[] = [
      {
        name: 'Shared Skill',
        description: 'Shared path test',
        path: '/tmp/skills/shared-skill',
        canonicalPath: '/tmp/skills/shared-skill',
        scope: 'project',
        agents: ['codex', 'cursor'],
        uninstallPolicy: 'all-agents',
        uninstallPolicyReason: 'Shared directory requires all agents.',
      }
    ];
    const onUninstall = vi.fn().mockResolvedValue(undefined);

    render(
      <InstalledSkillsList
        skills={skills}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
        onUninstall={onUninstall}
        agents={mockAgents}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    expect(screen.getByText('Shared directory requires all agents.')).toBeInTheDocument();
    expect(screen.getByLabelText('Codex')).toBeDisabled();
    expect(screen.getByLabelText('Cursor')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall Skill' }));
    await waitFor(() => {
      expect(onUninstall).toHaveBeenCalledWith(skills[0], ['codex', 'cursor']);
    });
  });
});
