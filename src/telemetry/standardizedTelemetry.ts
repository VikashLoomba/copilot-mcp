/**
 * Standardized telemetry utilities for consistent event reporting
 */

import * as vscode from "vscode";
import { getLogger } from "./index";
import {
    type TelemetryEvent,
    type TelemetryContext,
    type ErrorTelemetryEvent,
    type PerformanceTelemetryEvent,
    type TelemetryEventName,
    type TelemetryErrorClass,
    TelemetryEvents
} from "./types";

// Keys in logError additionalProperties that are always derived from the
// context argument; caller-supplied values for them are ignored.
const RESERVED_ERROR_PROP_KEYS = new Set(['context', 'errorSite', 'error_site']);

/**
 * Coarse error classification derived cheaply from error name/message and
 * common status/code fields. Used for the error_class property.
 */
function classifyError(error: Error): TelemetryErrorClass {
    const withStatus = error as Error & { status?: unknown; statusCode?: unknown; code?: unknown };
    const status = typeof withStatus.status === 'number'
        ? withStatus.status
        : typeof withStatus.statusCode === 'number'
            ? withStatus.statusCode
            : undefined;
    const code = typeof withStatus.code === 'string' ? withStatus.code : '';
    const text = `${error.name} ${error.message} ${code}`.toLowerCase();

    if (status === 429 || /rate.?limit|too many requests/.test(text)) {
        return 'rate_limit';
    }
    if (status === 401 || status === 403 || /unauthorized|forbidden|authentication|permission|consent/.test(text)) {
        return 'auth';
    }
    if (status !== undefined && status >= 400 && status < 500) {
        return 'http_4xx';
    }
    if (status !== undefined && status >= 500 && status < 600) {
        return 'http_5xx';
    }
    if (/network|fetch failed|econn|etimedout|enotfound|socket|dns|offline|timed?.?out/.test(text)) {
        return 'network';
    }
    if (/validation|invalid|malformed|schema|parse/.test(text)) {
        return 'validation';
    }
    return 'unknown';
}

/**
 * Standard error properties. Errors are serialized explicitly here — never
 * String()-coerced — so the pipeline can never emit "[object Object]".
 */
function serializeError(error: Error): {
    errorType: string;
    errorClass: TelemetryErrorClass;
    errorMessage: string;
} {
    return {
        errorType: error.constructor?.name || 'Error',
        errorClass: classifyError(error),
        errorMessage: `${error.name}: ${error.message}`.slice(0, 200),
    };
}

class StandardizedTelemetry {
    private context: TelemetryContext = {};
    private performanceTimers: Map<string, number> = new Map();
    private readonly TIMER_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private readonly TIMER_MAX_AGE = 10 * 60 * 1000; // 10 minutes
    private cleanupIntervalId: NodeJS.Timeout | undefined;

    /**
     * Initialize telemetry context with user session and extension info
     */
    public initializeContext(session?: vscode.AuthenticationSession, extensionVersion?: string): void {
        this.context = {
            userId: session?.account?.id,
            sessionId: session?.account?.id ? `${session.account.id}_${Date.now()}` : undefined,
            version: extensionVersion || vscode.extensions.getExtension('AutomataLabs.copilot-mcp')?.packageJSON?.version,
            platform: `${process.platform}_${process.arch}`,
        };
        
        // Start cleanup interval for abandoned performance timers
        this.startTimerCleanup();
    }
    
    /**
     * Start periodic cleanup of abandoned performance timers
     */
    private startTimerCleanup(): void {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
        }
        
