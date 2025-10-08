import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import RegistryServerCard from './RegistryServerCard';
import { useVscodeApi } from '@/contexts/VscodeApiContext';
import { Messenger } from 'vscode-messenger-webview';
import { registrySearchType } from '../../../src/shared/types/rpcTypes';
import {
  normalizeRegistryMetadata,
  normalizeRegistryServerResponse,
} from '@/types/registry';
import type { RegistrySearchResponse, RegistryServerResponse } from '@/types/registry';

const ITEMS_PER_PAGE = 10;

const SearchRegistryServers: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce<string>(searchTerm, 500);
  const [results, setResults] = useState<RegistryServerResponse[]>([]);
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
      }) as RegistrySearchResponse;
      const rawServers = Array.isArray(resp?.servers)
        ? resp?.servers
        : Array.isArray(resp as any)
          ? (resp as unknown as any[])
          : [];
      const normalizedServers = rawServers
        .map((entry) => normalizeRegistryServerResponse(entry))
        .filter((entry): entry is RegistryServerResponse => {
          const server = entry.server;
          return !!server && typeof server.name === 'string' && server.name.length > 0;
        });
      setResults(normalizedServers);
      const metadata = normalizeRegistryMetadata(resp?.metadata ?? {});
      setNextCursor(metadata.nextCursor);
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
            {results.map((srv, idx) => {
              const officialMeta = (srv._meta as Record<string, any> | undefined)?.["io.modelcontextprotocol.registry/official"];
              const key = officialMeta?.id ?? `${srv.server?.name ?? 'server'}-${srv.server?.version ?? idx}`;
              return (
                <RegistryServerCard
                  key={key}
                  serverResponse={srv}
                />
              );
            })}
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
