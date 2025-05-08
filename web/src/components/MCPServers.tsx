import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InstalledMCPServers from './InstalledMCPServers';
import SearchMCPServers from './SearchMCPServers';

const MCPServers: React.FC = () => {
  return (
    <div className="p-4">
      <Tabs defaultValue="installed" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="installed" className="data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)]">
            Installed
          </TabsTrigger>
          <TabsTrigger value="search" className="data-[state=active]:bg-[var(--vscode-list-activeSelectionBackground)]">
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
