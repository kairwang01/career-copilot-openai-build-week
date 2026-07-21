import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Root error boundary — the app previously had NONE, so any uncaught runtime
 * exception (e.g. after long idle / a token-refresh edge case) unmounted the
 * whole React tree and left users staring at a blank white page with no way
 * forward. This converts that failure class into a friendly reload screen.
 */
class ErrorBoundary extends Component<Props, State> {
  // This repo ships NO React type definitions (no @types/react; strict off),
  // so `Component` types as `any` and subclasses don't inherit member types —
  // declare the two we use explicitly. Zero runtime emit (type-only fields).
  props!: Props;
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error reached the root boundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-6">
          <div className="max-w-md w-full text-center">
            <TriangleAlert
              className="mx-auto mb-4 h-12 w-12 text-amber-600"
              aria-hidden="true"
            />
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Something went wrong / 页面出错了
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              An unexpected error occurred. Reloading usually fixes it.
              <br />
              发生了意外错误，刷新页面通常即可恢复。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-700 hover:bg-blue-800 px-6 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              Reload / 刷新
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
