import { useAtom } from "@effect/atom-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  FieldLegend,
} from "@workspace/ui/components/field"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { Switch } from "@workspace/ui/components/switch"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import type { ReactNode } from "react"
import { type Settings, settingsAtom } from "@/lib/settings"
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
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={(next: Array<string>) => {
        const picked = options.find(([option]) => option === next[0])
        if (picked !== undefined) onChange(picked[0])
      }}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function Row({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      {children}
    </Field>
  )
}

const shortcuts: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
  [["↑", "↓"], "Move through commits (also j and k)"],
  [["⌘", "↩"], "Commit staged changes"],
  [["d"], "Toggle light and dark"],
]

export function SettingsDialog() {
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useAtom(settingsAtom)
  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Settings</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved in this browser.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
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
          <Row label="Diff layout" description="Split puts old and new side by side.">
            <Choice
              label="Diff layout"
              value={settings.diffStyle}
              onChange={(diffStyle) => update({ diffStyle })}
              options={[
                ["unified", "Unified"],
                ["split", "Split"],
              ]}
            />
          </Row>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="wrap-lines">Wrap long lines</FieldLabel>
              <FieldDescription>Otherwise long lines scroll sideways.</FieldDescription>
            </FieldContent>
            <Switch
              id="wrap-lines"
              checked={settings.wrapLines}
              onCheckedChange={(wrapLines: boolean) => update({ wrapLines })}
            />
          </Field>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend variant="label">Keyboard</FieldLegend>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
              {shortcuts.map(([keys, description]) => (
                <div key={description} className="contents">
                  <dt>
                    <KbdGroup>
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </dt>
                  <dd className="text-muted-foreground">{description}</dd>
                </div>
              ))}
            </dl>
          </FieldSet>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
