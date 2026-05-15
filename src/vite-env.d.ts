/// <reference types="vite/client" />

declare module '*.css?inline' {
    const css: string;
    export default css;
}

declare module 'qrious' {
    export default class QRious {
        constructor(options: any);
    }
}
