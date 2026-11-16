import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees"
import type { IconSet } from "@/lib/settings"

const resolvers = {
  minimal: createFileTreeIconResolver({ set: "minimal" }),
  standard: createFileTreeIconResolver({ set: "standard" }),
  complete: createFileTreeIconResolver({ set: "complete" }),
} satisfies Record<IconSet, unknown>

export function FileIconSprite() {
  return (
    <div aria-hidden="true" class="absolute size-0 overflow-hidden" innerHTML={getBuiltInSpriteSheet("complete")} />
  )
}

export function FileIcon(props: { path: string; set: IconSet }) {
  const icon = () => resolvers[props.set].resolveIcon("file-tree-icon-file", props.path)
  return (
    <svg aria-hidden="true" class="size-4 shrink-0" data-file-icon={icon().token ?? "default"}>
      <use href={`#${icon().name}`} />
    </svg>
  )
}
