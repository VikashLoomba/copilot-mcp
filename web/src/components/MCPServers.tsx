import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InstalledMCPServers from './InstalledMCPServers';
import SearchMCPServers from './SearchMCPServers';

const MCPServers: React.FC = () => {
  return (
    <div className="p-3 sm:p-4">
      <Tabs defaultValue="search" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="search" className="transition-all duration-300 data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=active]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-button-hoverBackground)] hover:border-[var(--vscode-focusBorder)] cursor-pointer">
            Search
          </TabsTrigger>
          <TabsTrigger value="installed" className="transition-all duration-300 data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=active]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-button-hoverBackground)] hover:border-[var(--vscode-focusBorder)] cursor-pointer">
            Installed
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <SearchMCPServers />
        </TabsContent>
        <TabsContent value="installed">
          <InstalledMCPServers />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MCPServers;
