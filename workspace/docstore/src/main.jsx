import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';
import App from './App';

// React 진입점
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
