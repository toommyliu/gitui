export const copyText = (text: string) => {
  if (window.isSecureContext && navigator.clipboard !== undefined) return navigator.clipboard.writeText(text)
  const area = document.createElement("textarea")
  area.value = text
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error("Copy was blocked"))
}
