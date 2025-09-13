import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import RegistryServerCard from './RegistryServerCard';
import { useVscodeApi } from '@/contexts/VscodeApiContext';
import { Messenger } from 'vscode-messenger-webview';
import { registrySearchType } from '../../../src/shared/types/rpcTypes';

type RegistryPackage = {
  identifier?: string;
  version?: string;
  registry_type?: string;
  runtime_hint?: string;
  runtime_arguments?: Array<any> | null;
  package_arguments?: Array<any> | null;
  environment_variables?: Array<any> | null;
  transport?: { type?: string } | null;
};

type RegistryRemote = { type?: string; url: string };

type RegistryServer = {
  name?: string;
  description?: string;
  repository?: { url?: string };
  website_url?: string;
  packages?: RegistryPackage[] | null;
  remotes?: RegistryRemote[] | null;
  _meta?: { [k: string]: any };
};

const ITEMS_PER_PAGE = 10;

const SearchRegistryServers: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce<string>(searchTerm, 500);
  const [results, setResults] = useState<RegistryServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setCurrentPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const vscodeApi = useVscodeApi();
  const messenger = useMemo(() => new Messenger(vscodeApi), [vscodeApi]);
  useEffect(() => { messenger.start(); }, [messenger]);

  const performSearch = async (cursor?: string) => {
    if (!debouncedSearchTerm) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const resp = await messenger.sendRequest(registrySearchType, { type: 'extension' }, {
        search: debouncedSearchTerm,
        limit: ITEMS_PER_PAGE,
        cursor,
      });
      setResults((resp as any)?.servers || []);
      setNextCursor((resp as any)?.metadata?.next_cursor);
    } catch (e) {
      console.error(e);
      setError('Search failed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setNextCursor(undefined);
    setCursorStack([]);
    performSearch(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]);

  const handlePreviousPage = () => {
    if (cursorStack.length === 0) return;
    const stack = [...cursorStack];
    const prev = stack.pop();
    setCursorStack(stack);
    setCurrentPage((p) => Math.max(1, p - 1));
    performSearch(prev);
  };

  const handleNextPage = () => {
    if (!nextCursor) return;
    setCursorStack((s) => [...s, nextCursor]);
    setCurrentPage((p) => p + 1);
    performSearch(nextCursor);
  };

  return (
    <div className="space-y-4">
      <Input
        type="text"
        placeholder="Search the Official MCP Registry..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
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
            {results.map((srv, idx) => (
              <RegistryServerCard key={(srv._meta?.["io.modelcontextprotocol.registry/official"]?.id ?? idx)} server={srv} />
            ))}
          </div>
          <div className="flex justify-between items-center mt-4">
            <Button onClick={handlePreviousPage} disabled={cursorStack.length === 0 || isLoading}>
              Previous
            </Button>
            <Button onClick={handleNextPage} disabled={!nextCursor || isLoading}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default SearchRegistryServers;
