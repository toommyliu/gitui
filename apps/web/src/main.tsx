import { RegistryProvider } from "@effect/atom-react"
import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { Toaster } from "@workspace/ui/components/sonner"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@workspace/ui/globals.css"
import "./app.css"
import { App } from "./App.tsx"
import { ConfirmProvider } from "@/components/confirm"
import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx"

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster position="bottom-right" theme={resolvedTheme} />
}

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
            <App />
          </ConfirmProvider>
        </WorkerPoolContextProvider>
        <ThemedToaster />
      </RegistryProvider>
    </ThemeProvider>
  </StrictMode>,
)
