import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Create a container div for the widget
const widgetContainer = document.createElement('div');
widgetContainer.id = 'gemini-voice-chatbot-widget-container';
document.body.appendChild(widgetContainer);

// Mount the App component into the container
const root = ReactDOM.createRoot(widgetContainer);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);