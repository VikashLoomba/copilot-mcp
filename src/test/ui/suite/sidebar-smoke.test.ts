import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Copilot MCP UI Smoke', () => {
  test('extension is discoverable and activates', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON?.name === 'copilot-mcp'
    );

    assert.ok(extension, 'Expected copilot-mcp extension to be available');
    await extension!.activate();

    assert.ok(
      extension!.isActive,
      'Expected copilot-mcp extension to activate successfully'
    );
  });

  test('sidebar view and showLogs command are contributed', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON?.name === 'copilot-mcp'
    );
    assert.ok(extension, 'Expected copilot-mcp extension metadata');

    const sidebarViews =
      extension!.packageJSON?.contributes?.views?.copilotMcpSidebar ?? [];
    const hasMainSidebarView = sidebarViews.some(
      (view: { id?: string }) => view.id === 'copilotMcpView'
    );

    assert.ok(
      hasMainSidebarView,
      'Expected copilotMcpView to be contributed to copilotMcpSidebar'
    );

    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(
      allCommands.includes('copilot-mcp.showLogs'),
      'Expected copilot-mcp.showLogs command to be registered'
    );
  });
});
