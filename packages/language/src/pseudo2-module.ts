/**
 * @file pseudo2-module.ts
 * @brief Verdrahtet Lexer, Scoping und Validierung mit den Langium-Services.
 * @author Abdul
 */

import { type Module, inject } from 'langium';
import {
  createDefaultModule,
  createDefaultSharedModule,
  type DefaultSharedModuleContext,
  type LangiumServices,
  type LangiumSharedServices,
  type PartialLangiumServices
} from 'langium/lsp';
import { Pseudo2GeneratedModule, Pseudo2GeneratedSharedModule } from './generated/module.js';
import { Pseudo2Validator, registerValidationChecks } from './pseudo2-validator.js';
import { IndentationAwareLexer, IndentationAwareTokenBuilder } from 'langium';

// Scope provider
import { Pseudo2ScopeProvider } from './scoping/pseudo2-scope.js';

/**
 * Declaration of custom services - add your own service classes here.
 *
 * Enthält die zusätzlich zum Langium-Standard bereitgestellten Pseudo2-Dienste.
 */
export type Pseudo2AddedServices = {
  validation: {
    /** Sprachspezifischer Validator für semantische Pseudo2-Regeln. */
    Pseudo2Validator: Pseudo2Validator
  }
};

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 *
 * Dieser Typ wird von Scoping, Validator und allen Service-Konsumenten genutzt.
 */
export type Pseudo2Services = LangiumServices & Pseudo2AddedServices;

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services.
 *
 * Der indentation-aware TokenBuilder ignoriert Einrückungswechsel innerhalb
 * runder, eckiger und geschweifter Klammern. Zusätzlich werden eigener Lexer,
 * ScopeProvider und Validator in den Langium-Container eingesetzt.
 */
export const Pseudo2Module: Module<Pseudo2Services, PartialLangiumServices & Pseudo2AddedServices> = {
  parser: {
    /** Erstellt Token mit INDENT/DEDENT-Unterstützung außerhalb von Klammern. */
    TokenBuilder: () =>
      new IndentationAwareTokenBuilder({
        ignoreIndentationDelimiters: [
          ['(', ')'],
          ['[', ']'],
          ['{', '}']
        ]
      }),
    /** Erstellt den einrückungssensitiven Lexer mit den injizierten Services. */
    Lexer: services => new IndentationAwareLexer(services)
  },

  // register custom scope provider
  references: {
    /** Erstellt den Pseudo2-spezifischen ScopeProvider. */
    ScopeProvider: services => new Pseudo2ScopeProvider(services)
  },

  validation: {
    /** Erstellt eine Validator-Instanz für den Language-Service-Container. */
    Pseudo2Validator: () => new Pseudo2Validator()
  }
};

/**
 * Create the full set of services required by Langium.
 *
 * Zuerst werden gemeinsame Standard- und generierte Services injiziert, danach
 * die sprachspezifischen Standard-, generierten und benutzerdefinierten Module.
 * Abschließend wird Pseudo2 registriert, die Validierung aktiviert und bei
 * Betrieb ohne LSP-Verbindung der ConfigurationProvider initialisiert.
 *
 * @param context Dateisystem- und optionaler LSP-Verbindungskontext.
 * @returns Gemeinsame sowie Pseudo2-spezifische Langium-Services.
 */
export function createPseudo2Services(context: DefaultSharedModuleContext): {
  shared: LangiumSharedServices;
  Pseudo2: Pseudo2Services;
} {
  const shared = inject(createDefaultSharedModule(context), Pseudo2GeneratedSharedModule);

  const Pseudo2 = inject(createDefaultModule({ shared }), Pseudo2GeneratedModule, Pseudo2Module);

  shared.ServiceRegistry.register(Pseudo2);
  registerValidationChecks(Pseudo2);

  if (!context.connection) {
    shared.workspace.ConfigurationProvider.initialized({});
  }

  return { shared, Pseudo2 };
}
