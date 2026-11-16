import type { OpenApp } from "@gitui/contracts"
import { Menu, MenuContent, MenuItem, MenuItemIcon, MenuSeparator, MenuTrigger } from "@ui-sdk/solid/menu"
import * as Schema from "effect/Schema"
import { createSignal, For, Show } from "solid-js"
import { desktop } from "@/lib/desktop"
import { describeError } from "@/lib/rpc"
import { load, save } from "@/lib/storage"
import { ChevronDown, Folder } from "./icons"
import { type Failure, Tip } from "./ui"

const PREFERRED = "gitui.solid.openApp"

const [apps, setApps] = createSignal<ReadonlyArray<OpenApp>>([])
void desktop?.getOpenApps().then(setApps, () => setApps([]))

const [preferredId, setPreferredId] = createSignal<string | null>(
  load(PREFERRED, Schema.decodeUnknownSync(Schema.NullOr(Schema.String)), null),
)

export const openApps = apps

const preferred = () =>
  apps().find((app) => app.id === preferredId()) ?? apps().find((app) => app.id === "file-manager") ?? apps()[0]

export const openIn = async (app: OpenApp, repo: string, path?: string): Promise<Failure | null> => {
  try {
    await desktop?.openIn({ app: app.id, repo, ...(path === undefined ? {} : { file: { path } }) })
    setPreferredId(app.id)
    save(PREFERRED, app.id)
    return null
  } catch (error) {
    return { title: `Couldn't open ${path ?? "the repository"} in ${app.name}`, message: describeError(error) }
  }
}

function AppIcon(props: { app: OpenApp; large?: boolean }) {
  return (
    <Show when={props.app.icon} fallback={<Folder />}>
      {(icon) => (
        <img
          src={icon()}
          alt=""
          class={[props.large === true ? "size-[18px]" : "size-4", "max-w-none shrink-0 object-contain"]}
        />
      )}
    </Show>
  )
}

export function OpenInItems(props: {
  repo: string
  path: string
  disabled?: boolean
  onFailure: (failure: Failure | null) => void
}) {
  return (
    <Show when={apps().length > 0}>
      <MenuSeparator />
      <For each={apps()}>
        {(app) => (
          <MenuItem
            disabled={props.disabled === true}
            onSelect={() => void openIn(app, props.repo, props.path).then(props.onFailure)}
          >
            <MenuItemIcon class="flex size-4 shrink-0">
              <AppIcon app={app} />
            </MenuItemIcon>
            Open in {app.name}
          </MenuItem>
        )}
      </For>
    </Show>
  )
}

export function OpenInButton(props: { repo: string; onFailure: (failure: Failure | null) => void }) {
  return (
    <Show when={preferred()}>
      {(app) => (
        <div class="hidden items-center @[50rem]/top:flex">
          <Tip label={`Open the repository in ${app().name}`}>
            {(trigger) => (
              <button
                {...trigger}
                type="button"
                aria-label={`Open the repository in ${app().name}`}
                class="flex h-6 min-w-6 items-center justify-center gap-1.5 rounded-s-md text-xs font-medium hover:bg-muted @[64rem]/top:ps-1 @[64rem]/top:pe-1.5"
                onClick={() => void openIn(app(), props.repo).then(props.onFailure)}
              >
                <AppIcon app={app()} large />
                <span class="hidden @[64rem]/top:inline">{app().name}</span>
              </button>
            )}
          </Tip>
          <Menu>
            <MenuTrigger
              aria-label="Open the repository in…"
              class="flex h-6 w-4 items-center justify-center rounded-e-md text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground"
            >
              <ChevronDown />
            </MenuTrigger>
            <MenuContent align="end" sideOffset={4} class="min-w-48">
              <For each={apps()}>
                {(choice) => (
                  <MenuItem onSelect={() => void openIn(choice, props.repo).then(props.onFailure)}>
                    <MenuItemIcon class="flex size-4 shrink-0">
                      <AppIcon app={choice} />
                    </MenuItemIcon>
                    {choice.name}
                  </MenuItem>
                )}
              </For>
            </MenuContent>
          </Menu>
        </div>
      )}
    </Show>
  )
}
