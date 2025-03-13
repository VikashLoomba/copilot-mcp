import React, { useState, useEffect } from "react";
import { 
  ChevronRight, 
  Edit, 
  Trash, 
  Terminal, 
  Globe, 
  AlertCircle,
  Info, 
  Copy,
  Plus,
  X,
  ListTree,
  Layers,
  ExternalLink
} from "lucide-react";

import { cn } from "./lib/utils";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import {
  Card,
  CardHeader,
} from "./components/ui/card";
import { Switch } from "./components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible";
import { Badge } from "./components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { ScrollArea } from "./components/ui/scroll-area";

import { ServerWithTools, ServerType, EnvVar } from "./types";

type ServerCardProps = React.ComponentProps<typeof Card> & {
  server: ServerWithTools;
  onUpdate?: () => void;
  onRemove?: (serverName: string) => void;
};

export const ServerCard = ({ className, server, onUpdate, onRemove }: ServerCardProps) => {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(server.name);
  const [editType, setEditType] = useState<ServerType>(server.type || ServerType.PROCESS);
  const [editCommand, setEditCommand] = useState(server.command || '');
  const [editUrl, setEditUrl] = useState(server.url || '');
  const [editAuthToken, setEditAuthToken] = useState(server.authToken || '');
  const [editEnvVars, setEditEnvVars] = useState<EnvVar[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Force rerenders when toggle is clicked
  const [localEnabled, setLocalEnabled] = useState(server.enabled);

  const validateServerName = (name: string): boolean => {
    return /^[a-zA-Z0-9_-]+$/.test(name);
  };

  const escapeCommand = (command: string): string => {
    // Replace single quotes with escaped single quotes
    // Replace double quotes with escaped double quotes
    return command.replace(/'/g, "\\'").replace(/"/g, '\\"');
  };

  // Update local state when server prop changes
  useEffect(() => {
    setLocalEnabled(server.enabled);
  }, [server.enabled]);

  // Reset edit fields when server changes or editing starts
  useEffect(() => {
    if (isEditing) {
      console.log('Setting edit fields:', { 
        name: server.name, 
        command: server.command, 
        url: server.url 
      });
      
      setEditName(server.name);
      setEditType(server.type || ServerType.PROCESS);
      setEditCommand(server.command || '');
      setEditUrl(server.url || '');
      setEditAuthToken(server.authToken || '');
      
      // Convert env object to array for editing
      if (server.env) {
        setEditEnvVars(Object.entries(server.env).map(([key, value]) => ({ key, value })));
      } else {
        setEditEnvVars([]);
      }
    }
  }, [isEditing, server]);

  const handleToggleServer = (enabled: boolean) => {
    console.log(`Toggling server ${server.name} to ${enabled ? 'enabled' : 'disabled'}`);
    
    // Update local state immediately for responsive UI
    setLocalEnabled(enabled);
    
    // Post message to VSCode extension
    window.vscodeApi.postMessage({
      type: 'toggleServer',
      name: server.name,
      enabled
    });
  };

  const handleRemoveServer = () => {
    window.vscodeApi.postMessage({
      type: 'removeServer',
      name: server.name
    });
    
    setShowDeleteConfirm(false);
    if (onRemove) {
      onRemove(server.name);
    }
  };

  const handleEditServer = () => {
    // If not in edit mode, switch to edit mode and initialize form values
    if (!isEditing) {
      setIsEditing(true);
      setIsExpanded(true);
      
      // Set form values directly here as well as in the useEffect
      setEditName(server.name);
      setEditType(server.type || ServerType.PROCESS);
      setEditCommand(server.command || '');
      setEditUrl(server.url || '');
      setEditAuthToken(server.authToken || '');
      
      // Convert env object to array for editing
      if (server.env) {
        setEditEnvVars(Object.entries(server.env).map(([key, value]) => ({ key, value })));
      } else {
        setEditEnvVars([]);
      }
      
      return;
    }

    // Validate required fields
    if (!editName.trim()) {
      setFormError('Server name is required');
      return;
    }

    if (!validateServerName(editName)) {
      setFormError('Server name can only contain letters, numbers, dashes, and underscores');
      return;
    }

    if (editType === ServerType.PROCESS && !editCommand.trim()) {
      setFormError('Command is required for process servers');
      return;
    }

    if (editType === ServerType.SSE && !editUrl.trim()) {
      setFormError('URL is required for SSE servers');
      return;
    }

    // Create updates object based on server type
    let updates: any = {
      name: editName.trim(),
      type: editType,
      originalName: server.name
    };

    if (editType === ServerType.PROCESS) {
      // Convert editEnvVars array to object
      const env = editEnvVars.reduce((acc, { key, value }) => {
        if (key.trim()) {
          // Make sure to trim both key and value to avoid whitespace issues
          acc[key.trim()] = value.trim();
        }
        return acc;
      }, {} as { [key: string]: string });

      updates = {
        ...updates,
        command: escapeCommand(editCommand.trim()),
        env
      };
      
      // Log the environment variables being sent
      console.log('Environment variables being updated:', env);
    } else {
      updates = {
        ...updates,
        url: editUrl.trim(),
        authToken: editAuthToken
      };
    }

    // Send update to VS Code
    window.vscodeApi.postMessage({
      type: 'editServer',
      server: updates
    });

    // Exit edit mode
    setIsEditing(false);
    setFormError(null);
    
    if (onUpdate) {
      onUpdate();
    }
  };

  const handleCancel = () => {
    setEditName(server.name);
    setEditType(server.type || ServerType.PROCESS);
    setEditCommand(server.command || '');
    setEditUrl(server.url || '');
    setEditAuthToken(server.authToken || '');
    setEditEnvVars([]);
    setIsEditing(false);
    setFormError(null);
  };

  const addEnvVar = () => {
    setEditEnvVars([...editEnvVars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEditEnvVars(editEnvVars.filter((_, i) => i !== index));
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...editEnvVars];
    newEnvVars[index][field] = value;
    setEditEnvVars(newEnvVars);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Using window.vscodeApi to send message to show VSCode notification
      window.vscodeApi.postMessage({
        type: 'showNotification',
        message: `${label} copied to clipboard`,
      });
    });
  };

  // Server type icon and status indicators
  const serverType = server.type || ServerType.PROCESS;
  const TypeIcon = serverType === ServerType.SSE ? Globe : Terminal;
  const toolsCount = server.tools?.length || 0;
  const envVarsCount = server.env ? Object.keys(server.env).length : 0;

  // Render the edit form for a server
  const renderEditForm = () => (
    <div className="mt-4 space-y-4">
      {formError && (
        <div className="p-3 rounded bg-[var(--vscode-errorForeground)]/10 text-[var(--vscode-errorForeground)] text-sm">
          {formError}
        </div>
      )}
      
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={`edit-name-${server.name}`}>Server Name</Label>
          <Input
            id={`edit-name-${server.name}`}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
          />
        </div>
        
        <div className="space-y-2">
          <Label>Server Type</Label>
          <div className="flex space-x-4">
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id={`type-process-${server.name}`}
                checked={editType === ServerType.PROCESS}
                onChange={() => setEditType(ServerType.PROCESS)}
                className="accent-[var(--vscode-focusBorder)]"
              />
              <Label htmlFor={`type-process-${server.name}`} className="cursor-pointer">Process (Local)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id={`type-sse-${server.name}`}
                checked={editType === ServerType.SSE}
                onChange={() => setEditType(ServerType.SSE)}
                className="accent-[var(--vscode-focusBorder)]"
              />
              <Label htmlFor={`type-sse-${server.name}`} className="cursor-pointer">SSE (Remote)</Label>
            </div>
          </div>
        </div>
        
        {editType === ServerType.PROCESS ? (
          <>
            <div className="space-y-2">
              <Label htmlFor={`edit-command-${server.name}`}>Start Command</Label>
              <Input
                id={`edit-command-${server.name}`}
                value={editCommand}
                onChange={(e) => setEditCommand(e.target.value)}
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
              
              <ScrollArea className="max-h-[200px] overflow-y-auto">
                <div className="space-y-2">
                  {editEnvVars.map((envVar, index) => (
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
                        className="h-10 w-10 flex-shrink-0 text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-errorForeground)]/10"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={`edit-url-${server.name}`}>Server URL</Label>
              <Input
                id={`edit-url-${server.name}`}
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="font-mono text-sm bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor={`edit-auth-${server.name}`}>Authentication Token (Optional)</Label>
              <Input
                id={`edit-auth-${server.name}`}
                type="password"
                value={editAuthToken}
                onChange={(e) => setEditAuthToken(e.target.value)}
                className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)]"
              />
            </div>
          </>
        )}
      </div>
      
      <div className="flex justify-end space-x-2 mt-6 pt-2 border-t border-[var(--vscode-widget-border)]">
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          className="border-[var(--vscode-button-border)]"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleEditServer}
          className="bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
        >
          Save Changes
        </Button>
      </div>
    </div>
  );

  // Render the compact header of the card
  const renderCardHeader = () => (
    <div className="flex items-center justify-between gap-3 group w-full">
      {/* Left side with chevron, icon and server info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center w-6">
          <ChevronRight 
            className={cn(
              "h-4 w-4 text-[var(--vscode-descriptionForeground)] transition-transform duration-200",
              isExpanded && "rotate-90 text-[var(--vscode-focusBorder)]"
            )} 
          />
        </div>
        
        <div className="flex-shrink-0 flex items-center justify-center w-6">
          <TypeIcon 
            size={16} 
            className={cn(
              localEnabled 
                ? "text-[var(--vscode-debugIcon-startForeground)]" 
                : "text-[var(--vscode-descriptionForeground)]"
            )} 
          />
        </div>
        
        <div className="flex-1 min-w-0 mr-2">
          <h3 className="text-sm font-medium truncate leading-tight">
            {server.name}
          </h3>
          <p className="text-xs text-[var(--vscode-descriptionForeground)] truncate leading-tight">
            {serverType === ServerType.PROCESS ? 
              server.command : 
              server.url}
          </p>
        </div>
      </div>
      
      {/* Right side with badges and switch */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {toolsCount > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline"
                  className="text-xs font-normal h-6 bg-[var(--vscode-badge-background)]/10 hover:bg-[var(--vscode-badge-background)]/20 text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]/30"
                >
                  <Layers className="h-3 w-3 mr-1 opacity-70" />
                  {toolsCount}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{toolsCount} tools available</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        <Badge 
          variant={localEnabled ? "default" : "outline"} 
          className={cn(
            "text-xs py-0.5 px-2 h-6 min-w-14 flex items-center justify-center",
            localEnabled 
              ? "bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] hover:bg-[var(--vscode-badge-background)]" 
              : "text-[var(--vscode-descriptionForeground)] border-[var(--vscode-widget-border)]"
          )}
        >
          {serverType === ServerType.SSE ? 'SSE' : 'Process'}
        </Badge>
        
        <Switch 
          checked={localEnabled}
          onCheckedChange={handleToggleServer}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
          aria-label="Toggle server"
        />
      </div>
    </div>
  );
  
  // Render the expanded content of the card
  const renderExpandedContent = () => (
    <div className="space-y-4 pt-4 mt-2 border-t border-[var(--vscode-widget-border)]">
      {/* Server configuration section */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          Configuration
        </h4>
        
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-start text-sm">
          <span className="text-[var(--vscode-descriptionForeground)]">Type:</span>
          <div className="flex items-center">
            <Badge 
              variant="outline" 
              className="w-fit border-[var(--vscode-badge-background)]/30 text-[var(--vscode-badge-foreground)] bg-[var(--vscode-badge-background)]/10"
            >
              {serverType === ServerType.SSE ? (
                <div className="flex items-center gap-1">
                  <Globe className="h-3 w-3" /> SSE
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Terminal className="h-3 w-3" /> Process
                </div>
              )}
            </Badge>
          </div>
          
          {serverType === ServerType.PROCESS ? (
            <>
              
            </>
          ) : (
            <>
              <span className="text-[var(--vscode-descriptionForeground)]">URL:</span>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <div className="group flex items-center gap-1 cursor-pointer">
                    <code className="px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded font-mono text-xs overflow-x-auto">
                      {server.url}
                    </code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard(server.url || '', 'URL')}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto max-w-md">
                  <div className="flex justify-between items-center">
                    <p className="text-xs">Server URL endpoint</p>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6"
                      onClick={() => window.open(server.url, '_blank')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </HoverCardContent>
              </HoverCard>
              
              {server.authToken && (
                <>
                  <span className="text-[var(--vscode-descriptionForeground)]">Auth Token:</span>
                  <div className="flex items-center gap-1">
                    <div className="px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded font-mono text-xs">
                      •••••••••••••••••
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(server.authToken || '', 'Authentication token')}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Environment variables section */}
      {serverType === ServerType.PROCESS && server.env && Object.keys(server.env).length > 0 && (
        <Collapsible 
          open={showEnvVars} 
          onOpenChange={setShowEnvVars} 
          className="border border-[var(--vscode-widget-border)] rounded p-2"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between p-1 hover:bg-[var(--vscode-list-hoverBackground)] rounded">
            <div className="flex items-center gap-2">
              <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", showEnvVars && "rotate-90")} />
              <h4 className="text-xs font-medium">
                Environment Variables <span className="text-[var(--vscode-descriptionForeground)]">({Object.keys(server.env).length})</span>
              </h4>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="pt-2 space-y-2">
            <ScrollArea className="max-h-[150px]">
              <div className="grid grid-cols-[1fr_1fr] gap-1 text-xs">
                {Object.entries(server.env).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <div className="font-medium truncate px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded-l group hover:bg-[var(--vscode-editor-inactiveSelectionBackground)]/70 cursor-default">
                      {key}
                    </div>
                    <div className="truncate text-[var(--vscode-descriptionForeground)] px-2 py-1 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded-r group hover:bg-[var(--vscode-editor-inactiveSelectionBackground)]/70 cursor-default">
                      {value}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}
      
      {/* Tools section */}
      {server.tools && server.tools.length > 0 && (
        <Collapsible 
          open={showTools} 
          onOpenChange={setShowTools} 
          className="border border-[var(--vscode-widget-border)] rounded p-2"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between p-1 hover:bg-[var(--vscode-list-hoverBackground)] rounded">
            <div className="flex items-center gap-2">
              <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", showTools && "rotate-90")} />
              <h4 className="text-xs font-medium">
                Available Tools <span className="text-[var(--vscode-descriptionForeground)]">({server.tools.length})</span>
              </h4>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="pt-2 space-y-1">
            <ScrollArea className="max-h-[200px]">
              {server.tools.map((tool) => (
                <Collapsible
                  key={tool.name}
                  open={expandedTool === tool.name}
                  onOpenChange={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                >
                  <CollapsibleTrigger className="flex w-full items-center p-1 gap-2 hover:bg-[var(--vscode-list-hoverBackground)] rounded text-left">
                    <ChevronRight className={cn("h-3 w-3 transition-transform duration-200", expandedTool === tool.name && "rotate-90")} />
                    <div className="flex items-center gap-2">
                      <ListTree className="h-3 w-3 text-[var(--vscode-textLink-foreground)]" />
                      <span className="text-xs font-medium">{tool.name}</span>
                    </div>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent className="pl-6 pr-2 py-2">
                    <div className="text-xs text-[var(--vscode-descriptionForeground)] border-l-2 border-[var(--vscode-widget-border)] pl-2 space-y-2">
                      <p>{tool.description}</p>
                      <div className="pt-1">
                        <div className="text-[0.65rem] uppercase font-semibold text-[var(--vscode-descriptionForeground)] mb-1">Schema</div>
                        <pre className="overflow-x-auto bg-[var(--vscode-editor-inactiveSelectionBackground)] p-2 rounded text-[0.7rem] max-h-[150px]">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}
      
      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--vscode-widget-border)]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleEditServer()}
          className="text-xs border-[var(--vscode-button-border)]"
        >
          <Edit className="h-3.5 w-3.5 mr-1.5" /> Edit
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          className="text-xs bg-[var(--vscode-errorForeground)]/80 hover:bg-[var(--vscode-errorForeground)] text-white"
        >
          <Trash className="h-3.5 w-3.5 mr-1.5" /> Remove
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Card
        className={cn(
          "w-full h-auto overflow-hidden group transition-all duration-200",
          "bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)]",
          "hover:shadow-sm hover:border-[var(--vscode-focusBorder)]/50",
          isExpanded && "border-[var(--vscode-focusBorder)]/70",
          className
        )}
      >
        <CardHeader className="p-3">
          <Collapsible 
            open={isExpanded || isEditing} 
            onOpenChange={isEditing ? undefined : setIsExpanded}
          >
            <CollapsibleTrigger 
              asChild
              disabled={isEditing}
            >
              <div className={cn(
                "cursor-pointer w-full",
                !isEditing && "hover:bg-[var(--vscode-list-hoverBackground)] rounded p-1"
              )}>
                {renderCardHeader()}
              </div>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              {isEditing ? renderEditForm() : renderExpandedContent()}
            </CollapsibleContent>
          </Collapsible>
        </CardHeader>
      </Card>
      
      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-[400px] bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)]">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-[var(--vscode-errorForeground)]" />
              Remove Server
            </DialogTitle>
            <DialogDescription className="text-[var(--vscode-descriptionForeground)]">
              Are you sure you want to remove the server "{server.name}"?
            </DialogDescription>
          </DialogHeader>
          
          <div className="bg-[var(--vscode-errorForeground)]/10 p-3 rounded flex items-start gap-2 my-2">
            <Info className="h-4 w-4 text-[var(--vscode-errorForeground)] mt-0.5 flex-shrink-0" />
            <p className="text-sm text-[var(--vscode-errorForeground)]">
              This action cannot be undone. The server will be removed from your configuration.
            </p>
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              className="border-[var(--vscode-button-border)]"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveServer}
              className="bg-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-errorForeground)]/90 text-white"
            >
              Remove Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};