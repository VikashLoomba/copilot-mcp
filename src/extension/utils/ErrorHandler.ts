import * as vscode from 'vscode';
/**
 * Centralized error handling for the extension
 */
export class ErrorHandler {
    private static _instance: ErrorHandler;
    private constructor() {}

    /**
     * Get the singleton instance
     */
    public static getInstance(): ErrorHandler {
        if (!ErrorHandler._instance) {
            ErrorHandler._instance = new ErrorHandler();
        }
        return ErrorHandler._instance;
    }

    /**
     * Handle an error
     * @param context The context where the error occurred
     * @param error The error object
     * @param showNotification Whether to show a notification to the user
     */
    public handleError(context: string, error: unknown, showNotification: boolean = true): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const fullMessage = `[${context}] ${errorMessage}`;

        // Log the error
        console.error(fullMessage);
        // If Error object has stack, log it
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }

        // Show notification if requested
        if (showNotification) {
            vscode.window.showErrorMessage(`MCP Server Manager: ${errorMessage}`);
        }
    }

    /**
     * Static convenience method to handle errors
     * @param context The context where the error occurred
     * @param error The error object
     * @param showNotification Whether to show a notification to the user
     */
    public static handleError(context: string, error: unknown, showNotification: boolean = true): void {
        ErrorHandler.getInstance().handleError(context, error, showNotification);
    }
}