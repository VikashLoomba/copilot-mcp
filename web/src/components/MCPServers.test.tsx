import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import MCPServers from './MCPServers';

vi.mock('./SearchMCPServers', () => ({
  default: () => <div data-testid="search-content">Search Content</div>
}));

vi.mock('./InstalledMCPServers', () => ({
  default: () => <div data-testid="installed-content">Installed Content</div>
}));

describe('MCPServers', () => {
  it('renders tabs with a default active search view', () => {
    render(<MCPServers />);

    const searchTab = screen.getByRole('tab', { name: 'Search' });
    const installedTab = screen.getByRole('tab', { name: 'Installed' });

    expect(searchTab).toBeInTheDocument();
    expect(installedTab).toBeInTheDocument();
    expect(searchTab).toHaveAttribute('aria-selected', 'true');
    expect(installedTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('search-content')).toBeInTheDocument();
  });
});
