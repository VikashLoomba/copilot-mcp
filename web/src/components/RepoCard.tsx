import React, { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, Code2, CalendarDays, BookText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVscodeApi } from "@/contexts/VscodeApiContext";
import { Messenger } from "vscode-messenger-webview";
import { aiAssistedSetupType, getReadmeType, cloudMCPInterestType, checkCloudMcpType } from "../../../src/shared/types/rpcTypes";
interface CloudMcpCheckResult {
  success: boolean;
  exists: boolean;
  installConfig?: {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    inputs: Array<{
      type: 'promptString';
      id: string;
      description: string;
      password: boolean;
    }>;
  };
  error?: string;
}

interface RepoCardProps {
  repo: any;
}

const RepoCard: React.FC<RepoCardProps> = ({ repo }) => {
  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  const [isLoading, setIsLoading] = useState(false);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [shouldShowInstallButton, setShouldShowInstallButton] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [readmeLoaded, setReadmeLoaded] = useState(false);
  const [isLoadingCloudMcp, setIsLoadingCloudMcp] = useState(true);
  const [cloudMcpDetails, setCloudMcpDetails] = useState<CloudMcpCheckResult | null>(null);

  // Fetch CloudMCP details on mount
  useEffect(() => {
    messenger.start();
    
    async function fetchCloudMcpDetails() {
      try {
        const result = await messenger.sendRequest(checkCloudMcpType, {
          type: 'extension'
        }, {
          repoUrl: repo.url,
          repoName: repo.name,
          repoFullName: repo.fullName
        });
        
        setCloudMcpDetails(result);
        setIsLoadingCloudMcp(false);
      } catch (error) {
        console.error("Failed to fetch CloudMCP details:", error);
        setCloudMcpDetails(null);
        setIsLoadingCloudMcp(false);
      }
    }
    
    fetchCloudMcpDetails();
  }, [messenger, repo.url, repo.name, repo.fullName]);

  // Check CloudMCP details whenever they change
  useEffect(() => {
    if (cloudMcpDetails && cloudMcpDetails.success && cloudMcpDetails.installConfig) {
      // We have installation config from CloudMCP, so we can show the install button
      setShouldShowInstallButton(true);
    }
  }, [cloudMcpDetails]);

  useEffect(() => {
    messenger.start();
    
    async function getReadme() {
      const result= await messenger.sendRequest(getReadmeType, {
        type: 'extension'
      },{
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner
      });
      if (result.fullName === repo.fullName) {
        setReadmeLoaded(true);
        if (result.readme) {
          setReadmeContent(result.readme);
          // Only check readme content if we don't have CloudMCP details with installConfig
          if (!cloudMcpDetails || !cloudMcpDetails.success || !cloudMcpDetails.installConfig) {
            const readmeLines = result.readme.replace(/\n/g, "");
            const showButton =
              readmeLines.includes(`"command": "uvx"`) ||
              readmeLines.includes(`"command": "npx"`) ||
              readmeLines.includes(`"command": "pypi"`) ||
              readmeLines.includes(`"command": "docker"`);
            setShouldShowInstallButton(showButton);
          }
        } else {
          setReadmeContent("");
          if (!cloudMcpDetails || !cloudMcpDetails.success || !cloudMcpDetails.installConfig) {
            setShouldShowInstallButton(false);
          }
        }
      }
    }
    getReadme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messenger]);

  // Helper function to format date (can be expanded)
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const fallbackName = repo.author.name.substring(0, 2).toUpperCase();

  // shouldShowInstallButton is now a state variable updated by useEffect

  const handleCloudMCPClick = () => {
    // Send telemetry event
    messenger.sendNotification(cloudMCPInterestType, {
      type: 'extension'
    }, {
      repoName: repo.fullName,
      repoOwner: repo.author.name,
      timestamp: new Date().toISOString()
    });
  };

  const handleInstallClick = async () => {
    setIsLoading(true);
    
    // Build install payload
    const installPayload: {
      repo: any;
      cloudMcpDetails?: CloudMcpCheckResult;
    } = {
      repo: { ...repo }
    };
    
    if (cloudMcpDetails && cloudMcpDetails.success && cloudMcpDetails.installConfig) {
      // We have CloudMCP installation config, include it in the payload
      installPayload.cloudMcpDetails = cloudMcpDetails;
    } else if (readmeContent) {
      // Fall back to readme content for LM parsing
      installPayload.repo.readme = readmeContent;
    } else {
      console.error("Neither CloudMCP details nor README content is available for install.");
      setIsLoading(false);
      return;
    }
    
    // Send install request
    const result = await messenger.sendRequest(aiAssistedSetupType, {
      type: 'extension'
    }, installPayload);
    
    if (result) {
      setIsLoading(false);
      setInstallError(false);
    } else {
      setIsLoading(false);
      setInstallError(true);
    }
  };

  return (
    <Card className="h-full flex flex-col shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out bg-[var(--vscode-editor-background)] border-[var(--vscode-editorWidget-border)]">
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Avatar className="h-10 w-10 border">
            <AvatarImage src={repo.author.avatarUrl} alt={repo.author.name} />
            <AvatarFallback>{fallbackName}</AvatarFallback>
          </Avatar>
          <div className="flex-grow">
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              <CardTitle className="text-lg break-all">
                {repo.fullName}
              </CardTitle>
            </a>
            <CardDescription className="text-xs pt-1">
              By: {repo.author.name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        <p className="text-sm  h-16 overflow-y-auto">
          {repo.description || "No description available."}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div className="flex items-center">
            <Star className="mr-1.5 h-4 w-4 text-yellow-500" />
            <span>{repo.stars.toLocaleString()} Stars</span>
          </div>
          <div className="flex items-center">
            <Code2 className="mr-1.5 h-4 w-4 text-blue-500" />
            <span>{repo.language || "N/A"}</span>
          </div>
          <div className="flex items-center">
            <CalendarDays className="mr-1.5 h-4 w-4 text-green-500" />
            <span>Last Updated: {formatDate(repo.updatedAt)}</span>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold mb-1 flex items-center">
            <BookText className="mr-1.5 h-4 w-4 " />
            README Snippet:
          </h4>
          <div className="text-xs p-2 border rounded-md max-h-24 overflow-y-auto prose prose-sm">
            {readmeLoaded ? (
              readmeContent ? (
                <ReactMarkdown
                  children={readmeContent}
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                />
              ) : (
                <p className="text-gray-500 italic">README unavailable</p>
              )
            ) : (
              <p>Loading README...</p>
            )}
          </div>
        </div>
      </CardContent>
      {!installError && (
        <CardFooter className="pt-2 pb-3 border-t space-x-2">
          <Button
            variant={"outline"}
            onClick={handleInstallClick}
            disabled={!shouldShowInstallButton || isLoading || isLoadingCloudMcp}
            className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingCloudMcp ? "Loading..." : isLoading ? "Installing..." : "Install"}
          </Button>
          <Button
            variant={"outline"}
            onClick={handleCloudMCPClick}
            className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] opacity-70 hover:opacity-100"
          >
            Deploy on CloudMCP.run
          </Button>
        </CardFooter>
      )}
      {/* Red button to indicate install error with "Retry Install" text */}
      {installError && (
        <CardFooter className="pt-2 pb-3 border-t space-x-2">
          <Button
            variant={"destructive"}
            onClick={handleInstallClick}
            className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)]"
          >
            Retry Install
          </Button>
          <Button
            variant={"outline"}
            onClick={handleCloudMCPClick}
            className="flex-1 bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)] opacity-70 hover:opacity-100"
          >
            Deploy on CloudMCP.run
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};

export default RepoCard;
