import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PatchDiff } from "@pierre/diffs/react"
import { cn } from "cn"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import {
  formatForDisplay,
  type Hotkey,
  useAppHotkeyList,
  useCustomHotkeys,
  useHotkeyRecorder,
} from "@tanstack/react-hotkeys"
import { Fragment, type ReactNode, useState } from "react"
import { type CommandId, commandGroups, tabKeys, toLogicalHotkey } from "@/lib/commands"
import { type DiffThemeId, diffThemeIds, diffThemes } from "@/lib/diff-themes"
import { useNarrow } from "@/lib/narrow"
import { type Settings, type SettingsSection, settingsAtom, settingsSections, settingsViewAtom } from "@/lib/settings"
import { useDiffAppearance } from "./diff-view"
import { Shortcut } from "./shortcut"
import { type Theme, useTheme } from "./theme-provider"

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      spacing={0}
      value={[value]}
      onValueChange={(next: Array<string>) => {
        const picked = options.find(([option]) => option === next[0])
        if (picked !== undefined) onChange(picked[0])
      }}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option} className="px-3">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <Field orientation="horizontal" className="py-3">
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description !== undefined && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  )
}

const useSettings = () => {
  const [settings, setSettings] = useAtom(settingsAtom)
  return [settings, (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })] as const
}

function GeneralSettings() {
  const [settings, update] = useSettings()
  return (
    <>
      <Field className="py-3">
        <FieldContent>
          <FieldLabel htmlFor="repo-base">Repositories folder</FieldLabel>
          <FieldDescription>
            New tabs list the repositories in this folder. Empty means your home folder.
          </FieldDescription>
        </FieldContent>
        <Input
          id="repo-base"
          placeholder="~/projects"
          className="font-mono"
          value={settings.repoBase ?? ""}
          onChange={(event) => update({ repoBase: event.target.value })}
        />
      </Field>
      <Row label="Fetch in the background" description="Fetches the open repository while this window is open.">
        <Choice
          label="Fetch in the background"
          value={settings.backgroundFetch}
          onChange={(backgroundFetch) => update({ backgroundFetch })}
          options={[
            ["off", "Off"],
            ["5", "5 min"],
            ["15", "15 min"],
            ["30", "30 min"],
          ]}
        />
      </Row>
    </>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  return (
    <Row label="Theme" description="System follows this device.">
      <Choice<Theme>
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          ["system", "System"],
          ["light", "Light"],
          ["dark", "Dark"],
        ]}
      />
    </Row>
  )
}

const previewPatch = `diff --git a/summary.ts b/summary.ts
--- a/summary.ts
+++ b/summary.ts
@@ -1,2 +1,2 @@
 export const summary = (count: number, branch: string) =>
-  \`\${count} file changed on \${branch}\`
+  \`\${count} files changed in \${branch}\`
`

function DiffPreview() {
  const { options, style } = useDiffAppearance()
  return (
    <div className="py-3">
      <PatchDiff
        patch={previewPatch}
        options={{ ...options, disableFileHeader: true }}
        style={style}
        className="block overflow-hidden rounded-md border"
      />
    </div>
  )
}

