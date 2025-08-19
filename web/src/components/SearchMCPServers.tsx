import React, { useState, useEffect, type ChangeEvent, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useVscodeApi } from '@/contexts/VscodeApiContext';
import { Messenger } from 'vscode-messenger-webview';
import RepoCard from './RepoCard';
import { searchServersType } from '../../../src/shared/types/rpcTypes';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// Define an interface for the VSCode API
interface McpServerAuthor {
    name: string;
    profileUrl: string;
    avatarUrl: string;
}

interface SearchResult {
    id: number;
    url: string;
    name: string;
    fullName: string;
    stars: number;
    author: McpServerAuthor;
    description: string | null;
    readme: string; // A short snippet of the README
    language: string | null;
    updatedAt: string;
    // Add other properties as needed based on the actual structure
}

const ITEMS_PER_PAGE = 10; // Define items per page

const SearchMCPServers: React.FC = () => {
    const vscodeApi = useVscodeApi();
    const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
    
    const [searchTerm, setSearchTerm] = useState<string>('');
    const debouncedSearchTerm = useDebounce<string>(searchTerm, 500);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [pageInfo, setPageInfo] = useState<{ hasNextPage?: boolean; hasPreviousPage?: boolean; currentPage?: number; perPage?: number }>({});
    const [totalResults, setTotalResults] = useState<number>(0);
    const [languageFilter, setLanguageFilter] = useState<'javascript' | 'python' | undefined>(undefined);
    const [sortBy, setSortBy] = useState<'stars' | 'name' | 'updated' | 'created'>('stars');
    const [currentPage, setCurrentPage] = useState<number>(1);
    // totalPages will be derived from totalResults and ITEMS_PER_PAGE

    // Message handling is done through vscode-messenger
    // No need for legacy window message listener

    useEffect(() => {
        messenger.start();
    }, [messenger]);

    const performSearch = async (debouncedSearchTerm: string, page?: number) => {
        if (debouncedSearchTerm && messenger) {
            setIsLoading(true);
            setError(null);
            const searchPage = page || 1;
            console.log("Sending data: ", {
                    query: debouncedSearchTerm,
                    page: searchPage,
                    language: languageFilter,
                    sort: sortBy,
                })
            try {
                const result = await messenger.sendRequest(searchServersType, {
                    type: 'extension'
                },{
                    query: debouncedSearchTerm,
                    page: searchPage,
                    language: languageFilter,
                    sort: sortBy,
                });
                
                // Add defensive checks without logging
                if (!result) {
                    setError('No response from server');
                    setIsLoading(false);
                    return;
                }
                console.log("first result: ", result.results[0]?.readme);
                setResults(result.results || []);
                setTotalResults(result.totalCount || 0);
                setPageInfo(result.pageInfo || {});
                setCurrentPage(searchPage);
                setIsLoading(false);
                setError(null);
            } catch  {
                setError('Search failed');
                setIsLoading(false);
            }
        } else if (!debouncedSearchTerm) {
            setResults([]);
            setTotalResults(0);
            setIsLoading(false);
            setError(null);
        }
    };

    

    useEffect(() => {
        // Reset to page 1 when search term, language filter, or sort changes
        setCurrentPage(1);
        setPageInfo({});
        performSearch(debouncedSearchTerm, 1); // Perform search with page 1
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm, languageFilter, sortBy]); // Trigger on search term, filter, or sort change


     // Trigger only when currentPage changes for pagination


    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    };

    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);

    const handlePreviousPage = () => {
        if (pageInfo.hasPreviousPage && currentPage > 1) {
            const prevPage = currentPage - 1;
            performSearch(debouncedSearchTerm, prevPage);
        }
    };

    const handleNextPage = () => {
        if (pageInfo.hasNextPage) {
            const nextPage = currentPage + 1;
            performSearch(debouncedSearchTerm, nextPage);
        }
    };

    return (
        <div className="space-y-4 mt-4">
            <Input
                type="text"
                placeholder="Search for MCP server repositories..."
                value={searchTerm}
                onChange={handleInputChange}
                className="w-full"
            />
            
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Language:</span>
                    <ToggleGroup type="single" value={languageFilter} onValueChange={(value) => setLanguageFilter(value as 'javascript' | 'python' | undefined)}>
                        <ToggleGroupItem value="javascript" aria-label="JavaScript/TypeScript" className="text-xs">
                            JS/TS
                        </ToggleGroupItem>
                        <ToggleGroupItem value="python" aria-label="Python" className="text-xs">
                            Python
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Sort by:</span>
                    <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'stars' | 'name' | 'updated' | 'created')}>
                        <SelectTrigger className="w-[140px]" size="sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="stars">Stars</SelectItem>
                            <SelectItem value="name">Name</SelectItem>
                            <SelectItem value="updated">Recently Updated</SelectItem>
                            <SelectItem value="created">Recently Created</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            {isLoading && <p>Loading...</p>}
            {error && <p className="text-red-500">Error: {error}</p>}
            {!isLoading && !error && debouncedSearchTerm && results.length === 0 && (
                <p>No results found for "{debouncedSearchTerm}".</p>
            )}
            {!isLoading && !error && results.length > 0 && (
                <>
                    <div className="grid grid-cols-1 gap-4">
                        {(results as any).map((repo: any) => (
                            <RepoCard 
                                key={repo.id} 
                                repo={repo} 
                            />
                        ))}
                    </div>
                    {totalPages > 1 && (
                        <div className="flex justify-between items-center mt-4">
                            <Button
                                onClick={handlePreviousPage}
                                disabled={!pageInfo.hasPreviousPage || isLoading}
                            >
                                Previous
                            </Button>

                            <Button
                                onClick={handleNextPage}
                                disabled={!pageInfo.hasNextPage || isLoading}
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default SearchMCPServers; 