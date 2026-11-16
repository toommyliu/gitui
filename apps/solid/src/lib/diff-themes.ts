import type { ThemesType } from "@pierre/diffs"

export const diffThemeIds = [
  "pierre",
  "github",
  "vscode",
  "one",
  "catppuccin",
  "solarized",
  "vitesse",
  "rose-pine",
  "everforest",
  "gruvbox",
  "kanagawa",
  "night-owl",
  "material",
  "ayu",
  "min",
] as const
export type DiffThemeId = (typeof diffThemeIds)[number]

export const diffThemes: Record<DiffThemeId, ThemesType & { readonly label: string }> = {
  pierre: { label: "Pierre", light: "pierre-light", dark: "pierre-dark" },
  github: { label: "GitHub", light: "github-light", dark: "github-dark" },
  vscode: { label: "Visual Studio Code", light: "light-plus", dark: "dark-plus" },
  one: { label: "One", light: "one-light", dark: "one-dark-pro" },
  catppuccin: { label: "Catppuccin", light: "catppuccin-latte", dark: "catppuccin-mocha" },
  solarized: { label: "Solarized", light: "solarized-light", dark: "solarized-dark" },
  vitesse: { label: "Vitesse", light: "vitesse-light", dark: "vitesse-dark" },
  "rose-pine": { label: "Rosé Pine", light: "rose-pine-dawn", dark: "rose-pine" },
  everforest: { label: "Everforest", light: "everforest-light", dark: "everforest-dark" },
  gruvbox: { label: "Gruvbox", light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
  kanagawa: { label: "Kanagawa", light: "kanagawa-lotus", dark: "kanagawa-wave" },
  "night-owl": { label: "Night Owl", light: "night-owl-light", dark: "night-owl" },
  material: { label: "Material", light: "material-theme-lighter", dark: "material-theme-darker" },
  ayu: { label: "Ayu", light: "ayu-light", dark: "ayu-dark" },
  min: { label: "Min", light: "min-light", dark: "min-dark" },
}
