import * as vscode from 'vscode';
import { Uri, Event, Disposable, ProviderResult, Command, CancellationToken } from 'vscode';
export { ProviderResult } from 'vscode';

export async function getSystemPrompt(): Promise<string[]> {
	const env = vscode.env.appHost;
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'unknown';
	return [
		`You are a helpful, interactive tool-using chat agent that helps users in the IDE. Use the instructions below and the tools available to you to assist the user.
  When you spend time searching for commands to typecheck, lint, build, or test, you should ask the user if it's okay to add those commands to KODING.md. Similarly, when learning about code style preferences or important codebase information, ask if it's okay to add that to KODING.md so you can remember it for next time.
  
  # Tone and style
  You should be concise, direct, and to the point. When you run a non-trivial terminal command, you should explain what the command does and why you are running it, to make sure the user understands what you are doing.
  Remember that your output will be displayed in the chat window. Your responses can use Github-flavored markdown for formatting, and will be rendered using the CommonMark specification.
  Output text to communicate with the user; all text you output is displayed to the user. Only use tools to complete tasks.
  If you cannot or will not help the user with something, tell them why. Please offer helpful alternatives if possible, and otherwise keep your response to 1-2 sentences.
  
  # Tool usage policy
  - Use tools liberally and correctly.
  - If a user query can be directly answered by a tool's output, use the tool.
  - If you need to perform a task that requires multiple steps, consider using a tool to perform each step.

  # Following conventions
  When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.
  - Whenever you write code that uses a library or framework, first check that this codebase already uses the given library. For example, you might look at neighboring files, or check the package.json (or cargo.toml, and so on depending on the language).
  - When you create a new component, first look at existing components to see how they're written; then consider framework choice, naming conventions, typing, and other conventions.
  - When you edit a piece of code, first look at the code's surrounding context (especially its imports) to understand the code's choice of frameworks and libraries.
  
  # Code style
  - Do not add comments to the code you write, unless the user asks you to, or the code is complex and requires additional context.
  
  # Doing tasks
  The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code and repository structure, and more. For these tasks the following steps are recommended:
  1. Use the available search tools to understand the codebase and the user's query. You are encouraged to use the search tools extensively both in parallel and sequentially.
  2. Implement the solution using all tools available to you
  3. Verify the solution if possible with tests. NEVER assume specific test framework or test script. Check the README or search codebase to determine the testing approach.
  
  NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.
  `,
		`\n${await getEnvInfo(env, cwd)}`,
	];
}

export async function getEnvInfo(env: string, cwd: string): Promise<string> {
	let isGit = true;
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
	const git = gitExtension?.getAPI(1);
	if (!git) {
		isGit = false;
	} else {
		const repo = git.getRepository(Uri.file(cwd));
		isGit = repo !== null;
	}
	return `Here is useful information about the environment you are running in:
        <env>
        Working directory: ${cwd}
        Is directory a git repo: ${isGit ? 'Yes' : 'No'}
        Platform: ${env}
        Today's date: ${new Date().toLocaleDateString()}
        </env>`;
}


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



export interface Git {
	readonly path: string;
}

export interface InputBox {
	value: string;
}

export const enum ForcePushMode {
	Force,
	ForceWithLease,
	ForceWithLeaseIfIncludes,
}

export const enum RefType {
	Head,
	RemoteHead,
	Tag
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface CommitShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly commitDate?: Date;
	readonly shortStat?: CommitShortStat;
}

export interface Submodule {
	readonly name: string;
	readonly path: string;
	readonly url: string;
}

export interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export const enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}

export interface Change {

	/**
	 * Returns either `originalUri` or `renameUri`, depending
	 * on whether this change is a rename change. When
	 * in doubt always use `uri` over the other two alternatives.
	 */
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	readonly status: Status;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly refs: Ref[];
	readonly remotes: Remote[];
	readonly submodules: Submodule[];
	readonly rebaseCommit: Commit | undefined;

	readonly mergeChanges: Change[];
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];

	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

/**
 * Log options.
 */
export interface LogOptions {
	/** Max number of log entries to retrieve. If not specified, the default is 32. */
	readonly maxEntries?: number;
	readonly path?: string;
	/** A commit range, such as "0a47c67f0fb52dd11562af48658bc1dff1d75a38..0bb4bdea78e1db44d728fd6894720071e303304f" */
	readonly range?: string;
	readonly reverse?: boolean;
	readonly sortByAuthorDate?: boolean;
	readonly shortStats?: boolean;
	readonly author?: string;
	readonly refNames?: string[];
	readonly maxParents?: number;
	readonly skip?: number;
}

