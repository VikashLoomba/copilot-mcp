/**
 * Standardized telemetry event types and interfaces for the Copilot MCP extension
 */

export interface TelemetryEvent {
    /** The event name using dot notation (e.g., 'extension.activate', 'chat.search') */
    name: string;
    /** Event properties - contextual data about the event */
    properties?: Record<string, string | number | boolean>;
    /** Event measurements - numeric data like durations, counts, etc. */
    measurements?: Record<string, number>;
}

export interface TelemetryContext {
    /** User ID from GitHub session */
    userId?: string;
    /** Session ID for tracking user sessions */
    sessionId?: string;
    /** Extension version */
    version?: string;
    /** Platform information */
    platform?: string;
}

/**
 * Coarse error classification buckets, sent on the wire as `error_class`.
 */
export type TelemetryErrorClass =
    | 'http_4xx'
    | 'http_5xx'
    | 'rate_limit'
    | 'auth'
    | 'validation'
    | 'network'
    | 'unknown';

export interface ErrorTelemetryEvent extends TelemetryEvent {
    name: `error.${string}`;
    properties: {
        /** Error constructor name (sent as error_type) */
        errorType: string;
        /** Coarse error classification (sent as error_class) */
        errorClass: TelemetryErrorClass;
        /** Error name + message, truncated to 200 chars (sent as error_message) */
        errorMessage: string;
        /** The logError context argument (sent as error_site); always reflects
         *  the call site even when callers pass their own `context` property */
        errorSite: string;
        /** Context where error occurred */
        context: string;
        /** Stack trace if available */
        stackTrace?: string;
        /** Optional caller-generated correlation id (sent as attempt_id) */
        attemptId?: string;
    } & Record<string, string | number | boolean>;
}

export interface PerformanceTelemetryEvent extends TelemetryEvent {
    name: `performance.${string}`;
    measurements: {
        /** Duration in milliseconds */
        duration: number;
        /** Additional performance measurements */
        [key: string]: number;
    };
}

/**
 * Standardized event names using dot notation for consistency
 */
export const TelemetryEvents = {
    // Extension lifecycle events
    EXTENSION_ACTIVATE: 'extension.activate',
    EXTENSION_DEACTIVATE: 'extension.deactivate',
    EXTENSION_NEW_USER_INSTALL: 'extension.newUserInstall',
    // No "extension." prefix on purpose: the sender snake_cases the bare name
    // and prefixes "ext.", so this reaches the endpoint as "ext.whats_new_shown".
    WHATS_NEW_SHOWN: 'whatsNewShown',
    
    // Chat participant events
    CHAT_SEARCH_START: 'chat.search.start',
    CHAT_SEARCH_SUCCESS: 'chat.search.success',
    CHAT_SEARCH_ERROR: 'chat.search.error',
    CHAT_INSTALL_START: 'chat.install.start',
    CHAT_INSTALL_SUCCESS: 'chat.install.success',
    CHAT_INSTALL_ERROR: 'chat.install.error',
    CHAT_UNKNOWN_INTENT: 'chat.unknownIntent',
    CHAT_INSTALL_URI_OPENED: 'chat.install.uriOpened',
    
    // Webview/sidebar events
    WEBVIEW_SEARCH_START: 'webview.search.start',
    WEBVIEW_SEARCH_SUCCESS: 'webview.search.success',
    WEBVIEW_SEARCH_ERROR: 'webview.search.error',
    WEBVIEW_INSTALL_START: 'webview.install.start',
    WEBVIEW_INSTALL_SUCCESS: 'webview.install.success',
    WEBVIEW_INSTALL_ERROR: 'webview.install.error',
    WEBVIEW_AI_SETUP_START: 'webview.aiSetup.start',
    WEBVIEW_AI_SETUP_SUCCESS: 'webview.aiSetup.success',
    WEBVIEW_AI_SETUP_ERROR: 'webview.aiSetup.error',
    WEBVIEW_FEEDBACK_SENT: 'webview.feedback.sent',
    WEBVIEW_INSTALL_URI_OPENED: 'webview.install.uriOpened',
    // Reaches the endpoint as "ext.webview.cloudmcp.registry_interest".
    WEBVIEW_CLOUDMCP_REGISTRY_INTEREST: 'webview.cloudmcp.registryInterest',
    
    // Error events
    ERROR_CHAT_SEARCH: 'error.chat.search',
    ERROR_CHAT_INSTALL: 'error.chat.install',
    ERROR_WEBVIEW_SEARCH: 'error.webview.search',
    ERROR_WEBVIEW_INSTALL: 'error.webview.install',
    ERROR_AI_SETUP: 'error.aiSetup',
    ERROR_GENERAL: 'error.general',
    
    // Performance events
    PERFORMANCE_SEARCH: 'performance.search',
    PERFORMANCE_INSTALL: 'performance.install',
    PERFORMANCE_AI_SETUP: 'performance.aiSetup',
} as const;

export type TelemetryEventName = typeof TelemetryEvents[keyof typeof TelemetryEvents];