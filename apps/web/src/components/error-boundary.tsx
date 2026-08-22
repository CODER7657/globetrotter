import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button, ErrorState } from './primitives.js'

interface Props {
  readonly children: ReactNode
}

interface State {
  readonly error: Error | null
}

/**
 * Last line of defence. A render crash shows a designed screen rather than a
 * blank page — which is the difference between a rough edge and a dead demo.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center p-6">
        <ErrorState
          title="Something broke on our side"
          description={error.message}
          action={
            <Button
              onClick={() => {
                window.location.reload()
              }}
            >
              Reload the page
            </Button>
          }
        />
      </div>
    )
  }
}
