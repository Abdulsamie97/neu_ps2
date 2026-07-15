/**
 * @file main.ts
 * @brief Startet den Node-basierten Pseudo2-Language-Server für die VS-Code-Erweiterung.
 *
 * Der Prozess öffnet eine LSP-Verbindung, injiziert Dateisystem und Pseudo2-Dienste
 * und übergibt die gemeinsam genutzten Langium-Services an den Language Server.
 *
 * @author Abdul
 */

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createPseudo2Services } from 'pseudo2-language';

// Create a connection to the client
/** LSP-Verbindung zum von der VS-Code-Erweiterung gestarteten Client. */
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
/** Injizierte gemeinsame Langium-Dienste einschließlich Node-Dateisystem und LSP-Verbindung. */
const { shared } = createPseudo2Services({ connection, ...NodeFileSystem });

// Start the language server with the shared services
startLanguageServer(shared);
