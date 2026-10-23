import React from 'react';
import ReactDOM from 'react-dom/client';
import WorkspaceHost from './components/WorkspaceHost';
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary';
import {AuthProvider} from './domain/auth';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><WorkspaceErrorBoundary><AuthProvider><WorkspaceHost/></AuthProvider></WorkspaceErrorBoundary></React.StrictMode>);
