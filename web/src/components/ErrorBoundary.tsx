import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
  info: string;
}

/**
 * Catches render crashes so one broken component shows a readable message
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack || "" });
    // eslint-disable-next-line no-console
    console.error("[ui] render failed:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, info: "" });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash-card">
          <span className="crash-mark">⚠</span>
          <h2>The interface hit an error</h2>
          <p>
            Your conversation and files are untouched — this is a display problem. Reloading the
            panel usually clears it.
          </p>
          <pre className="crash-msg">{error.message || String(error)}</pre>
          {info && <pre className="crash-stack">{info.split("\n").slice(0, 6).join("\n")}</pre>}
          <div className="crash-actions">
            <button className="btn-primary" onClick={this.reset}>
              Try again
            </button>
            <button className="btn-ghost" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
        </div>
      </div>
    );
  }
}