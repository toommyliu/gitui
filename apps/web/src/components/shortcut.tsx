import { formatForDisplay, type Hotkey } from "@tanstack/react-hotkeys"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

export function Shortcut({ hotkey, className }: { hotkey: Hotkey; className?: string }) {
  const chords = typeof hotkey === "string" ? [hotkey] : hotkey
  return (
    <KbdGroup className={className}>
      {chords
        .flatMap((chord) => formatForDisplay(chord, { parts: true }))
        .map((part, index) => (
          <Kbd key={index}>{part}</Kbd>
        ))}
    </KbdGroup>
  )
}
