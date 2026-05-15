import type React from 'react';

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                ar?: boolean | string;
                'ar-modes'?: string;
                'camera-controls'?: boolean | string;
                'touch-action'?: string;
                'auto-rotate'?: boolean | string;
                'shadow-intensity'?: string | number;
                'environment-image'?: string;
                exposure?: string | number;
                alt?: string;
                src?: string;
                class?: string;
            };
        }
    }
}
