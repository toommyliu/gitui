import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { ReactNode } from "react"

export function Loading({ label }: { label: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia>
          <Spinner />
        </EmptyMedia>
        <EmptyDescription>{label}…</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function Nothing({
  title,
  description,
  onRetry,
}: {
  title: string
  description?: ReactNode
  onRetry?: () => void
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {onRetry !== undefined && (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

export function LargeDiff({ bytes, onShow, hint }: { bytes: number; onShow: () => void; hint?: string }) {
  const size = (bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>Large diff</EmptyTitle>
        <EmptyDescription>This diff is {size} MB. Showing it may slow down the app.</EmptyDescription>
        {hint !== undefined && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onShow}>
          Show diff anyway
        </Button>
      </EmptyContent>
    </Empty>
  )
}
