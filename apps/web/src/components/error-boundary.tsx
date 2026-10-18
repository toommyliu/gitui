import { Button } from "@workspace/ui/components/button"
import { Component, type ErrorInfo, type ReactNode } from "react"

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div className="flex h-full flex-col gap-3 overflow-auto p-6">
        <p className="text-sm font-medium">Something broke while rendering.</p>
        <pre className="rounded-md bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap">
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
        <Button className="w-fit" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}
