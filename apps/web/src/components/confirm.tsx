import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { createContext, type ReactNode, useCallback, useContext, useState } from "react"

export interface ConfirmRequest {
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel: string
  readonly destructive?: boolean
  readonly onConfirm: () => void
}

const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => {})

export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const confirm = useCallback((next: ConfirmRequest) => setRequest(next), [])
  return (
    <ConfirmContext value={confirm}>
      {children}
      <AlertDialog open={request !== null} onOpenChange={(open) => open || setRequest(null)}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.title}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>{request?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={request?.destructive ? "destructive" : "default"}
              onClick={() => {
                request?.onConfirm()
                setRequest(null)
              }}
            >
              {request?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  )
}
