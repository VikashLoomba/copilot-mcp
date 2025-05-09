"use client"

import * as React from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[var(--vscode-editor-background)] group-[.toaster]:text-[var(--vscode-editor-foreground)] group-[.toaster]:border-[var(--vscode-widget-border)] group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-[var(--vscode-descriptionForeground)]",
          actionButton:
            "group-[.toast]:bg-[var(--vscode-button-background)] group-[.toast]:text-[var(--vscode-button-foreground)] font-medium",
          cancelButton:
            "group-[.toast]:bg-[var(--vscode-button-secondaryBackground)] group-[.toast]:text-[var(--vscode-button-secondaryForeground)] font-medium",
          success: 
            "group-[.toast]:text-[var(--vscode-debugIcon-startForeground)] group-[.toast]:border-[var(--vscode-debugIcon-startForeground)]",
          error:
            "group-[.toast]:text-[var(--vscode-errorForeground)] group-[.toast]:border-[var(--vscode-errorForeground)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };