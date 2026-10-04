import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state error" role="alert" style={{ minHeight: '60vh' }}>
        <h3>This page ran into a problem</h3>
        <p>An unexpected error occurred while displaying this screen. Your data is safe.</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            this.setState({ error: null });
            window.location.assign('/');
          }}
        >
          Back to dashboard
        </button>
      </div>
    );
  }
}
