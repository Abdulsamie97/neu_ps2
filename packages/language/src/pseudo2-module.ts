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
 */
export type Pseudo2AddedServices = {
  validation: {
    Pseudo2Validator: Pseudo2Validator
  }
};

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type Pseudo2Services = LangiumServices & Pseudo2AddedServices;

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services.
 */
export const Pseudo2Module: Module<Pseudo2Services, PartialLangiumServices & Pseudo2AddedServices> = {
  parser: {
    TokenBuilder: () =>
      new IndentationAwareTokenBuilder({
        ignoreIndentationDelimiters: [
          ['(', ')'],
          ['[', ']'],
          ['{', '}']
        ]
      }),
    Lexer: services => new IndentationAwareLexer(services)
  },

  // register custom scope provider
  references: {
    ScopeProvider: services => new Pseudo2ScopeProvider(services)
  },

  validation: {
    Pseudo2Validator: () => new Pseudo2Validator()
  }
};

/**
 * Create the full set of services required by Langium.
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