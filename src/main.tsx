import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './App'; import './styles.css'; import './seek.css'; import './library.css'; import './profile-menu.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
