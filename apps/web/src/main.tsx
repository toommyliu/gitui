import { RegistryProvider } from "@effect/atom-react"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { Toaster } from "@/components/ui/sonner"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./globals.css"
import "./app.css"
import { App } from "./App.tsx"
import { ConfirmProvider } from "@/components/confirm"
import { ErrorBoundary } from "@/components/error-boundary"
import { PromptProvider } from "@/components/prompt"
import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx"

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

const poolSize = Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <RegistryProvider>
        <WorkerPoolContextProvider
          poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize }}
          highlighterOptions={{}}
        >
          <ConfirmProvider>
            <PromptProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </PromptProvider>
          </ConfirmProvider>
        </WorkerPoolContextProvider>
        <ThemedToaster />
      </RegistryProvider>
    </ThemeProvider>
  </StrictMode>,
)
