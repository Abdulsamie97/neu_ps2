/**
 * @file pseudo2-validator.d.ts
 * @brief Deklariert Registrierungsfunktion und Klasse des semantischen Pseudo2-Validators.
 * @author Abdul
 */

import type { ValidationAcceptor } from 'langium';

import type { Pseudo2Services } from './pseudo2-module.js';
/**
 * Register custom validation checks.
 *
 * Ordnet die relevanten Pseudo2-AST-Typen den Prüfmethoden der gemeinsamen
 * Validatorinstanz zu und registriert diese Zuordnung in Langiums ValidationRegistry.
 * @param services Pseudo2-Dienste mit Validator und Registrierungsdienst.
 */
export declare function registerValidationChecks(services: Pseudo2Services): void;
/**
 * Implementation of custom validations.
 *
 * Die konkrete TypeScript-Implementierung prüft Kontrollfluss, Deklarationen,
 * Typverträglichkeit, Aufrufkontexte, Struct-/Arrayzugriffe und VeriFast-Annotationen.
 */
export declare class Pseudo2Validator {
    //checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void;
}
