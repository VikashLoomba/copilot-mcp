import * as vscode from 'vscode';

/**
 * OutputLogger provides a centralized logging mechanism using VSCode's OutputChannel
 * This allows developers to view extension logs in the Output panel
 */
export class OutputLogger {
    private static instance: OutputLogger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Copilot MCP', { log: true });
    }

    public static getInstance(): OutputLogger {
        if (!OutputLogger.instance) {
            OutputLogger.instance = new OutputLogger();
        }
        return OutputLogger.instance;
    }

    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    public debug(message: string, ...args: any[]): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            const formattedMessage = this.formatMessage('DEBUG', message, args);
            this.outputChannel.appendLine(formattedMessage);
            console.debug(message, ...args);
        }
    }

    public info(message: string, ...args: any[]): void {
        if (this.logLevel <= LogLevel.INFO) {
            const formattedMessage = this.formatMessage('INFO', message, args);
            this.outputChannel.appendLine(formattedMessage);
            console.log(message, ...args);
        }
    }

    public warn(message: string, ...args: any[]): void {
        if (this.logLevel <= LogLevel.WARN) {
            const formattedMessage = this.formatMessage('WARN', message, args);
            this.outputChannel.appendLine(formattedMessage);
            console.warn(message, ...args);
        }
    }

    public error(message: string, error?: Error | unknown, ...args: any[]): void {
        if (this.logLevel <= LogLevel.ERROR) {
            const formattedMessage = this.formatMessage('ERROR', message, args);
            this.outputChannel.appendLine(formattedMessage);
            
            if (error) {
                if (error instanceof Error) {
                    this.outputChannel.appendLine(`  Stack: ${error.stack}`);
                    console.error(message, error, ...args);
                } else {
                    this.outputChannel.appendLine(`  Error: ${String(error)}`);
                    console.error(message, error, ...args);
                }
            } else {
                console.error(message, ...args);
            }
        }
    }

    public show(): void {
        this.outputChannel.show();
    }

    public clear(): void {
        this.outputChannel.clear();
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }

    private formatMessage(level: string, message: string, args: any[]): string {
        const timestamp = new Date().toISOString();
        const argsString = args.length > 0 ? ' ' + JSON.stringify(args) : '';
        return `[${timestamp}] [${level}] ${message}${argsString}`;
    }
}

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

// Export a singleton instance for easy access
export const outputLogger = OutputLogger.getInstance();