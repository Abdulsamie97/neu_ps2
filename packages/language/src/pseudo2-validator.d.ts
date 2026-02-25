import type { ValidationAcceptor } from 'langium';

import type { Pseudo2Services } from './pseudo2-module.js';
/**
 * Register custom validation checks.
 */
export declare function registerValidationChecks(services: Pseudo2Services): void;
/**
 * Implementation of custom validations.
 */
export declare class Pseudo2Validator {
    //checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void;
}
