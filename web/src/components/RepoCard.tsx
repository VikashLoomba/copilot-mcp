import React, { useState } from "react";
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

// Define an interface for the McpServerAuthor, mirroring the one in SearchMCPServers.tsx
interface McpServerAuthor {
  name: string;
  profileUrl: string;
  avatarUrl: string;
}

// Define an interface for the SearchResult, mirroring the one in SearchMCPServers.tsx
// Ideally, this would be in a shared types file
interface SearchResult {
  id: number;
  url: string;
  name: string;
  fullName: string;
  stars: number;
  author: McpServerAuthor;
  description: string | null;
  readme: string;
  language: string | null;
  updatedAt: string;
}

interface RepoCardProps {
  repo: SearchResult;
}

const RepoCard: React.FC<RepoCardProps> = ({ repo }) => {
  const [isLoading, setIsLoading] = useState(false);
  const vscodeApi = useVscodeApi();
  // Helper function to format date (can be expanded)
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const fallbackName = repo.author.name.substring(0, 2).toUpperCase();

  const shouldShowInstallButton =
    repo.readme &&
    (repo.readme.includes('"command": "uvx"') ||
      repo.readme.includes('"command": "npx"') ||
      repo.readme.includes('"command": "docker"'));

  const handleInstallClick = async () => {
    setIsLoading(true);
    if (!repo.readme) {
      console.error("README content is not available.");
      return;
    }
    const handleAddedServer = (message: MessageEvent) => {
      if (message.type === "finish") {
        setIsLoading(false);
      }
    };
    window.addEventListener("message", handleAddedServer);
    vscodeApi.postMessage({
      type: "aiAssistedSetup",
      readme: repo.readme,
    });
    
    return;
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
            <ReactMarkdown
              children={repo.readme}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            />
          </div>
        </div>
      </CardContent>
      {shouldShowInstallButton && !isLoading && (
        <CardFooter className="pt-2 pb-3 border-t">
          <Button
            variant={"outline"}
            onClick={handleInstallClick}
            className="w-full bg-[var(--vscode-button-background)] hover:border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-hoverBackground)]"
          >
            Install
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};

export default RepoCard;
