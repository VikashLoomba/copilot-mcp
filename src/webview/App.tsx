import React, { useState, useEffect } from 'react';
import './styles/globals.css';
import { ServerConfig, ServerWithTools, ServerType, EnvVar } from './types';
import { ServerCard } from './ServerCard';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { ScrollArea } from "./components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Plus, X, Search, FilePlus, FileEdit, ServerIcon } from 'lucide-react';

declare global {
  interface Window {
    vscodeApi?: any;
  }
}

// Using the EnvVar interface from types.ts

const handleWebviewMessage = (event: MessageEvent) => {
  const message = event.data;
  switch (message.type) {
    case 'setServers':
      console.log('Setting servers:', message.servers);
      return message.servers;
    case 'updateServer':
      return (current: ServerWithTools[]) => 
        current.map(server => 
          server.name === message.server.name 
            ? { ...server, ...message.server, tools: message.tools || server.tools, enabled: message.running || server.enabled }
            : server
        );
    case 'updateServerTools':
      return (current: ServerWithTools[]) =>
        current.map(server =>
          server.name === message.name
            ? { ...server, tools: message.tools, enabled: message.running }
            : server
        );
    case 'serverAdded':
      // Show success message when we receive confirmation
      toast.success("Server added successfully", {
        description: `"${message.serverName}" has been added to your servers.`,
      });
      return undefined;
    case 'serverAddError':
      // Show error message if server addition failed
      toast.error("Failed to add server", {
        description: message.error || "An unexpected error occurred.",
      });
      return undefined;
    case 'serverEdited':
      // Show success message when we receive confirmation of edit
      if (message.originalName && message.serverName !== message.originalName) {
        toast.success("Server updated successfully", {
          description: `"${message.originalName}" has been updated and renamed to "${message.serverName}".`,
        });
      } else {
        toast.success("Server updated successfully", {
          description: `"${message.serverName}" has been updated.`,
        });
      }
      return undefined;
    case 'serverEditError':
      // Show error message if server edit failed
      toast.error("Failed to update server", {
        description: message.error || "An unexpected error occurred.",
      });
      return undefined;
    default:
      return undefined;
  }
};

