import React from 'react';

interface Props {
  pageKey: string;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Route-level error boundary: one crashing page (Home shelf, Explore,
 * Search) unmounts to a retry card instead of taking the player, queue and
 * navigation down with it. The engine singleton survives — audio keeps
 * playing. Resets automatically on navigation (pageKey change).
 */
export class RouteBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (prev.pageKey !== this.props.pageKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch() {
    // Intentionally silent: no backend stack traces reach the UI.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center" role="alert">
        <p className="text-[15px] font-bold text-white">This section hit a snag</p>
        <p className="max-w-[38ch] text-xs text-white/50">
          Your music keeps playing. Try reloading this section — nothing was deleted.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90"
        >
          Retry section
        </button>
      </div>
    );
  }
}
