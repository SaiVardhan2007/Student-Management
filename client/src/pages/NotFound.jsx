import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="state">
        <h1>404</h1>
        <h3>Page not found</h3>
        <p>The page you are looking for doesn&apos;t exist or has moved.</p>
        <Link className="btn btn-primary" to="/">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