export function App() {
  const [servers, setServers] = useState<ServerWithTools[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverType, setServerType] = useState<ServerType>(ServerType.PROCESS);
  const [serverCommand, setServerCommand] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverAuthToken, setServerAuthToken] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const validateServerName = (name: string): boolean => {
    return /^[a-zA-Z0-9_-]+$/.test(name);
  };

  const escapeCommand = (command: string): string => {
    // Replace single quotes with escaped single quotes
    // Replace double quotes with escaped double quotes
    return command.replace(/'/g, "\\'").replace(/"/g, '\\"');
  };

  useEffect(() => {
    // Listen for messages from the extension
    const messageHandler = (event: MessageEvent) => {
      const result = handleWebviewMessage(event);
      if (typeof result === 'function') {
        setServers(result);
      } else if (Array.isArray(result)) {
        setServers(result);
      }
    };

    window.addEventListener('message', messageHandler);

    // Request initial server list
    window.vscodeApi.postMessage({ type: 'getServers' });

    return () => {
      window.removeEventListener('message', messageHandler);
    }
  }, []);

  const resetForm = () => {
    setServerName('');
    setServerType(ServerType.PROCESS);
    setServerCommand('');
    setServerUrl('');
    setServerAuthToken('');
    setEnvVars([]);
    setFormError(null);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    resetForm();
  };

  const handleAddServer = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    // Validate inputs
    if (!serverName.trim()) {
      setFormError('Server name is required');
      return;
    }
    
    if (!validateServerName(serverName)) {
      setFormError('Server name can only contain letters, numbers, dashes, and underscores');
      return;
    }
    
    if (serverType === ServerType.PROCESS && !serverCommand.trim()) {
      setFormError('Command is required for process servers');
      return;
    }
    
    if (serverType === ServerType.SSE && !serverUrl.trim()) {
      setFormError('URL is required for SSE servers');
      return;
    }

    // Convert envVars array to object
    const env = envVars.reduce((acc, { key, value }) => {
      if (key.trim()) {
        // Make sure to trim both key and value to avoid whitespace issues
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {} as { [key: string]: string });
    
    // Log the environment variables for debugging
    console.log('Environment variables being added:', env);

    // Prepare server config based on type
    const serverConfig: Partial<ServerConfig> = {
      name: serverName.trim(),
      enabled: true,
      type: serverType,
    };

    if (serverType === ServerType.PROCESS) {
      serverConfig.command = escapeCommand(serverCommand.trim());
      
    } else {
      serverConfig.url = serverUrl.trim();
      serverConfig.authToken = serverAuthToken;
    }
    // Only include env vars if there are actually keys defined
    if (Object.keys(env).length > 0) {
      serverConfig.env = env;
    }

    // Send to extension
    window.vscodeApi.postMessage({
      type: 'addServer',
      server: serverConfig
    });

    // We no longer show success message here, we'll wait for confirmation
    // from the extension before showing success message

    // Close modal and reset form
    handleCloseModal();
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars];
    newEnvVars[index][field] = value;
    setEnvVars(newEnvVars);
  };

  const filteredServers = servers.filter(server => 
    server.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      <Toaster position="top-right" richColors closeButton />
      <div className="mx-auto w-full max-w-[1200px] p-4">
        <div className="flex flex-col space-y-4">
          {/* Header bar with title, search, and add button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
            <div className="flex items-center space-x-2">
              <ServerIcon className="h-5 w-5 text-[var(--vscode-textLink-foreground)]" />
              <h1 className="text-xl font-semibold">MCP Server Manager</h1>
            </div>
            
            <div className="flex flex-1 sm:flex-row items-center gap-3 sm:justify-end">
              {/* Search and filter bar */}
              <div className="relative flex-1 max-w-md">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <Search className="h-4 w-4 text-[var(--vscode-descriptionForeground)]" />
                </div>
                <Input
                  type="text"
                  placeholder="Filter servers..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full pl-10 h-9 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                />
                {filterQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFilterQuery('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-1 hover:bg-transparent"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      onClick={() => setIsAddModalOpen(true)}
                      className="h-9 whitespace-nowrap bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Server
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Add a new MCP server</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          
          {/* Server grid with responsive layout */}
          <div className="mt-4">
            {filteredServers.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 border border-[var(--vscode-widget-border)] rounded-lg bg-[var(--vscode-editor-background)] text-[var(--vscode-descriptionForeground)]">
                {servers.length === 0 ? (
                  <>
                    <FilePlus className="h-12 w-12 mb-4 opacity-40" />
                    <h3 className="text-lg font-medium">No servers configured</h3>
                    <p className="mt-2 text-center max-w-md">
                      Add your first MCP server by clicking the "Add Server" button
                    </p>
                    <Button 
                      onClick={() => setIsAddModalOpen(true)}
                      className="mt-6 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Server
                    </Button>
                  </>
                ) : (
                  <>
                    <FileEdit className="h-12 w-12 mb-4 opacity-40" />
                    <h3 className="text-lg font-medium">No matching servers</h3>
                    <p className="mt-2 text-center">
                      No servers match your filter criteria
                    </p>
                    <Button 
                      onClick={() => setFilterQuery('')}
                      variant="outline" 
                      className="mt-6 border-[var(--vscode-button-border)]"
                    >
                      Clear filter
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-180px)] pr-4">
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                  {filteredServers.map(server => (
                    <ServerCard
                      key={server.name}
                      server={server}
                      onUpdate={() => {
                        toast.success("Server updated", {
                          description: `"${server.name}" has been updated successfully.`
                        });
                      }}
                      onRemove={(name) => {
                        toast.success("Server removed", {
                          description: `"${name}" has been removed from your servers.`
                        });
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>
      
      {/* Add Server Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent 
          className="bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)]"
          onInteractOutside={(e) => {
            e.preventDefault(); 
            // Only allow closing via the explicit buttons
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add MCP Server
            </DialogTitle>
            <DialogDescription className="text-[var(--vscode-descriptionForeground)]">
              Configure a new MCP server to use with Copilot Chat
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleAddServer} className="space-y-4 mt-2">
            {formError && (
              <div className="p-3 rounded bg-[var(--vscode-errorForeground)]/10 text-[var(--vscode-errorForeground)] text-sm">
                {formError}
              </div>
            )}
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="server-name">Server Name</Label>
                <Input
                  id="server-name"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder="My MCP Server"
                  className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Server Type</Label>
                <div className="flex space-x-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="type-process"
                      checked={serverType === ServerType.PROCESS}
                      onChange={() => setServerType(ServerType.PROCESS)}
                      className="accent-[var(--vscode-focusBorder)]"
                    />
                    <Label htmlFor="type-process" className="cursor-pointer">Process (Local)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="type-sse"
                      checked={serverType === ServerType.SSE}
                      onChange={() => setServerType(ServerType.SSE)}
                      className="accent-[var(--vscode-focusBorder)]"
                    />
                    <Label htmlFor="type-sse" className="cursor-pointer">SSE (Remote)</Label>
                  </div>
                </div>
              </div>
              
              {serverType === ServerType.PROCESS ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-command">Start Command</Label>
                    <Input
                      id="server-command"
                      value={serverCommand}
                      onChange={(e) => setServerCommand(e.target.value)}
                      placeholder="python -m mcp_server"
                      className="font-mono text-sm bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label>Environment Variables</Label>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addEnvVar}
                        size="sm"
                        className="h-7 text-xs border-[var(--vscode-button-border)]"
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Variable
                      </Button>
                    </div>
                    
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {envVars.map((envVar, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            value={envVar.key}
                            onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                            placeholder="KEY"
                            className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                          />
                          <Input
                            value={envVar.value}
                            onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                            placeholder="value"
                            className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeEnvVar(index)}
                            className="h-10 w-10 text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-errorForeground)]/10"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-url">Server URL</Label>
                    <Input
                      id="server-url"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="https://your-mcp-server.example.com/events"
                      className="font-mono text-sm bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="auth-token">Authentication Token (Optional)</Label>
                    <Input
                      id="auth-token"
                      type="password"
                      value={serverAuthToken}
                      onChange={(e) => setServerAuthToken(e.target.value)}
                      placeholder="••••••••••••••••••••"
                      className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
                    />
                  </div>
                </>
              )}
            </div>
            
            <DialogFooter className="mt-6 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseModal}
                className="border-[var(--vscode-button-border)]"
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                className="bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
              >
                Add Server
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}