import { RegistryProvider } from "@effect/atom-react"
import { HotkeysProvider } from "@tanstack/react-hotkeys"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./globals.css"
import "./app.css"
import { App } from "./App.tsx"
import { ConfirmProvider } from "@/components/confirm"
import { DiffWorkerPool } from "@/components/diff-view"
import { ErrorBoundary } from "@/components/error-boundary"
import { PromptProvider } from "@/components/prompt"
import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx"
import { appHotkeys, loadCustomHotkeys, saveCustomHotkeys } from "@/lib/commands"

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster position="bottom-right" theme={resolvedTheme} />
}

document.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return
  if (event.target instanceof Node && active.contains(event.target)) return
  active.blur()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <RegistryProvider>
        <DiffWorkerPool>
          <HotkeysProvider
            appHotkeys={appHotkeys}
            customHotkeys={loadCustomHotkeys()}
            onCustomHotkeysChange={saveCustomHotkeys}
          >
            <ConfirmProvider>
              <PromptProvider>
                <TooltipProvider>
                  <ErrorBoundary>
                    <App />
                  </ErrorBoundary>
                </TooltipProvider>
              </PromptProvider>
            </ConfirmProvider>
          </HotkeysProvider>
        </DiffWorkerPool>
        <ThemedToaster />
      </RegistryProvider>
    </ThemeProvider>
  </StrictMode>,
)
