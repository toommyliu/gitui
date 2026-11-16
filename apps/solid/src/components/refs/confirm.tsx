import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/solid/alert-dialog"
import { Show } from "solid-js"
import { Button, Alert } from "../ui"
import { Prose } from "../commit-mention"

export function Confirm(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  error: string | null
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div class="flex flex-col gap-1">
          <AlertDialogTitle>
            <Prose text={props.title} />
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Prose text={props.description} />
          </AlertDialogDescription>
        </div>
        <Show when={props.error}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
        <div class="flex justify-end gap-1.5">
          <Button disabled={props.pending} onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={props.pending} onClick={() => props.onConfirm()}>
            {props.confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
