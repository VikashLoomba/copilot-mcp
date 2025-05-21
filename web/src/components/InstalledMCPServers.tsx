import React, { useEffect, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Info, Terminal, Trash2Icon } from "lucide-react";
import { useVscodeApi } from "../contexts/VscodeApiContext";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Messenger } from "vscode-messenger-webview";
import { deleteServerType, getMcpConfigType, updateMcpConfigType, updateServerEnvVarType } from "../../../src/shared/types/rpcTypes";

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
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  // const [isEditing] = useState(false);
  // const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeServerName, setActiveServerName] = useState<string | null>(null);
  const [serverToDelete, setServerToDelete] = useState<McpServer | null>(null);
  

  useEffect(() => {
    messenger.start();
    async function getMcpConfig() {
      const result: any = await messenger.sendRequest(getMcpConfigType, {
        type: 'extension'
      });
      setServers(result.servers);
    }
    getMcpConfig();

    messenger.onNotification(updateMcpConfigType, (payload) => {
      setServers((payload.servers as any));
    });
  }, [messenger]);

  const handleEnvVarChange = (serverName: string, envKey: string, newValue: string) => {
    setServers(prevServers => {
      const serverToUpdate = prevServers[serverName];
      if (!serverToUpdate) return prevServers;

      const updatedEnv = { ...(serverToUpdate.env || {}), [envKey]: newValue };
      const updatedServer = { ...serverToUpdate, env: updatedEnv };

      return {
        ...prevServers,
        [serverName]: updatedServer,
      };
    });
    if (messenger) {
      messenger.sendNotification(updateServerEnvVarType, {
        type: 'extension',
      }, {
        serverName,
        envKey,
        newValue
      });
    } else {
      console.error("VSCode API not available to update env var.");
    }
  };

  const handleDeleteServer = (serverKey: string) => {
    if(messenger) {
        messenger.sendNotification(deleteServerType, {type: 'extension'}, {serverName: serverKey})
    }
  };

  if (!vscodeApi) {
    return <p className="text-center  mt-4">Waiting for VSCode API...</p>;
  }

  if (Object.keys(servers).length === 0) {
    return (
      <p className="text-center  mt-4">
        No MCP servers installed. Listening for updates...
      </p>
    );
  }

  const renderCardHeader = (name: string, serverConfig: McpServer) => (
    <div className="flex items-center justify-between gap-3 group w-full">
      {/* Left side with chevron, icon and server info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center w-6">
          <Terminal
            size={16}
            className={cn("text-[var(--vscode-debugIcon-startForeground)]")}
          />
        </div>

        <div className="flex-1 min-w-0 mr-2">
          <h3 className="text-sm font-medium truncate leading-tight">
            {name}
          </h3>
          <p className="text-xs text-[var(--vscode-descriptionForeground)] truncate leading-tight">
            {serverConfig.command
              ? `${serverConfig.command} ${
                  serverConfig.args ? serverConfig.args.join(" ") : ""
                }`
              : null}
          </p>
        </div>
      </div>

      {/* Right side with badges and switch */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge
          variant={"default"}
          className={cn(
            "text-xs py-0.5 px-2 h-6 min-w-14 flex items-center justify-center",
            "bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] hover:bg-[var(--vscode-badge-background)]"
          )}
        >
          {serverConfig.command && "Process"}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
      {Object.entries(servers).map(([name, server], index) => (
        <React.Fragment key={`${name}-${index}`}>
          <Card
            className={cn(
              "w-full h-auto overflow-hidden group transition-all duration-500",
              "bg-[var(--vscode-editor-background)] border-[var(--vscode-editorWidget-border)]",
              "hover:shadow-sm hover:border-[var(--vscode-focusBorder)]/50"
            )}
          >
            <CardHeader className="p-3">
              <Collapsible open={activeServerName === name}>
                <CollapsibleTrigger asChild>
                  <div
                    className={cn(
                      "cursor-pointer w-full transition-all duration-500",
                      activeServerName !== name &&
                        "hover:bg-[var(--vscode-list-hoverBackground)]/50 rounded p-1"
                    )}
                    onClick={() =>
                      setActiveServerName((prev) =>
                        prev === name ? null : name
                      )
                    }
                  >
                    {renderCardHeader(name, server)}
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                {server.env && Object.keys(server.env).length > 0 && (
                    <div className="mt-2">
                      <h4 className="text-xs font-medium text-[var(--vscode-foreground)] mb-1.5 px-1">
                        Environment Variables
                      </h4>
                      <div className="space-y-1.5 px-1">
                        {Object.entries(server.env).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <Label
                              htmlFor={`${name}-${key}-env`}
                              className="text-xs text-[var(--vscode-descriptionForeground)] w-2/5 sm:w-1/3 flex-shrink-0 truncate"
                              title={key}
                            >
                              {key}
                            </Label>
                            <Input
                              id={`${name}-${key}-env`}
                              type="text"
                              value={value}
                              onChange={(e) => handleEnvVarChange(name, key, e.target.value)}
                              className="flex-grow h-7 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-[var(--vscode-input-border)] focus-visible:ring-1 focus-visible:ring-[var(--vscode-focusBorder)] rounded-sm shadow-none px-2 py-1"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button
                    variant={"link"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setServerToDelete({...server, name});
                    }}
                    className="text-[var(--vscode-errorForeground)] hover:text-[var(--vscode-errorForeground)]/80 p-1 mt-2 flex items-center gap-1"
                  >
                    <Trash2Icon size={16} /> Delete
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            </CardHeader>
          </Card>

          {/* Delete confirmation dialog */}
          <Dialog
            open={!!serverToDelete}
            onOpenChange={(isOpen) => {
              if (!isOpen) setServerToDelete(null);
            }}
          >
            <DialogContent className="max-w-[400px] bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)]">
              <DialogHeader>
                <DialogTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-[var(--vscode-errorForeground)]" />
                  Remove Server
                </DialogTitle>
                <DialogDescription className="text-[var(--vscode-descriptionForeground)]">
                  Are you sure you want to remove the server "
                  {serverToDelete?.name}"?
                </DialogDescription>
              </DialogHeader>

              <div className="bg-[var(--vscode-errorForeground)]/10 p-3 rounded flex items-start gap-2 my-2">
                <Info className="h-4 w-4 text-[var(--vscode-errorForeground)] mt-0.5 flex-shrink-0" />
                <p className="text-sm text-[var(--vscode-errorForeground)]">
                  This action cannot be undone. The server will be removed from
                  your configuration.
                </p>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setServerToDelete(null)}
                  className="bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)]"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (serverToDelete) {
                      handleDeleteServer(serverToDelete.name);
                      if (activeServerName === serverToDelete.name) {
                        setActiveServerName(null);
                      }
                      setServerToDelete(null);
                    }
                  }}
                  className="bg-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-errorForeground)]/90 text-white"
                >
                  Remove Server
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </React.Fragment>
      ))}
    </div>
  );
};

export default InstalledMCPServers;
