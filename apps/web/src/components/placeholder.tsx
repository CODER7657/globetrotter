/**
 * Every route resolves to one of these until its own issue is built.
 *
 * The point of a stubbed tree is that routing, layout, theming and navigation
 * are all provably working before anyone writes a screen — so two people can
 * build screens in parallel without touching the same files.
 */
export function Placeholder({
  screen,
  issue,
  owner,
}: {
  readonly screen: string
  readonly issue: number
  readonly owner: string
}) {
  return (
    <section className="mx-auto max-w-2xl py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Not built yet
      </p>
      <h1
        className="mt-2 text-3xl font-semibold text-foreground"
        style={{ fontFamily: 'var(--gt-font-display)' }}
      >
        {screen}
      </h1>
      <p className="mt-3 text-muted-foreground">
        This route resolves and the shell around it is real. The screen itself lands in{' '}
        <a
          href={`https://github.com/CODER7657/globetrotter/issues/${issue}`}
          className="text-primary underline underline-offset-4"
        >
          #{issue}
        </a>
        , owned by {owner}.
      </p>
    </section>
  )
}
