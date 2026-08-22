import { useTheme, type Theme } from '../lib/theme.js'

const OPTIONS: ReadonlyArray<{ readonly value: Theme; readonly label: string; readonly glyph: string }> = [
  { value: 'light', label: 'Light', glyph: '☀' },
  { value: 'dark', label: 'Dark', glyph: '☾' },
  { value: 'system', label: 'System', glyph: '⌂' },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex gap-1 rounded-[var(--radius-md)] bg-muted p-1"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={theme === option.value}
          title={option.label}
          onClick={() => {
            setTheme(option.value)
          }}
          className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors ${
            theme === option.value
              ? 'bg-card text-foreground shadow-[var(--gt-shadow-xs)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <span aria-hidden="true">{option.glyph}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
