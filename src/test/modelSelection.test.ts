import * as assert from "assert";

import {
	isChatCallableEnabledModel,
	selectChatModel,
} from "../utilities/modelSelection";

// Regression coverage for issue #57: AI-assisted setup failed 100% with HTTP 400
// model_not_supported because getModelId() picked models that aren't usable on
// the /chat/completions endpoint @ax-llm/ax targets — a policy-disabled (but
// picker-enabled) model, and a /responses-only model. The selection must only
// ever return a model that is BOTH chat-callable and enabled.
suite("modelSelection", () => {
	// A picker-enabled model whose account policy is disabled — un-callable.
	const disabledPicker = {
		id: "claude-sonnet-4.6",
		model_picker_enabled: true,
		supported_endpoints: ["/chat/completions"],
		policy: { state: "disabled" },
	};
	// A picker-enabled model that only speaks the Responses API — never callable
	// on /chat/completions (this was the old FALLBACK_MODEL_ID, gpt-5.3-codex).
	const responsesOnly = {
		id: "gpt-5.3-codex",
		model_picker_enabled: true,
		supported_endpoints: ["/responses"],
		policy: { state: "enabled" },
	};
	// A plain chat-callable, enabled model.
	const chatCallable = {
		id: "gpt-4o",
		model_picker_enabled: true,
		supported_endpoints: ["/chat/completions"],
		policy: { state: "enabled" },
	};

	const preferred = [
		"claude-sonnet-4.6",
		"gpt-5.3-codex",
		"gpt-5.1-codex",
	];

	test("selects the chat-callable enabled model, never disabled/responses-only", () => {
		const catalog = [disabledPicker, responsesOnly, chatCallable];
		const selected = selectChatModel(catalog, preferred);
		assert.ok(selected, "a usable model should be selected");
		assert.strictEqual(selected!.id, "gpt-4o");
	});

	test("isChatCallableEnabledModel rejects disabled and responses-only", () => {
		assert.strictEqual(isChatCallableEnabledModel(disabledPicker), false);
		assert.strictEqual(isChatCallableEnabledModel(responsesOnly), false);
		assert.strictEqual(isChatCallableEnabledModel(chatCallable), true);
	});

	test("ignores model_picker disabled models", () => {
		const notPickable = {
			id: "internal-model",
			model_picker_enabled: false,
			supported_endpoints: ["/chat/completions"],
			policy: { state: "enabled" },
		};
		assert.strictEqual(isChatCallableEnabledModel(notPickable), false);
	});

	test("honors preference order among callable models", () => {
		const sonnetEnabled = {
			...disabledPicker,
			policy: { state: "enabled" },
		};
		const catalog = [chatCallable, sonnetEnabled];
		const selected = selectChatModel(catalog, preferred);
		// sonnet leads the preference list and is now callable, so it wins.
		assert.strictEqual(selected!.id, "claude-sonnet-4.6");
	});

	test("fails open when supported_endpoints / policy are absent", () => {
		const leanCatalog = [{ id: "lean", model_picker_enabled: true }];
		assert.strictEqual(
			isChatCallableEnabledModel(leanCatalog[0]),
			true,
			"absent fields must not over-filter a usable model",
		);
		const selected = selectChatModel(leanCatalog, preferred);
		assert.strictEqual(selected!.id, "lean");
	});

	test("returns null on an empty / all-unusable catalog (caller uses fallback)", () => {
		assert.strictEqual(selectChatModel([], preferred), null);
		assert.strictEqual(
			selectChatModel([disabledPicker, responsesOnly], preferred),
			null,
		);
		assert.strictEqual(selectChatModel(undefined, preferred), null);
	});
});
