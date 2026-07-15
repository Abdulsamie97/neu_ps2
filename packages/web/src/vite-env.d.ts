/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file vite-env.d.ts
 * @brief Deklariert die von Vite bereitgestellten Raw- und Worker-URL-Modulimporte.
 */

/// <reference types="vite/client" />

/** @brief Beschreibt einen Vite-Import, der eine Datei unverändert als Text lädt. */
declare module '*?raw' {
    /** @brief Enthält den vollständigen Textinhalt der importierten Datei. */
    const content: string;
    export default content;
}

/** @brief Beschreibt einen Vite-Import, der die gebündelte URL eines Web Workers liefert. */
declare module '*?worker&url' {
    /** @brief Enthält die von Vite erzeugte URL des Worker-Bundles. */
    const content: string;
    export default content;
}
