/**
 * @file pseudo2-verifast.langium
 * @brief Definiert die in Pseudo2 eingebettete VeriFast-Annotationssyntax.
 *
 * Funktionsvertraege, Schleifenannotationen, Verifikationsanweisungen und
 * Spezifikationsausdruecke verwenden den gemeinsamen Pseudo2-Ausdruckstyp.
 * Der Rueckimport ist noetig, weil die eingebettete Ausdruckspraezedenz und Expr
 * aus der Hauptgrammatik wiederverwendet werden.
 *
 * @author Abdul
 */
import './pseudo2'

/** Einstiegspunkt fuer VeriFast-Ausdruecke innerhalb von Annotationen. */
VerificationExpression returns Expr:
  VerificationOr
;

/** Liest ODER-Verknuepfungen aus VeriFast-Spezifikationen. */
VerificationOr returns Or:
  left=VerificationAnd ( '||' right+=VerificationAnd )*
;

/** Liest sowohl logisches als auch separierendes UND in VeriFast-Spezifikationen. */
VerificationAnd returns And:
  left=Equality<spec=true> ( op+=('&&' | SeparatingConjunction) right+=Equality<spec=true> )*
;

/** Liest die räumliche Konjunktion aus VeriFast als booleschen Operator. */
SeparatingConjunction returns string:
  '&*&'
;

/** Verstecktes Terminal für einzeilige Kommentare; `//@` bleibt als Annotation sichtbar. */
hidden terminal SL_COMMENT: /\/\/(?!@)[^\n\r]*/;

/** AST-Schnittstelle einer Funktionsvor- oder -nachbedingung beziehungsweise Terminierungsangabe. */
interface VerificationAnnotation {
  /** Art der Annotation: requires, ensures oder terminates. */
  kind: string
  /** Logische Bedingung; bei terminates nicht vorhanden. */
  condition?: Expr
}

/** AST-Knoten einer in Spezifikationen und normalen Ausdrücken verwendbaren C-Ganzzahlgrenze. */
interface SpecConstantExpr extends Expr {
  /** Unterstützte Grenze aus limits.h. */
  value: string
}

/** AST-Schnittstelle einer ausführungsnahen VeriFast-Anweisung. */
interface VerificationStatement {
  /** Art der Anweisung: assert, assume, open, close oder leak. */
  kind: string
  /** Zu prüfender oder zu manipulierender Spezifikationsausdruck. */
  condition: Expr
}

/** AST-Schnittstelle einer Schleifeninvariante oder Abnahmeklausel. */
interface LoopAnnotation {
  /** Art der Annotation: invariant oder decreases. */
  kind: string
  /** Logischer Ausdruck der Schleifenannotation. */
  condition: Expr
}

/** Liest requires, ensures und die parameterlose terminates-Annotation einer Funktion. */
VerificationAnnotationRule returns VerificationAnnotation:
    ('@' | '//@') kind=('requires' | 'ensures') condition=VerificationExpression
  | ('@' | '//@') kind='terminates'
;

/** Liest eine eigenständige VeriFast-Anweisung mit ihrem Ausdruck. */
VerificationStatementRule returns VerificationStatement:
  ('@' | '//@') kind=('assert' | 'assume' | 'open' | 'close' | 'leak') condition=VerificationExpression
;

/** Liest eine vor einer Schleife stehende invariant- oder decreases-Annotation. */
LoopAnnotationRule returns LoopAnnotation:
  ('@' | '//@') kind=('invariant' | 'decreases') condition=VerificationExpression
;

/** AST-Marker des VeriFast-Rückgabeplatzhalters `result`. */
interface ResultExpr extends Expr {}
/** Nur in Annotationen erlaubter Vergleichswert für ein nicht initialisiertes Struct-Feld. */
interface UndefinedSpecExpr extends Expr {}
/** AST-Knoten eines eingebauten Annotationsprädikats mit variabler Argumentliste. */
interface SpecPredicateExpr extends Expr { kind: string args: Expr[] }

/** Liest den ausschließlich in Funktionsnachbedingungen gültigen Platzhalter `result`. */
ResultRule returns ResultExpr:
  {ResultExpr} 'result'
;

/** Liest `undefined` als Pseudo2-Spezifikationsliteral. */
UndefinedSpecRule returns UndefinedSpecExpr:
  {UndefinedSpecExpr} 'undefined'
;

/**
 * Liest alle eingebauten VeriFast-Modellprädikate und ihre optionale Argumentliste.
 * Stelligkeit und prädikatspezifische Literalbedingungen werden semantisch validiert.
 */
SpecPredicateRule<spec> returns SpecPredicateExpr:
  {SpecPredicateExpr} kind=('length' | 'vf_value' | 'vf_number' | 'vf_integer' | 'vf_array' | 'vf_struct' | 'vf_len' | 'vf_int' | 'vf_real' | 'vf_ratio' | 'vf_bool' | 'vf_truthy' | 'vf_string' | 'vf_null' | 'vf_undefined' | 'vf_elem' | 'vf_field' | 'vf_in_bounds' | 'vf_same')
  '(' (args+=ModeExpression<spec> (',' args+=ModeExpression<spec>)*)? ')'
;

/** Liest die C-Ganzzahlgrenzen, die in natürlichen VeriFast-Verträgen verwendet werden können. */
SpecConstantRule returns SpecConstantExpr:
  {SpecConstantExpr} value=('INT_MAX' | 'INT_MIN')
;
