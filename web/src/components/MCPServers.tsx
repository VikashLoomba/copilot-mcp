import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InstalledMCPServers from './InstalledMCPServers';
import SearchMCPServers from './SearchMCPServers';

const MCPServers: React.FC = () => {
  return (
    <div className="p-4">
      <Tabs defaultValue="installed" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="installed" className="transition-all duration-300 data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=active]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-button-hoverBackground)] hover:border-[var(--vscode-focusBorder)] cursor-pointer">
            Installed
          </TabsTrigger>
          <TabsTrigger value="search" className="transition-all duration-300 data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)] data-[state=active]:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-button-hoverBackground)] hover:border-[var(--vscode-focusBorder)] cursor-pointer">
            Search
          </TabsTrigger>
        </TabsList>
        <TabsContent value="installed">
          <InstalledMCPServers />
        </TabsContent>
        <TabsContent value="search">
          <SearchMCPServers />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MCPServers;