function DiffThemeMenu({ value, onChange }: { value: DiffThemeId; onChange: (theme: DiffThemeId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="w-44 justify-between" />}>
        {diffThemes[value].label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: unknown) => {
            const picked = diffThemeIds.find((id) => id === next)
            if (picked !== undefined) onChange(picked)
          }}
        >
          {diffThemeIds.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {diffThemes[id].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DiffSettings() {
  const [settings, update] = useSettings()
  return (
    <>
      <DiffPreview />
      <Row label="Code theme" description="Each theme has a light and a dark version that follow Appearance.">
        <DiffThemeMenu value={settings.diffTheme} onChange={(diffTheme) => update({ diffTheme })} />
      </Row>
      <Row label="Text size">
        <Choice
          label="Text size"
          value={settings.diffTextSize}
          onChange={(diffTextSize) => update({ diffTextSize })}
          options={[
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ]}
        />
      </Row>
      <Row label="Layout" description="Split puts old and new side by side.">
        <Choice
          label="Layout"
          value={settings.diffStyle}
          onChange={(diffStyle) => update({ diffStyle })}
          options={[
            ["unified", "Unified"],
            ["split", "Split"],
          ]}
        />
      </Row>
      <Row label="Show changes with" description="Signs put + and − beside changed lines.">
        <Choice
          label="Show changes with"
          value={settings.changeMarkers}
          onChange={(changeMarkers) => update({ changeMarkers })}
          options={[
            ["color", "Color"],
            ["signs", "Signs"],
            ["both", "Both"],
          ]}
        />
      </Row>
      <Row label="Highlight changed words" description="Marks what changed inside a line.">
        <Choice
          label="Highlight changed words"
          value={settings.wordDiff}
          onChange={(wordDiff) => update({ wordDiff })}
          options={[
            ["word", "Words"],
            ["char", "Characters"],
            ["none", "Off"],
          ]}
        />
      </Row>
      <Row label="Wrap long lines" description="Otherwise long lines scroll sideways." htmlFor="wrap-lines">
        <Switch
          id="wrap-lines"
          checked={settings.wrapLines}
          onCheckedChange={(wrapLines: boolean) => update({ wrapLines })}
        />
      </Row>
      <Row label="Line numbers" htmlFor="line-numbers">
        <Switch
          id="line-numbers"
          checked={settings.lineNumbers}
          onCheckedChange={(lineNumbers: boolean) => update({ lineNumbers })}
        />
      </Row>
      <Row
        label="Ignore whitespace in commits"
        description="Hides lines that only change spacing. Uncommitted changes always show every line, so staging lines stays exact."
        htmlFor="ignore-whitespace"
      >
        <Switch
          id="ignore-whitespace"
          checked={settings.ignoreWhitespace}
          onCheckedChange={(ignoreWhitespace: boolean) => update({ ignoreWhitespace })}
        />
      </Row>
    </>
  )
}

function HistorySettings() {
  const [settings, update] = useSettings()
  return (
    <>
      <Row
        label="Include remote branches"
        description="Shows commits that only remote branches reach."
        htmlFor="history-remotes"
      >
        <Switch
          id="history-remotes"
          checked={settings.historyRemotes}
          onCheckedChange={(historyRemotes: boolean) => update({ historyRemotes })}
        />
      </Row>
      <Row label="Dates" description="Exact shows the time today, the weekday this week, then the date.">
        <Choice
          label="Dates"
          value={settings.historyDates}
          onChange={(historyDates) => update({ historyDates })}
          options={[
            ["exact", "Exact"],
            ["relative", "Relative"],
          ]}
        />
      </Row>
    </>
  )
}

function CommitSettings() {
  const [settings, update] = useSettings()
  return (
    <Row label="Subject length guide" description="Counts the first line of the message and marks it past the limit.">
      <Choice
        label="Subject length guide"
        value={settings.subjectGuide}
        onChange={(subjectGuide) => update({ subjectGuide })}
        options={[
          ["off", "Off"],
          ["50", "50"],
          ["72", "72"],
        ]}
      />
    </Row>
  )
}

function Keys({ hotkeys, separator }: { hotkeys: ReadonlyArray<Hotkey>; separator: string }) {
  return hotkeys.map((hotkey, index) => (
    <Fragment key={index}>
      {index > 0 && <span className="text-muted-foreground">{separator}</span>}
      <Shortcut hotkey={hotkey} />
    </Fragment>
  ))
}

function KeyboardSettings() {
  const list = useAppHotkeyList()
  const { setCustomHotkey, resetCustomHotkey, resetCustomHotkeys } = useCustomHotkeys()
  const [recording, setRecording] = useState<CommandId | null>(null)
  const [conflict, setConflict] = useState<{ readonly id: CommandId; readonly message: string } | null>(null)
  const recorder = useHotkeyRecorder({
    onRecord: (recorded) => {
      if (recording === null) return
      const hotkey = toLogicalHotkey(recorded)
      const taken = setCustomHotkey(recording, hotkey)
      const names = taken.map((other) => other.meta?.name ?? other.id).join(", ")
      setConflict(
        taken.length === 0 ? null : { id: recording, message: `${formatForDisplay(hotkey)} already runs ${names}.` },
      )
      setRecording(null)
    },
    onClear: () => {
      if (recording !== null) setCustomHotkey(recording, null)
      setRecording(null)
    },
    onCancel: () => setRecording(null),
  })
  const record = (id: CommandId) => {
    setConflict(null)
    setRecording(id)
    recorder.startRecording()
  }

  return (
    <>
      {commandGroups.map((group) => {
        const items = list.filter((item) => item.appHotkey.meta?.group === group)
        return (
          <section key={group} className="py-3">
            <h3 className="mb-1 font-medium">{group}</h3>
            {items.map(({ appHotkey, isCustom }) => {
              const { id, hotkey, meta } = appHotkey
              const isRecording = recording === id && recorder.isRecording
              return (
                <div key={id} className="flex min-h-9 items-center gap-3">
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {meta?.name}
                    {conflict?.id === id && <span className="block text-destructive">{conflict.message}</span>}
                  </span>
                  <span className="flex shrink-0 items-center justify-end gap-1.5">
                    {isRecording ? (
                      <span className="text-muted-foreground">Press a shortcut. Esc cancels, ⌫ removes it.</span>
                    ) : hotkey === null ? (
                      <span className="text-muted-foreground">Not set</span>
                    ) : (
                      <Keys hotkeys={[hotkey, ...(meta?.also ?? [])]} separator="or" />
                    )}
                  </span>
                  <span className="flex w-28 shrink-0 justify-end gap-1">
                    {isCustom && !isRecording && (
                      <Button size="sm" variant="ghost" onClick={() => resetCustomHotkey(id)}>
                        Reset
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => (isRecording ? recorder.cancelRecording() : record(id))}
                    >
                      {isRecording ? "Cancel" : "Change"}
                    </Button>
                  </span>
                </div>
              )
            })}
            {group === "Tabs" && (
              <div className="flex min-h-9 items-center gap-3">
                <span className="min-w-0 flex-1 text-muted-foreground">Go to a tab</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Keys hotkeys={[tabKeys[0], tabKeys[8]]} separator="to" />
                </span>
                <span className="w-28 shrink-0" />
              </div>
            )}
          </section>
        )
      })}
      {list.some((item) => item.isCustom) && (
        <div className="flex justify-end py-3">
          <Button variant="outline" onClick={resetCustomHotkeys}>
            Reset all shortcuts
          </Button>
        </div>
      )}
    </>
  )
}

const sections: Record<SettingsSection, { readonly label: string; readonly Body: () => ReactNode }> = {
  general: { label: "General", Body: GeneralSettings },
  appearance: { label: "Appearance", Body: AppearanceSettings },
  diffs: { label: "Diffs", Body: DiffSettings },
  history: { label: "History", Body: HistorySettings },
  commit: { label: "Commit", Body: CommitSettings },
  keyboard: { label: "Keyboard", Body: KeyboardSettings },
}

function SectionBody({ section }: { section: SettingsSection }) {
  const { Body } = sections[section]
  return (
    <div className="divide-y">
      <Body />
    </div>
  )
}

function Header({ back, title, onBack }: { back: string; title: string; onBack: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon data-icon="inline-start" />
        {back}
      </Button>
      <h2 className="font-semibold">{title}</h2>
    </div>
  )
}

export function SettingsPage() {
  const view = useAtomValue(settingsViewAtom)
  const navigate = useAtomSet(settingsViewAtom)
  const narrow = useNarrow()
  const back = () => navigate("back")
  const section = view === null || view === "sections" ? (narrow ? null : "general") : view

  return (
    <DialogPrimitive.Root open={view !== null} onOpenChange={(open) => !open && back()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex flex-col bg-background text-xs outline-none">
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>
          {narrow ? (
            section === null ? (
              <>
                <Header back="Back" title="Settings" onBack={back} />
                <nav aria-label="Settings sections" className="flex flex-col p-2">
                  {settingsSections.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate(id)}
                      className="flex h-10 items-center justify-between rounded-md px-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                    >
                      {sections[id].label}
                      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                    </button>
                  ))}
                </nav>
              </>
            ) : (
              <>
                <Header back="Settings" title={sections[section].label} onBack={back} />
                <div className="min-h-0 flex-1 overflow-y-auto px-4">
                  <SectionBody section={section} />
                </div>
              </>
            )
          ) : (
            <div className="flex min-h-0 flex-1">
              <nav
                aria-label="Settings sections"
                className="flex w-56 shrink-0 flex-col gap-1 border-r bg-muted/40 p-3"
              >
                <Button variant="ghost" size="lg" className="mb-2 justify-start text-muted-foreground" onClick={back}>
                  <ChevronLeftIcon data-icon="inline-start" />
                  Back
                </Button>
                {settingsSections.map((id) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="lg"
                    aria-current={id === section ? "page" : undefined}
                    className={cn(
                      "justify-start",
                      id === section ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => navigate(id)}
                  >
                    {sections[id].label}
                  </Button>
                ))}
              </nav>
              {section !== null && (
                <div className="min-w-0 flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-2xl px-8 py-6">
                    <h2 className="text-sm font-semibold">{sections[section].label}</h2>
                    <SectionBody section={section} />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