export interface CommitOptions {
	all?: boolean | 'tracked';
	amend?: boolean;
	signoff?: boolean;
	signCommit?: boolean;
	empty?: boolean;
	noVerify?: boolean;
	requireUserConfig?: boolean;
	useEditor?: boolean;
	verbose?: boolean;
	/**
	 * string    - execute the specified command after the commit operation
	 * undefined - execute the command specified in git.postCommitCommand
	 *             after the commit operation
	 * null      - do not execute any command after the commit operation
	 */
	postCommitCommand?: string | null;
}

export interface FetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}

export interface InitOptions {
	defaultBranch?: string;
}

export interface RefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate';
}

export interface BranchQuery extends RefQuery {
	readonly remote?: boolean;
}

export interface Repository {

	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;

	readonly onDidCommit: Event<void>;
	readonly onDidCheckout: Event<void>;

	getConfigs(): Promise<{ key: string; value: string; }[]>;
	getConfig(key: string): Promise<string>;
	setConfig(key: string, value: string): Promise<string>;
	unsetConfig(key: string): Promise<string>;
	getGlobalConfig(key: string): Promise<string>;

	getObjectDetails(treeish: string, path: string): Promise<{ mode: string, object: string, size: number }>;
	detectObjectType(object: string): Promise<{ mimetype: string, encoding?: string }>;
	buffer(ref: string, path: string): Promise<Buffer>;
	show(ref: string, path: string): Promise<string>;
	getCommit(ref: string): Promise<Commit>;

	add(paths: string[]): Promise<void>;
	revert(paths: string[]): Promise<void>;
	clean(paths: string[]): Promise<void>;

	apply(patch: string, reverse?: boolean): Promise<void>;
	diff(cached?: boolean): Promise<string>;
	diffWithHEAD(): Promise<Change[]>;
	diffWithHEAD(path: string): Promise<string>;
	diffWith(ref: string): Promise<Change[]>;
	diffWith(ref: string, path: string): Promise<string>;
	diffIndexWithHEAD(): Promise<Change[]>;
	diffIndexWithHEAD(path: string): Promise<string>;
	diffIndexWith(ref: string): Promise<Change[]>;
	diffIndexWith(ref: string, path: string): Promise<string>;
	diffBlobs(object1: string, object2: string): Promise<string>;
	diffBetween(ref1: string, ref2: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path: string): Promise<string>;

	hashObject(data: string): Promise<string>;

	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	deleteBranch(name: string, force?: boolean): Promise<void>;
	getBranch(name: string): Promise<Branch>;
	getBranches(query: BranchQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;
	getBranchBase(name: string): Promise<Branch | undefined>;
	setBranchUpstream(name: string, upstream: string): Promise<void>;

	checkIgnore(paths: string[]): Promise<Set<string>>;

	getRefs(query: RefQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;

	getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;

	tag(name: string, upstream: string): Promise<void>;
	deleteTag(name: string): Promise<void>;

	status(): Promise<void>;
	checkout(treeish: string): Promise<void>;

	addRemote(name: string, url: string): Promise<void>;
	removeRemote(name: string): Promise<void>;
	renameRemote(name: string, newName: string): Promise<void>;

	fetch(options?: FetchOptions): Promise<void>;
	fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	pull(unshallow?: boolean): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

	blame(path: string): Promise<string>;
	log(options?: LogOptions): Promise<Commit[]>;

	commit(message: string, opts?: CommitOptions): Promise<void>;
	merge(ref: string): Promise<void>;
	mergeAbort(): Promise<void>;

	applyStash(index?: number): Promise<void>;
	popStash(index?: number): Promise<void>;
	dropStash(index?: number): Promise<void>;
}

export interface RemoteSource {
	readonly name: string;
	readonly description?: string;
	readonly url: string | string[];
}

export interface RemoteSourceProvider {
	readonly name: string;
	readonly icon?: string; // codicon name
	readonly supportsQuery?: boolean;
	getRemoteSources(query?: string): ProviderResult<RemoteSource[]>;
	getBranches?(url: string): ProviderResult<string[]>;
	publishRepository?(repository: Repository): Promise<void>;
}

export interface RemoteSourcePublisher {
	readonly name: string;
	readonly icon?: string; // codicon name
	publishRepository(repository: Repository): Promise<void>;
}

export interface Credentials {
	readonly username: string;
	readonly password: string;
}

export interface CredentialsProvider {
	getCredentials(host: Uri): ProviderResult<Credentials>;
}

export interface PostCommitCommandsProvider {
	getCommands(repository: Repository): Command[];
}

export interface PushErrorHandler {
	handlePushError(repository: Repository, remote: Remote, refspec: string, error: Error & { gitErrorCode: GitErrorCodes }): Promise<boolean>;
}

export interface BranchProtection {
	readonly remote: string;
	readonly rules: BranchProtectionRule[];
}

export interface BranchProtectionRule {
	readonly include?: string[];
	readonly exclude?: string[];
}

export interface BranchProtectionProvider {
	onDidChangeBranchProtection: Event<Uri>;
	provideBranchProtection(): BranchProtection[];
}

export interface AvatarQueryCommit {
	readonly hash: string;
	readonly authorName?: string;
	readonly authorEmail?: string;
}

export interface AvatarQuery {
	readonly commits: AvatarQueryCommit[];
	readonly size: number;
}

export interface SourceControlHistoryItemDetailsProvider {
	provideAvatar(repository: Repository, query: AvatarQuery): ProviderResult<Map<string, string | undefined>>;
	provideHoverCommands(repository: Repository): ProviderResult<Command[]>;
	provideMessageLinks(repository: Repository, message: string): ProviderResult<string>;
}

export type APIState = 'uninitialized' | 'initialized';

export interface PublishEvent {
	repository: Repository;
	branch?: string;
}

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly onDidPublish: Event<PublishEvent>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	toGitUri(uri: Uri, ref: string): Uri;
	getRepository(uri: Uri): Repository | null;
	init(root: Uri, options?: InitOptions): Promise<Repository | null>;
	openRepository(root: Uri): Promise<Repository | null>

	registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): Disposable;
	registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable;
	registerCredentialsProvider(provider: CredentialsProvider): Disposable;
	registerPostCommitCommandsProvider(provider: PostCommitCommandsProvider): Disposable;
	registerPushErrorHandler(handler: PushErrorHandler): Disposable;
	registerBranchProtectionProvider(root: Uri, provider: BranchProtectionProvider): Disposable;
	registerSourceControlHistoryItemDetailsProvider(provider: SourceControlHistoryItemDetailsProvider): Disposable;
}

