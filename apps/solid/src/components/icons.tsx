import type { JSX } from "@solidjs/web"

function Icon(props: { children: JSX.Element; class?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={props.class ?? "size-3.5 shrink-0"}
    >
      {props.children}
    </svg>
  )
}

export const ChevronRight = (props: { class?: string | undefined }) => (
  <Icon class={props.class}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)

export const ChevronDown = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const Search = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const Copy = () => (
  <Icon class="size-3 shrink-0">
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
  </Icon>
)

export const PanelLeft = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
)

export const Folder = () => (
  <Icon>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
)

export const FolderOpen = () => (
  <Icon>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Icon>
)

export const FolderGit = () => (
  <Icon>
    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
    <circle cx="13" cy="12" r="2" />
    <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
    <circle cx="20" cy="19" r="2" />
  </Icon>
)

export const More = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="size-3.5 shrink-0">
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
)

export const Plus = () => (
  <Icon>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
)

export const X = () => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
)

export const ArrowDown = () => (
  <Icon>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </Icon>
)

export const ArrowUp = () => (
  <Icon>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </Icon>
)

export const Refresh = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)

export const Branch = () => (
  <Icon>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 8v8" />
    <path d="M18 10c0 4-6 3-11 7" />
  </Icon>
)

export const Expand = () => (
  <Icon>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="m21 3-7 7" />
    <path d="m3 21 7-7" />
  </Icon>
)

export const Check = (props: { class?: string | undefined }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={props.class ?? "size-3 shrink-0"}
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const ArrowUpSmall = () => (
  <svg viewBox="0 0 8 8" aria-hidden="true" class="size-2 shrink-0" fill="currentColor">
    <path d="M4 1 7 5H5v2H3V5H1z" />
  </svg>
)

export const ArrowDownSmall = () => (
  <svg viewBox="0 0 8 8" aria-hidden="true" class="size-2 shrink-0" fill="currentColor">
    <path d="M4 7 1 3h2V1h2v2h2z" />
  </svg>
)

export const Flask = () => (
  <Icon>
    <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16h10" />
  </Icon>
)

export const WrapText = () => (
  <Icon>
    <path d="m16 16-2 2 2 2" />
    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
    <path d="M3 18h7" />
    <path d="M3 6h18" />
  </Icon>
)

export const Space = () => (
  <Icon>
    <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
  </Icon>
)

export const CollapseAll = () => (
  <Icon>
    <path d="m7 20 5-5 5 5" />
    <path d="m7 4 5 5 5-5" />
  </Icon>
)

export const ExpandAll = () => (
  <Icon>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </Icon>
)

export const CircleAlert = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
)

export const TriangleAlert = () => (
  <Icon>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
)

export const CircleCheck = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)

export const Info = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Icon>
)

export const Worktree = () => (
  <Icon>
    <circle cx="12" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
    <path d="M12 12v3" />
  </Icon>
)

export const Eye = () => (
  <Icon>
    <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const EyeOff = () => (
  <Icon>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.7 0 8.6 3 9.94 6.65a1 1 0 0 1 0 .7 10.74 10.74 0 0 1-1.44 2.49" />
    <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
    <path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" />
    <path d="m2 2 20 20" />
  </Icon>
)
