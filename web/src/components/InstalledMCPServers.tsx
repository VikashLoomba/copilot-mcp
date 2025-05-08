import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Terminal } from 'lucide-react';
import { useVscodeApi } from '../contexts/VscodeApiContext';
import { cn } from '@/lib/utils';

// Define the structure of a server object based on the example provided
interface McpServer {
  name: string;
  enabled?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  // Add any other properties that might exist
}

// McpConfig is not directly used in this component anymore after refactor, but keeping for potential future use or if other parts depend on this definition here.
// interface McpConfig {
//   servers: Record<string, McpServer>;
// }

const InstalledMCPServers: React.FC = () => {
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  const vscodeApi = useVscodeApi();

  useEffect(() => {
    // Ensure vscodeApi is available before trying to use it or set up listeners
    if (!vscodeApi) {
        // If API is not yet available (e.g. provider hasn't initialized, or in non-webview context where mock failed)
        // you might want to return or show a specific state. The hook should throw if it truly can't get an API.
        console.warn("VSCode API not available from context yet.");
        return;
    }

    // Request initial data
    vscodeApi.postMessage({ type: 'requestMCPConfigObject' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data; // The data VS Code sent
      switch (message.type) {
        case 'receivedMCPConfigObject':
          if (message.data && message.data.servers) {
            setServers(message.data.servers);
          }
          break;
        case 'error': // Handle potential errors from the backend
            console.error('Error from extension:', message.data?.message);
            // Optionally, display an error message to the user in the UI
            break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup listener on component unmount
    return () => {
      window.removeEventListener('message', handleMessage);
    };
    // Re-run effect if vscodeApi instance changes (though it shouldn't after initial load)
  }, [vscodeApi]); 

  const handleDeleteServer = (serverKey: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'deleteServer',
        key: serverKey,
      });
    } else {
        // This case should ideally not be reached if the hook and provider are working correctly
        console.error('VSCode API not available from context to delete server.');
    }
  };

  if (!vscodeApi) {
    return <p className="text-center  mt-4">Waiting for VSCode API...</p>;
  }

  if (Object.keys(servers).length === 0) {
    return <p className="text-center  mt-4">No MCP servers installed. Listening for updates...</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
      {Object.entries(servers).map(([key, server]) => (
        <Card
          key={key}
          className={cn(
            "bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)]",
            "hover:border-[var(--vscode-focusBorder)]/50 flex flex-col"
          )}
        >
          <CardHeader className="p-4">
            <div className="flex items-start justify-between gap-4">
              {/* Icon */}
              <div className="flex-shrink-0 pt-0.5"> {/* pt-0.5 to align icon slightly better with multi-line text */}
                <Terminal
                  size={28} // Increased icon size
                  className="text-[var(--vscode-debugIcon-startForeground)]"
                />
              </div>

              {/* Title/Type Block - flex-grow */}
              <div className="flex-grow min-w-0"> {/* min-w-0 for truncation */}
                <CardTitle className="text-base font-semibold truncate leading-tight">
                  {server.name || key}
                </CardTitle>
                {server.type && (
                  <CardDescription className="text-sm truncate leading-tight pt-1">
                    Type: {server.type}
                  </CardDescription>
                )}
              </div>

              {/* Delete Button */}
              <div className="flex-shrink-0">
                <Button
                  variant="ghost" // More subtle button variant
                  size="icon"
                  onClick={() => handleDeleteServer(key)}
                  aria-label={`Delete ${server.name || key} server`}
                  className={cn(
                    "h-8 w-8", // Slightly larger button
                    "text-[var(--vscode-icon-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]" // Themed
                  )}
                >
                  <Trash2 className="h-5 w-5" /> {/* Slightly larger trash icon */}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2 text-sm flex-grow"> {/* Adjusted padding */}
            <div className="space-y-4"> {/* Increased spacing between content sections */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider ">Command</span>
                <code className="block w-full truncate mt-0.5 px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] text-[var(--vscode-editor-foreground)] rounded font-mono text-xs">
                  {server.command}
                </code>
              </div>

              {server.args && server.args.length > 0 && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider ">Arguments</span>
                  <code className="block w-full truncate mt-0.5 px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] text-[var(--vscode-editor-foreground)] rounded font-mono text-xs">
                    {server.args.join(' ')}
                  </code>
                </div>
              )}

              {server.env && Object.keys(server.env).length > 0 && (
                <div> {/* Ensured this div is present for consistent spacing from space-y-4 */}
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-0.5">Environment Variables:</h4>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto p-1 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)]">
                    {Object.entries(server.env).map(([envKey, envValue]) => (
                      <div key={envKey} className="grid grid-cols-[auto_1fr] gap-x-2 text-xs items-center">
                        <span className="font-medium truncate text-[var(--vscode-editor-foreground)]">{envKey}:</span>
                        <span className="truncate ">
                          {envValue.includes('KEY') || envValue.includes('SECRET') ? '********' : envValue}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default InstalledMCPServers; 