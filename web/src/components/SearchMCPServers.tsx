import React, { useState, useEffect, type ChangeEvent, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import { useVscodeApi } from '@/contexts/VscodeApiContext';
import { Messenger } from 'vscode-messenger-webview';
import RepoCard from './RepoCard';
import { searchServersType } from '../../../src/shared/types/rpcTypes';
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
    const [pageInfo, setPageInfo] = useState<{ startCursor?: string; endCursor?: string; hasNextPage?: boolean; hasPreviousPage?: boolean }>({});
    const [totalResults, setTotalResults] = useState<number>(0);
    // totalPages will be derived from totalResults and ITEMS_PER_PAGE

    // Message handling is done through vscode-messenger
    // No need for legacy window message listener

    useEffect(() => {
        messenger.start();
    }, [messenger]);

    const performSearch = async (debouncedSearchTerm: string, endCursor?: string, startCursor?: string, direction?: 'forward' | 'backward' ) => {
        if (debouncedSearchTerm && messenger) {
            setIsLoading(true);
            setError(null);
            console.log("Sending data: ", {
                    query: debouncedSearchTerm,
                    endCursor: endCursor,
                    startCursor: startCursor,
                    direction: direction,
                    
                })
            try {
                const result = await messenger.sendRequest(searchServersType, {
                    type: 'extension'
                },{
                    query: debouncedSearchTerm,
                    endCursor: endCursor,
                    startCursor: startCursor,
                    direction: direction,
                    
                });
                
                // Add defensive checks without logging
                if (!result) {
                    setError('No response from server');
                    setIsLoading(false);
                    return;
                }
                console.log("first result: ", result.results[0].readme);
                setResults(result.results || []);
                setTotalResults(result.totalCount || 0);
                setPageInfo(result.pageInfo || {});
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
        // Reset to page 1 when search term changes
        setPageInfo({});
        performSearch(debouncedSearchTerm); // Perform search with page 1
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm]); // Only trigger on debouncedSearchTerm change for new searches


     // Trigger only when currentPage changes for pagination


    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    };

    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);

    const handlePreviousPage = () => {
        performSearch(debouncedSearchTerm, undefined, pageInfo.startCursor, 'backward');
    };

    const handleNextPage = () => {
        performSearch(debouncedSearchTerm, pageInfo.endCursor, undefined, 'forward');
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