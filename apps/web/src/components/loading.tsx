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
