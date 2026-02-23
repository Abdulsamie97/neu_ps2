import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { Pseudo2AstType , Block } from './generated/ast.js';
import type { Pseudo2Services} from './pseudo2-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: Pseudo2Services) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.Pseudo2Validator;
    const checks: ValidationChecks<Pseudo2AstType> = {
       // Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class Pseudo2Validator {

  checkBlock(node: Block, accept: ValidationAcceptor): void {
    // Schritt 1: noch keine Regeln erzwingen.
    // Optional (nur wenn du willst):
    // if (node.instructions.length === 0) {
    //   accept('warning', 'Leerer Block.', { node });
    // }
  }

/*  checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }
*/
}
