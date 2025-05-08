import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from "@/components/ui/skeleton";

// Define the shape of the VSCode API object that we expect.
// This can be expanded as needed.
interface VscodeApi {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (newState: any) => void;
  // Add other methods if you use them directly
}

const VscodeApiContext = createContext<VscodeApi | null>(null);

interface VscodeApiProviderProps {
  children: ReactNode;
}

// Helper function to acquire the VSCode API
const getVscodeApi = (): VscodeApi | null => {
  if (typeof acquireVsCodeApi === 'function') {
    return acquireVsCodeApi();
  }
  // Fallback for when not in a VSCode webview context (e.g., browser development/testing)
  // You can expand this mock for better testing outside VSCode.
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && !window.acquireVsCodeApi) {
    console.warn('VSCode API (acquireVsCodeApi) not found. Using mock API for development.');
    return {
      postMessage: (message) => console.log('[Mock VSCode API] postMessage:', message),
      getState: () => {
        console.log('[Mock VSCode API] getState');
        try {
            const state = localStorage.getItem('vscodeState');
            return state ? JSON.parse(state) : undefined;
        } catch {
            return undefined;
        }
      },
      setState: (newState) => {
        console.log('[Mock VSCode API] setState:', newState);
        try {
            localStorage.setItem('vscodeState', JSON.stringify(newState));
        } catch {
            // ignore
        }
      },
    };
  }
  return null;
};

export const VscodeApiProvider: React.FC<VscodeApiProviderProps> = ({ children }) => {
  const [vscodeApi, setVscodeApi] = useState<VscodeApi | null>(null);

  useEffect(() => {
    const api = getVscodeApi();
    if (api) {
      setVscodeApi(api);
    }
  }, []);

  // Optional: Show a loading state or null if API is not yet available,
  // though acquireVsCodeApi should be available synchronously if in the webview.
  if (!vscodeApi && typeof acquireVsCodeApi === 'function') {
    return <Skeleton className="h-4 w-32" />; // Or some other loading indicator
  }

  return (
    <VscodeApiContext.Provider value={vscodeApi}>
      {children}
    </VscodeApiContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useVscodeApi = (): VscodeApi => {
  const context = useContext(VscodeApiContext);
  if (context === null && typeof acquireVsCodeApi !== 'function') {
    // This will happen if used outside a provider AND outside a webview (where mock would be active)
    // Or if the mock API itself fails to initialize, which it shouldn't with the current setup.
    throw new Error('useVscodeApi must be used within a VscodeApiProvider and in a VSCode webview, or mock API failed.');
  }
  // If context is null but acquireVsCodeApi IS available, it means the provider hasn't set the state yet.
  // This case should ideally be handled by the provider ensuring API is set before children render, or by a loading state.
  // However, for direct usage in components, we can re-check here, though it's a bit of a fallback.
  if (context === null && typeof acquireVsCodeApi === 'function') {
    console.warn("VscodeApiContext was null, attempting to re-acquire API. This might indicate a timing issue with the Provider.");
    const api = getVscodeApi();
    if (!api) throw new Error("Failed to acquire VSCode API even though acquireVsCodeApi is present.");
    return api; 
  }
  if (!context) {
      // This will primarily catch the case where the mock API is needed but didn't initialize, 
      // or if used outside the provider when acquireVsCodeApi is also not available.
      throw new Error('useVscodeApi was called, but the VSCode API is not available. Ensure you are within a VscodeApiProvider or the mock API is working.');
  }
  return context;
};

// It's good practice to type the acquireVsCodeApi function if it's globally available in your webview
declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeApi;
  }
  function acquireVsCodeApi(): VscodeApi;
} 