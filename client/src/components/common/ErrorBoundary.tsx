import { Component, type ErrorInfo, type ReactNode } from 'react';
import { telemetry } from '../../services/telemetry.js';

interface ErrorBoundaryProps { children: ReactNode; fallback?: ReactNode; }
interface ErrorBoundaryState { failed: boolean; }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ErrorBoundaryState { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { telemetry.capture('pwa.render_error', { name: error.name, componentStack: info.componentStack ?? 'unknown' }); }
  private recover = (): void => { this.setState({ failed: false }); };
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <section className="field-card error-card" role="alert"><p className="eyebrow">Offline recovery</p><h2>Something went wrong</h2><p> Your saved field entries are kept locally. Check your connection and try again.</p><button className="primary-button" type="button" onClick={this.recover}>Try again</button></section>;
  }
}
