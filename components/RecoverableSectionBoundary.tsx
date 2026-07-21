import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FileWarning, RotateCcw } from 'lucide-react';

interface RecoverableSectionBoundaryProps {
  children: ReactNode;
  resetKey: string;
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

interface RecoverableSectionBoundaryState {
  hasError: boolean;
}

/**
 * Keeps a broken card/panel from escalating to the root app error page.
 * Useful for data-heavy surfaces where one malformed record should not take
 * down the entire workspace.
 */
class RecoverableSectionBoundary extends Component<RecoverableSectionBoundaryProps, RecoverableSectionBoundaryState> {
  state: RecoverableSectionBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RecoverableSectionBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Recoverable section render failed:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: RecoverableSectionBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRetry();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        data-qa="recoverable-section-error"
        className="flex h-full min-h-[360px] items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
      >
        <div className="max-w-md">
          <FileWarning className="mx-auto h-10 w-10 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          <h3 className="mt-3 text-base font-semibold">{this.props.title}</h3>
          <p className="mt-2 text-sm leading-6 opacity-85">{this.props.description}</p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {this.props.retryLabel}
            </button>
            {this.props.secondaryLabel && this.props.onSecondaryAction && (
              <button
                type="button"
                onClick={this.props.onSecondaryAction}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                {this.props.secondaryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default RecoverableSectionBoundary;