        this.cleanupIntervalId = setInterval(() => {
            this.cleanupAbandonedTimers();
        }, this.TIMER_CLEANUP_INTERVAL);
    }
    
    /**
     * Clean up performance timers that are older than MAX_AGE
     */
    private cleanupAbandonedTimers(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];
        
        for (const [key, startTime] of this.performanceTimers) {
            if (now - startTime > this.TIMER_MAX_AGE) {
                keysToDelete.push(key);
                console.warn(`Cleaning up abandoned performance timer: ${key}`);
            }
        }
        
        keysToDelete.forEach(key => this.performanceTimers.delete(key));
    }
    
    /**
     * Stop the cleanup interval (useful for testing or cleanup)
     */
    public dispose(): void {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = undefined;
        }
        this.performanceTimers.clear();
    }

    /**
     * Log a standardized telemetry event
     */
    public logEvent(event: TelemetryEvent): void {
        const logger = getLogger();
        
        // Merge context into properties
        const properties = {
            ...this.context,
            ...event.properties,
        };

        // Merge measurements into the data object if present
        const data = event.measurements && Object.keys(event.measurements).length > 0 
            ? { ...properties, ...event.measurements }
            : properties;

        logger.logUsage(event.name, data);
    }

    /**
     * Log an error event with standardized error information.
     * Emits exactly one rich error.general event per call.
     */
    public logError(error: Error | string, context?: string, additionalProperties?: Record<string, any>): void {
        const errorObj = typeof error === 'string' ? new Error(error) : error;
        const errorSite = context || 'unknown';

        // Filter out undefined values and reserved keys (context/errorSite
        // always reflect the context argument, never a caller property).
        const filteredProperties: Record<string, string | number | boolean> = {};
        if (additionalProperties) {
            for (const [key, value] of Object.entries(additionalProperties)) {
                if (value !== undefined && !RESERVED_ERROR_PROP_KEYS.has(key)) {
                    filteredProperties[key] = value;
                }
            }
        }

        const errorEvent: ErrorTelemetryEvent = {
            name: TelemetryEvents.ERROR_GENERAL,
            properties: {
                ...serializeError(errorObj),
                // error_site is set early and never spread over, so the call
                // site always survives caller props and the sender's prop cap.
                errorSite,
                ...(errorObj.stack && { stackTrace: errorObj.stack }),
                ...filteredProperties,
                // Set after filteredProperties so the context argument always
                // wins over anything a caller might pass.
                context: errorSite,
            },
        };

        this.logEvent(errorEvent);
    }

    /**
     * Start a performance timer for measuring operation duration
     */
    public startPerformanceTimer(operationName: string): void {
        this.performanceTimers.set(operationName, Date.now());
    }

    /**
     * End a performance timer and log the duration
     */
    public endPerformanceTimer(
        operationName: string, 
        eventName: TelemetryEventName,
        properties?: Record<string, string | number | boolean>
    ): void {
        const startTime = this.performanceTimers.get(operationName);
        if (!startTime) {
            console.warn(`Performance timer '${operationName}' was not started`);
            return;
        }

        const duration = Date.now() - startTime;
        this.performanceTimers.delete(operationName);

        const performanceEvent: PerformanceTelemetryEvent = {
            name: eventName as `performance.${string}`,
            properties,
            measurements: {
                duration,
            },
        };

        this.logEvent(performanceEvent);
    }

    /**
     * Log extension lifecycle events
     */
    public logExtensionActivate(isNewInstall: boolean = false): void {
        if (isNewInstall) {
            this.logEvent({
                name: TelemetryEvents.EXTENSION_NEW_USER_INSTALL,
                properties: {
                    timestamp: new Date().toISOString(),
                },
            });
        }

        this.logEvent({
            name: TelemetryEvents.EXTENSION_ACTIVATE,
            properties: {
                timestamp: new Date().toISOString(),
                isNewInstall,
            },
        });
    }

    /**
     * Log chat participant events
     */
    public logChatSearch(query: string, user?: vscode.AuthenticationSession['account']): void {
        this.logEvent({
            name: TelemetryEvents.CHAT_SEARCH_START,
            properties: {
                query: query,
                queryLength: query.length,
                hasQuery: query.trim().length > 0,
                ...(user?.label && { userLabel: user.label }),
            },
        });
    }

    public logChatInstall(query: string, user?: vscode.AuthenticationSession['account']): void {
        this.logEvent({
            name: TelemetryEvents.CHAT_INSTALL_START,
            properties: {
                query: query,
                queryLength: query.length,
                hasQuery: query.trim().length > 0,
                ...(user?.label && { userLabel: user.label }),
            },
        });
    }

    public logChatUnknownIntent(intent: string): void {
        this.logEvent({
            name: TelemetryEvents.CHAT_UNKNOWN_INTENT,
            properties: {
                intent,
            },
        });
    }

    public logChatInstallUriOpened(uri: string): void {
        let uriScheme = 'unknown';
        try {
            if (uri && uri.trim()) {
                uriScheme = new URL(uri).protocol.replace(':', '');
            }
        } catch (error) {
            console.warn(`Failed to parse URI for telemetry: ${uri}`, error);
            uriScheme = 'invalid';
        }
        
        this.logEvent({
            name: TelemetryEvents.CHAT_INSTALL_URI_OPENED,
            properties: {
                uriScheme,
            },
        });
    }

    /**
     * Log webview/sidebar events
     */
    public logWebviewSearch(query: string, resultsCount?: number): void {
        this.logEvent({
            name: TelemetryEvents.WEBVIEW_SEARCH_START,
            properties: {
                query: query,
                queryLength: query.length,
                hasQuery: query.trim().length > 0,
            },
            measurements: resultsCount !== undefined ? { resultsCount } : undefined,
        });
    }

    public logWebviewInstallAttempt(repoName: string): void {
        this.logEvent({
            name: TelemetryEvents.WEBVIEW_INSTALL_START,
            properties: {
                repoName,
            },
        });
    }

    public logWebviewAiSetupSuccess(url: string, additionalProperties?: Record<string, string | number | boolean>): void {
        this.logEvent({
            name: TelemetryEvents.WEBVIEW_AI_SETUP_SUCCESS,
            properties: {
                github_repository_url: url,
                ...additionalProperties,
            }
        });
    }

    public logWebviewAiSetupError(error: Error | string, additionalProperties?: Record<string, string | number | boolean>): void {
        const errorObj = typeof error === 'string' ? new Error(error) : error;
        this.logEvent({
            name: TelemetryEvents.WEBVIEW_AI_SETUP_ERROR,
            properties: {
                ...serializeError(errorObj),
                ...additionalProperties,
            },
        });
    }

    public logWebviewFeedbackSent(feedbackType?: string): void {
        this.logEvent({
            name: TelemetryEvents.WEBVIEW_FEEDBACK_SENT,
            properties: {
                feedbackType: feedbackType || 'general',
            },
        });
    }

    public logWebviewInstallUriOpened(uri: string, additionalProperties?: Record<string, string | number | boolean>): void {
        let uriScheme = 'unknown';
        try {
            if (uri && uri.trim()) {
                uriScheme = new URL(uri).protocol.replace(':', '');
            }
        } catch (error) {
            console.warn(`Failed to parse URI for telemetry: ${uri}`, error);
            uriScheme = 'invalid';
        }

        this.logEvent({
            name: TelemetryEvents.WEBVIEW_INSTALL_URI_OPENED,
            properties: {
                uriScheme,
                ...additionalProperties,
            },
        });
    }
}