export interface GitExtension {

	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;

	/**
	 * Returns a specific API version.
	 *
	 * Throws error if git extension is disabled. You can listen to the
	 * [GitExtension.onDidChangeEnablement](#GitExtension.onDidChangeEnablement) event
	 * to know when the extension becomes enabled/disabled.
	 *
	 * @param version Version number.
	 * @returns API instance
	 */
	getAPI(version: 1): API;
}

export const enum GitErrorCodes {
	BadConfigFile = 'BadConfigFile',
	AuthenticationFailed = 'AuthenticationFailed',
	NoUserNameConfigured = 'NoUserNameConfigured',
	NoUserEmailConfigured = 'NoUserEmailConfigured',
	NoRemoteRepositorySpecified = 'NoRemoteRepositorySpecified',
	NotAGitRepository = 'NotAGitRepository',
	NotAtRepositoryRoot = 'NotAtRepositoryRoot',
	Conflict = 'Conflict',
	StashConflict = 'StashConflict',
	UnmergedChanges = 'UnmergedChanges',
	PushRejected = 'PushRejected',
	ForcePushWithLeaseRejected = 'ForcePushWithLeaseRejected',
	ForcePushWithLeaseIfIncludesRejected = 'ForcePushWithLeaseIfIncludesRejected',
	RemoteConnectionError = 'RemoteConnectionError',
	DirtyWorkTree = 'DirtyWorkTree',
	CantOpenResource = 'CantOpenResource',
	GitNotFound = 'GitNotFound',
	CantCreatePipe = 'CantCreatePipe',
	PermissionDenied = 'PermissionDenied',
	CantAccessRemote = 'CantAccessRemote',
	RepositoryNotFound = 'RepositoryNotFound',
	RepositoryIsLocked = 'RepositoryIsLocked',
	BranchNotFullyMerged = 'BranchNotFullyMerged',
	NoRemoteReference = 'NoRemoteReference',
	InvalidBranchName = 'InvalidBranchName',
	BranchAlreadyExists = 'BranchAlreadyExists',
	NoLocalChanges = 'NoLocalChanges',
	NoStashFound = 'NoStashFound',
	LocalChangesOverwritten = 'LocalChangesOverwritten',
	NoUpstreamBranch = 'NoUpstreamBranch',
	IsInSubmodule = 'IsInSubmodule',
	WrongCase = 'WrongCase',
	CantLockRef = 'CantLockRef',
	CantRebaseMultipleBranches = 'CantRebaseMultipleBranches',
	PatchDoesNotApply = 'PatchDoesNotApply',
	NoPathFound = 'NoPathFound',
	UnknownPath = 'UnknownPath',
	EmptyCommitMessage = 'EmptyCommitMessage',
	BranchFastForwardRejected = 'BranchFastForwardRejected',
	BranchNotYetBorn = 'BranchNotYetBorn',
	TagConflict = 'TagConflict',
	CherryPickEmpty = 'CherryPickEmpty',
	CherryPickConflict = 'CherryPickConflict'
}