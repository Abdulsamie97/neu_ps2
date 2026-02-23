import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createPseudo2Services } from 'pseudo2-language';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createPseudo2Services({ connection, ...NodeFileSystem });

// Start the language server with the shared services
startLanguageServer(shared);