// Export a singleton instance
export const standardizedTelemetry = new StandardizedTelemetry();

// Export convenience functions with proper binding
export const initializeContext = standardizedTelemetry.initializeContext.bind(standardizedTelemetry);
export const logEvent = standardizedTelemetry.logEvent.bind(standardizedTelemetry);
export const logError = standardizedTelemetry.logError.bind(standardizedTelemetry);
export const startPerformanceTimer = standardizedTelemetry.startPerformanceTimer.bind(standardizedTelemetry);
export const endPerformanceTimer = standardizedTelemetry.endPerformanceTimer.bind(standardizedTelemetry);
export const logExtensionActivate = standardizedTelemetry.logExtensionActivate.bind(standardizedTelemetry);
export const logChatSearch = standardizedTelemetry.logChatSearch.bind(standardizedTelemetry);
export const logChatInstall = standardizedTelemetry.logChatInstall.bind(standardizedTelemetry);
export const logChatUnknownIntent = standardizedTelemetry.logChatUnknownIntent.bind(standardizedTelemetry);
export const logChatInstallUriOpened = standardizedTelemetry.logChatInstallUriOpened.bind(standardizedTelemetry);
export const logWebviewSearch = standardizedTelemetry.logWebviewSearch.bind(standardizedTelemetry);
export const logWebviewInstallAttempt = standardizedTelemetry.logWebviewInstallAttempt.bind(standardizedTelemetry);
export const logWebviewAiSetupSuccess = standardizedTelemetry.logWebviewAiSetupSuccess.bind(standardizedTelemetry);
export const logWebviewAiSetupError = standardizedTelemetry.logWebviewAiSetupError.bind(standardizedTelemetry);
export const logWebviewFeedbackSent = standardizedTelemetry.logWebviewFeedbackSent.bind(standardizedTelemetry);
export const logWebviewInstallUriOpened = standardizedTelemetry.logWebviewInstallUriOpened.bind(standardizedTelemetry);