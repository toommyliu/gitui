import type { MenuCommand, MenuShortcuts, Theme } from "@gitui/contracts"
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron"

const themes: ReadonlyArray<readonly [Theme, string]> = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
]

const setTheme = (theme: Theme) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("gitui:theme", theme)
}

const modifiers: Readonly<Record<string, string>> = { Mod: "CmdOrCtrl", Control: "Ctrl", Meta: "Super" }

const keys: Readonly<Record<string, string>> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  "+": "Plus",
}

const toAccelerator = (hotkey: string) => {
  const key = hotkey.endsWith("++") || hotkey === "+" ? "+" : hotkey.slice(hotkey.lastIndexOf("+") + 1)
  const held = hotkey
    .slice(0, hotkey.length - key.length)
    .split("+")
    .filter(Boolean)
  const physical = /^\[(?:Key|Digit)?(.+)\]$/.exec(key)?.[1]
  return [...held.map((name) => modifiers[name] ?? name), keys[physical ?? key] ?? physical ?? key].join("+")
}

const separator: MenuItemConstructorOptions = { type: "separator" }

export const buildMenu = ({ theme, shortcuts }: { theme: Theme; shortcuts: MenuShortcuts }) => {
  const command = (id: MenuCommand, label: string): MenuItemConstructorOptions => {
    const shortcut = shortcuts[id]
    return {
      label,
      ...(shortcut === null ? {} : { accelerator: toAccelerator(shortcut) }),
      click: () =>
        (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send("gitui:command", id),
    }
  }
  const settings = command("settings.open", "Settings…")
  const appearance: MenuItemConstructorOptions = {
    label: "Appearance",
    submenu: themes.map(([value, label]): MenuItemConstructorOptions => ({
      label,
      type: "radio",
      checked: value === theme,
      click: () => setTheme(value),
    })),
  }
  const mac = process.platform === "darwin"
  const appMenu: ReadonlyArray<MenuItemConstructorOptions> = mac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            separator,
            settings,
            separator,
            { role: "services" },
            separator,
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            separator,
            { role: "quit" },
          ],
        },
      ]
    : []
  return Menu.buildFromTemplate([
    ...appMenu,
    {
      label: "File",
      submenu: [
        command("repo.open", "Open Repository…"),
        separator,
        command("tab.close", "Close Tab"),
        command("tab.reopen", "Reopen Closed Tab"),
        { role: "close", label: "Close Window", accelerator: "CmdOrCtrl+Shift+W" },
        ...(mac ? [] : [separator, settings, separator, { role: "quit" } as const]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        command("palette.open", "Command Palette…"),
        command("log.toggle", "Command Log"),
        separator,
        appearance,
        separator,
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        separator,
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Window",
      ...(mac ? { role: "window" as const } : {}),
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        separator,
        command("tab.next", "Show Next Tab"),
        command("tab.previous", "Show Previous Tab"),
        ...(mac ? [separator, { role: "front" } as const] : []),
      ],
    },
  ])
}
