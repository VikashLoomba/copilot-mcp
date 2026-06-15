// Pure, dependency-free model-selection logic shared by CopilotChat.getModelId().
// Kept free of any `vscode` import so it can be unit-tested directly (see
// src/test/modelSelection.test.ts) without the extension host.

/**
 * Minimal shape of a Copilot /models catalog entry that we rely on. The live
 * catalog is external and untyped, so every field is optional and accessed
 * defensively; unknown fields are ignored.
 */
export interface CopilotCatalogModel {
	id: string;
	model_picker_enabled?: boolean;
	supported_endpoints?: string[];
	policy?: { state?: string };
	capabilities?: unknown;
	[key: string]: unknown;
}

/**
 * Returns true when a catalog model is BOTH chat-callable and enabled, i.e. it
 * can actually be used against the /chat/completions endpoint that @ax-llm/ax
 * targets. Three conditions, each fail-open so an absent field never
 * over-filters an otherwise-usable model out of the list (issue #57):
 *   - model_picker_enabled is set (the editor surfaces it);
 *   - supported_endpoints includes "/chat/completions" — but if the field is
 *     absent we assume callable (?? true), so a leaner catalog isn't emptied;
 *   - policy.state is not "disabled" — if absent we assume enabled
 *     (?? "enabled"), so accounts whose catalog omits policy aren't filtered.
 */
export function isChatCallableEnabledModel(
	model: CopilotCatalogModel | null | undefined,
): boolean {
	if (!model) {
		return false;
	}
	if (!model.model_picker_enabled) {
		return false;
	}
	const chatCallable =
		model.supported_endpoints?.includes?.("/chat/completions") ?? true;
	const enabled = (model.policy?.state ?? "enabled") !== "disabled";
	return chatCallable && enabled;
}

/**
 * Selects the model id to use from a live Copilot /models catalog.
 *
 * Guarantees the returned id is one a chat-completions request can actually use:
 * the catalog is first filtered to models that are both chat-callable and
 * enabled (isChatCallableEnabledModel), and the result is drawn ONLY from that
 * filtered set — both the preference matches and the [0] fallback. If the
 * filter yields nothing (e.g. an odd/empty catalog) we return `fallback`
 * instead of throwing or indexing undefined.
 *
 * @returns the chosen catalog model, or null when no usable model exists (the
 *          caller then uses its hardcoded fallback id).
 */
export function selectChatModel(
	models: CopilotCatalogModel[] | null | undefined,
	preferredModelIds: readonly string[],
): CopilotCatalogModel | null {
	const list = Array.isArray(models) ? models : [];
	const enabledModels = list.filter(isChatCallableEnabledModel);
	if (enabledModels.length === 0) {
		return null;
	}
	for (const preferredId of preferredModelIds) {
		const found = enabledModels.find((model) => model.id === preferredId);
		if (found) {
			return found;
		}
	}
	return enabledModels[0];
}
