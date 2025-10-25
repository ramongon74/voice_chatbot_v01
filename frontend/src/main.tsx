import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const widgetContainer = document.createElement('div');
widgetContainer.id = 'gemini-voice-chatbot-widget-container';
document.body.appendChild(widgetContainer);

ReactDOM.createRoot(widgetContainer).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
