import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	// showUpdatesToUser is remote-first but falls back to the bundled
	// WHATS_NEW.md on any fetch failure. That fallback must always exist and
	// satisfy the same sanity bounds the remote body is held to (starts with
	// a markdown heading, >200 chars, <1MB), or the What's New impression
	// could be lost — keep these assertions in sync with src/extension.ts.
	test('bundled WHATS_NEW.md is a usable What\'s New fallback', async () => {
		const extension = vscode.extensions.getExtension('AutomataLabs.copilot-mcp');
		assert.ok(extension, 'extension should be available in the test host');
		const bundledUri = vscode.Uri.joinPath(extension.extensionUri, 'WHATS_NEW.md');
		const bytes = await vscode.workspace.fs.readFile(bundledUri);
		const body = Buffer.from(bytes).toString('utf8');
		assert.ok(body.trim().startsWith('#'), 'bundled notes should start with a markdown heading');
		assert.ok(body.length > 200, 'bundled notes should be longer than 200 characters');
		assert.ok(body.length < 1024 * 1024, 'bundled notes should be smaller than 1MB');
	});
});
