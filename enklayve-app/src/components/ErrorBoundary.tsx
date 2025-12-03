import { Component, ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('React Error Boundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleClearData = async (): Promise<void> => {
    try {
      // Clear local storage
      localStorage.clear();
      sessionStorage.clear();

      // Reload the page
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear data:', error);
      alert('Failed to clear data. Please try reloading the page manually.');
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>Something went wrong</h1>
            <p className="error-message">
              The application encountered an unexpected error and needs to restart.
            </p>

            {this.state.error && (
              <details className="error-details">
                <summary>Technical Details</summary>
                <div className="error-stack">
                  <p><strong>Error:</strong> {this.state.error.message}</p>
                  {this.state.error.stack && (
                    <pre>{this.state.error.stack}</pre>
                  )}
                  {this.state.errorInfo && (
                    <pre>{this.state.errorInfo.componentStack}</pre>
                  )}
                </div>
              </details>
            )}

            <div className="error-actions">
              <button onClick={this.handleReload} className="primary-button">
                Reload Application
              </button>
              <button onClick={this.handleClearData} className="secondary-button">
                Clear Data and Reload
              </button>
            </div>

            <p className="error-help">
              If this problem persists, please report it at the GitHub repository.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
