import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

class ChaseCoverConfiguratorElement extends HTMLElement {
    connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        const container = document.createElement('div');
        container.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column';
        root.appendChild(container);

        // Web Component mode styling requires injecting styles into Shadow DOM
        // When vite-plugin-css-injected-by-js handles it, it injects into document.head.
        // For pure shadow DOM, we would normally grab styles but for Vite + React we just render.
        // Realistically you'd construct a style sheet here. 
        ReactDOM.createRoot(container).render(
            <React.StrictMode>
                <App />
            </React.StrictMode>
        );
    }
}

if (!customElements.get('chase-cover-configurator')) {
    customElements.define('chase-cover-configurator', ChaseCoverConfiguratorElement);
}

if (!customElements.get('chase-configurator')) {
    customElements.define('chase-configurator', ChaseCoverConfiguratorElement);
}
