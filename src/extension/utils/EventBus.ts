/**
 * Type for event handlers
 */
type EventHandler = (data: any) => void;

/**
 * Simple event bus for component communication
 */
export class EventBus {
    private static instance: EventBus;
    private listeners: Map<string, EventHandler[]> = new Map();
    
    /**
     * Get the singleton instance
     */
    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
    
    /**
     * Subscribe to an event
     * @param event Event name
     * @param handler Handler function
     * @returns Disposable to unsubscribe
     */
    public on(event: string, handler: EventHandler): { dispose: () => void } {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        
        const handlers = this.listeners.get(event)!;
        handlers.push(handler);
        
        return {
            dispose: () => {
                const index = handlers.indexOf(handler);
                if (index !== -1) {
                    handlers.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * Emit an event
     * @param event Event name
     * @param data Event data
     */
    public emit(event: string, data: any = {}): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            }
        }
    }
    
    /**
     * Clear all listeners
     */
    public clearAll(): void {
        this.listeners.clear();
    }
}