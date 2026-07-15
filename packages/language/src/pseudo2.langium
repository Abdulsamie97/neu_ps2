/**
 * @file pseudo2.langium
 * @brief Definiert konkrete Syntax, AST-Struktur und Operatorpräzedenz der Pseudo2-Sprache.
 *
 * Die Grammatik unterstützt eingerückte und geklammerte Blöcke, Variablen, Arrays,
 * Structs, Funktionen, Methoden, Kontrollfluss, Ausdrücke sowie die in Pseudo2
 * eingebettete Annotationssyntax für VeriFast.
 *
 * @author Abdul
 */
grammar Pseudo2

// ======================================================
// Program structure
// ======================================================

/**
 * Einstiegspunkt eines Pseudo2-Dokuments.
 * Ein Programm besteht aus einer beliebig langen Folge globaler oder ausführbarer Anweisungen.
 */
entry Program:
  instructions+=Instruction*;

/** Vereinigt zusammengesetzte und einfache Anweisungen zum gemeinsamen Instruction-AST-Typ. */
Instruction:
    CompoundInstruction
  | SimpleStatement
;

/** Fasst Anweisungen mit eigenem Block oder verschachtelter Struktur zusammen. */
CompoundInstruction:
    Block
  | IfStatement
  | WhileLoop
  | ForLoop
  | DoWhileLoop
  | FunctionDeclaration
;

/** Fasst deklarative und direkt ausführbare Einzelanweisungen ohne eigenen Folgeblock zusammen. */
SimpleStatement:
    VarDeclaration
  | Assignment
  | StructDeclaration
  | VerificationStatementRule
  //| FunctionCall
  | ReturnStatement
  | ExprStatement
  | GlobalCommand
;

/** Erlaubt einen beliebigen Ausdruck als eigenständige Anweisung, etwa einen wertlosen Methodenaufruf. */
ExprStatement:
  expr=Expression
;


// ======================================================
// Blocks
// ======================================================

/** Abstrakte Blockregel für geklammerte und durch Einrückung begrenzte Anweisungsfolgen. */
Block:
    BracedBlock
  | IndentedBlock
;

/** Liest eine gegebenenfalls leere Anweisungsfolge zwischen geschweiften Klammern. */
BracedBlock:
  '{' instructions+=Instruction* '}'
;

/** Liest mindestens eine Anweisung zwischen synthetischem INDENT und DEDENT. */
IndentedBlock:
  INDENT instructions+=Instruction+ DEDENT
;


// ======================================================
// Variable base type (VarDecl + Parameters + StructAtt are Variables)
// ======================================================

/**
 * Gemeinsame AST-Schnittstelle aller benannten Variablenarten.
 * Der Name wird als Quellbezeichner gespeichert und durch Scoping aufgelöst.
 */
interface Variable {
  name: string    //Soll ID sein, wird auch so in Weboberfö#äche betrachtet
}

/** AST-Schnittstelle einer lokalen oder globalen Variablendeklaration einschließlich Arraymetadaten. */
interface VarDecl extends Variable {
  /** Optionaler Ausdruck, mit dem die Variable initialisiert wird. */
  initializer?: Expr
  /** Kennzeichnet die Deklarationsform `var name[size]`. */
  isArrayVariable: boolean
  /** Optionaler Größenausdruck einer Arrayvariablen. */
  size?: Expr
}

/** AST-Schnittstelle eines formalen Funktions- oder Methodenparameters. */
interface ParameterDecl extends Variable {
  /** Kennzeichnet einen Arrayparameter. */
  isArray: boolean
  /** Deklarierter Startindex des Arraybereichs. */
  start?: number
  /** Implizit deklarierter Parameter für die logische Arraylänge. */
  len?: VarDecl
}

/** AST-Schnittstelle eines benannten und explizit typisierten Struct-Attributs. */
interface StructAttDeclaration extends Variable {
  /** Deklarierter skalarer, Struct- oder Arraytyp des Attributs. */
  type: TypeRef
  
}

// =====================================================
// Variables: declaration & assignment
// =====================================================

/**
 * Liest `var`, einen Namen, eine optionale Arraygröße und einen optionalen Initialisierer.
 * Die Regel erzeugt direkt einen VarDecl-Knoten.
 */
VarDeclaration returns VarDecl:
  'var' name=ID
  (isArrayVariable?='[' size=Expression ']')?
  ('=' initializer=Expression)?
;

/** Liest eine Zuweisung an eine zuvor aufgelöste Selection. */
Assignment:
  sel=Selection '=' value=Expression
;

// ======================================================
// If
// ======================================================

/** Liest if mit obligatorischem then-Block und optionalem else-Block. */
IfStatement:
  'if' condition=Expression thenBlock=Block
  ('else' elseBlock=Block)?
;

// ======================================================
// While Loop
// ======================================================

/** Liest optionale Schleifenannotationen, Bedingung und Rumpf einer while-Schleife. */
WhileLoop:
  annotations+=LoopAnnotationRule*
  'while' condition=Expression body=Block
;


// ======================================================
// For / DoWhile
// ======================================================

/**
 * Liest eine auf- oder absteigende for-Schleife.
 * Iterator, Schrittweite und Einrückungs- beziehungsweise Klammerblock sind optional
 * beziehungsweise über die Blockregel vereinheitlicht.
 */
ForLoop:
  annotations+=LoopAnnotationRule*
  'for'
  (iterator=LengthParameter '=' )?
  from=Expression
  direction=('to' | 'downto')
  to=Expression
  ('by' step=Expression)?
  body=Block
;

/** Erzeugt den als VarDecl modellierten Iterator oder Längenparameter aus einem Bezeichner. */
LengthParameter returns VarDecl:
  name=ID
;

/** Liest eine do-while-Schleife mit vorangestellten VeriFast-Annotationen. */
DoWhileLoop:
  annotations+=LoopAnnotationRule*
  'do' body=Block 'while' condition=Expression
;


// ======================================================
// Structs
// ======================================================

/**
 * Liest eine Struct-Deklaration mit geklammerten oder eingerückten Attributen und Methoden.
 */
StructDeclaration:
  'struct' name=ID
  (
    '{' children+=StructDeclarationChild* '}'
    |
    INDENT children+=StructDeclarationChild+ DEDENT
  )
;

/** Gemeinsame Regel für ein Struct-Attribut oder eine im Struct definierte Methode. */
StructDeclarationChild:
    StructAttDeclarationRule
  | FunctionDeclaration
;

/** Liest Typ und Namen eines Struct-Attributs und erzeugt dessen AST-Schnittstelle. */
StructAttDeclarationRule returns StructAttDeclaration:
  type=TypeRef name=ID
;

// -------------------- Types --------------------

/** Marker-Schnittstelle aller in Pseudo2 zulässigen Typreferenzen. */
interface TypeRef {}
/** Marker-Schnittstelle für skalare und benannte Struct-Typen ohne Arraydimension. */
interface NonArrayTypeRef extends TypeRef {}

/** AST-Schnittstelle eines Arraytyps mit Basistyp und einer oder mehreren Dimensionen. */
interface ArrayType extends TypeRef {
  /** Nichtarrayförmiger Elementtyp. */
  base: NonArrayTypeRef
  /** Geordnete Liste der leeren `[]`-Dimensionsmarkierungen. */
  dimensions: ArrayDimension[]
}
/** AST-Marker einer einzelnen Arraydimension. */
interface ArrayDimension {}

/** AST-Marker des numerischen Basistyps `num`. */
interface NumType extends NonArrayTypeRef {}
/** AST-Marker des Basistyps `string`. */
interface StringType extends NonArrayTypeRef {}
/** AST-Marker des booleschen Basistyps `bool`. */
interface BoolType extends NonArrayTypeRef {}
/** AST-Typreferenz auf eine anhand ihres Namens aufgelöste Struct-Deklaration. */
interface StructType extends NonArrayTypeRef { struct: @StructDeclaration }

/** Wählt zwischen einer nichtarrayförmigen Typreferenz und einem Arraytyp. */
TypeRef returns TypeRef:
    NonArrayTypeRefRule
  | ArrayTypeRule
;

/** Erzeugt einen Arraytyp aus Basistyp und mindestens einer Dimension. */
ArrayTypeRule returns ArrayType:
  {ArrayType} base=NonArrayTypeRefRule dimensions+=ArrayDimensionRule+
;

/** Liest das leere Klammerpaar einer Arraydimension. */
ArrayDimensionRule returns ArrayDimension:
  {ArrayDimension} '[' ']'
;

/** Wählt einen eingebauten Basistyp oder einen benannten Struct-Typ. */
NonArrayTypeRefRule returns NonArrayTypeRef:
    NumTypeRule
  | StringTypeRule
  | BoolTypeRule
  | StructTypeRule
;

/** Liest das Schlüsselwort des numerischen Typs. */
NumTypeRule returns NumType:
  {NumType} 'num'
;

/** Liest das Schlüsselwort des Stringtyps. */
StringTypeRule returns StringType:
  {StringType} 'string'
;

/** Liest das Schlüsselwort des booleschen Typs. */
BoolTypeRule returns BoolType:
  {BoolType} 'bool'
;

/** Löst einen Typbezeichner auf eine vorhandene Struct-Deklaration auf. */
StructTypeRule returns StructType:
  {StructType} struct=[StructDeclaration:ID]
;


// ======================================================
// Functions
// ======================================================
/** AST-Schnittstelle einer Funktionsvor- oder -nachbedingung beziehungsweise Terminierungsangabe. */
interface VerificationAnnotation {
  /** Art der Annotation: requires, ensures oder terminates. */
  kind: string
  /** Logische Bedingung; bei terminates nicht vorhanden. */
  condition?: Expr
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
    '@' kind=('requires' | 'ensures') condition=Expression
  | '@' kind='terminates'
;

/** Liest eine eigenständige VeriFast-Anweisung mit ihrem Ausdruck. */
VerificationStatementRule returns VerificationStatement:
  '@' kind=('assert' | 'assume' | 'open' | 'close' | 'leak') condition=Expression
;

/** Liest eine vor einer Schleife stehende invariant- oder decreases-Annotation. */
LoopAnnotationRule returns LoopAnnotation:
  '@' kind=('invariant' | 'decreases') condition=Expression
;

/** AST-Schnittstelle für globale Funktionen und methodenartige Struct-Deklarationen. */
interface FunctionDeclaration {
  /** Vorangestellte Funktionsverträge. */
  annotations: VerificationAnnotation[]
  /** `true` bei vorhandenem `func`-Schlüsselwort, andernfalls Struct-Methode. */
  keyword: boolean
  /** Quellname der Funktion oder Methode. */
  name: string
  /** Geordnete formale Parameter. */
  params: ParameterDecl[]
  /** Funktions- beziehungsweise Methodenrumpf. */
  body: Block
}

/**
 * Liest Verträge, optionales `func`, Namen, Parameterliste und Rumpf einer Funktion oder Methode.
 */
FunctionDeclaration returns FunctionDeclaration:
  annotations+=VerificationAnnotationRule*
  (keyword?='func')?
  name=ID
  '(' (params+=Parameter (',' params+=Parameter)*)? ')'
  body=Block
;


/** Liest einen skalaren Parameter oder einen Arrayparameter der Form `A[start..length]`. */
Parameter returns ParameterDecl:
  name=ID
  (
    isArray?='[' start=INT '..' len=LengthParameter ']' //start zu 1
  )?
;

/** Löst einen globalen Funktionsnamen auf und liest die tatsächlichen Argumente. */
FunctionCall:
  f=[FunctionDeclaration:ID]
  '(' (params+=Expression (',' params+=Expression)*)? ')'
;

/** Liest return mit optionalem Rückgabeausdruck. */
ReturnStatement returns ReturnStmt:
  'return' retExpr=Expression?
;

/** AST-Schnittstelle einer return-Anweisung mit optionalem Wert. */
interface ReturnStmt {
  /** Zurückgegebener Ausdruck oder kein Wert bei einem leeren return. */
  retExpr?: Expr
}

// ======================================================
// print, throw and call
// ======================================================

/** AST-Schnittstelle des globalen print-Kommandos. */
interface PrintCommand {
  /** Auszugebender Pseudo2-Ausdruck. */
  param: Expr
}

/** AST-Schnittstelle des globalen throw-Kommandos. */
interface ThrowCommand {
  /** Als Fehler zu werfender Stringausdruck. */
  param: Expr
}

/** AST-Schnittstelle des expliziten call-Kommandos für wertlose Aufrufe. */
interface CallCommand {
  /** Als Anweisung auszuführender Funktions- oder Methodenaufruf. */
  param: Expr
}

/** Wählt eines der drei globalen Kommandos print, throw oder call. */
GlobalCommand:
    PrintCommandRule
  | ThrowCommandRule
  | CallCommandRule
;

/** Liest ein print-Kommando mit genau einem Ausdruck. */
PrintCommandRule returns PrintCommand:
  'print' param=Expression
;

/** Liest ein throw-Kommando mit genau einem Ausdruck. */
ThrowCommandRule returns ThrowCommand:
  'throw' param=Expression
;

/** Liest ein call-Kommando mit genau einem aufrufbaren Ausdruck. */
CallCommandRule returns CallCommand:
  'call' param=Expression
;

// ======================================================
// Expressions
// ======================================================

/** Gemeinsame Marker-Schnittstelle aller Pseudo2-Ausdrucksknoten. */
interface Expr {}

// ---- Selection / Access chain ----

// "this"
/** AST-Marker des aktuellen Methodenempfängers. */
interface ThisExpr extends Expr {}
/** Liest das Schlüsselwort `this`. */
This returns ThisExpr:
  {ThisExpr} 'this'
;

// VarRef with optional array access: x or x[i]
/** Referenziert eine sichtbare Variable und enthält optional einen direkten Arrayindex. */
interface VarRef extends Expr { ref: @Variable index?: Expr }
/** Löst einen Variablennamen auf und liest optional einen einsbasierten Indexausdruck. */
VarRefRule returns VarRef:
  {VarRef} ref=[Variable:ID] ('[' index=Expression ']')?
;

// Attribute ref: field or field[i]
/** Referenziert ein Struct-Attribut und enthält optional dessen Arrayindex. */
interface AttRef { ref: @StructAttDeclaration index?: Expr }
/** Löst einen Attributnamen im Struct-Kontext auf und liest optional einen Index. */
AttRefRule returns AttRef:
  {AttRef} ref=[StructAttDeclaration:ID] ('[' index=Expression ']')?
;

// Method ref: method(args...)
/** Referenziert eine Methode und speichert ihre tatsächlichen Argumente. */
interface MethRef { f: @FunctionDeclaration params: Expr[] }
/** Löst einen Methodennamen auf und liest dessen Argumentliste. */
MethRefRule returns MethRef:
  {MethRef} f=[FunctionDeclaration:ID]
  '(' (params+=Expression (',' params+=Expression)*)? ')'
;

// Selection chain node types
/** AST-Knoten eines Attributzugriffs auf einen vorhergehenden Empfängerausdruck. */
interface AttSelection extends Expr { receiver: Expr attref: AttRef }
/** AST-Knoten eines Methodenaufrufs auf einen vorhergehenden Empfängerausdruck. */
interface MethSelection extends Expr { receiver: Expr methref: MethRef }
/** AST-Knoten eines zusätzlichen Indexzugriffs auf einen vorhergehenden Ausdruck. */
interface IndexSelection extends Expr { receiver: Expr index: Expr }

// Selection starts with VarRef or This, then .att / .meth(...) chain
/**
 * Baut aus Variable oder `this` eine beliebig lange Zugriffs- und Aufrufkette.
 * Langium-Actions übernehmen jeweils den bisher gelesenen Ausdruck als Empfänger des
 * neu erzeugten IndexSelection-, AttSelection- oder MethSelection-Knotens.
 */
Selection returns Expr:
  (VarRefRule | This)
  (
      ({IndexSelection.receiver=current} '[' index=Expression ']')
    | ({AttSelection.receiver=current} '.' attref=AttRefRule)
    | ({MethSelection.receiver=current} '.' methref=MethRefRule)
  )*
;

// ---- Primary literals etc ----

/** AST-Knoten eines geklammerten Ausdrucks. */
interface Grouping extends Expr { value: Expr }
/** AST-Knoten eines nichtnegativen Ganzzahlliterals. */
interface IntLiteral extends Expr { value: number }
/** AST-Knoten eines booleschen Literals. */
interface BoolLiteral extends Expr { value: 'true' | 'false' }
/** AST-Knoten eines ein- oder doppelt gequoteten Stringliterals. */
interface StringLiteral extends Expr { value: string }

/** AST-Marker des Nullwerts. */
interface NullLiteral extends Expr {}
/** AST-Marker des VeriFast-Rückgabeplatzhalters `result`. */
interface ResultExpr extends Expr {}
/** AST-Knoten eines eingebauten `vf_*`-Prädikats mit variabler Argumentliste. */
interface SpecPredicateExpr extends Expr { kind: string args: Expr[] }
/** AST-Knoten der Konstruktion einer referenzierten Struct-Deklaration. */
interface NewExpr extends Expr { type: @StructDeclaration }
/** AST-Knoten eines gegebenenfalls leeren Arrayliterals. */
interface ArrayLiteral extends Expr { elems: Expr[] }

/** Liest einen geklammerten Ausdruck und erhält die Gruppierung explizit im AST. */
GroupingRule returns Grouping:
  '(' value=Expression ')'
;

/** Liest ein Ganzzahlliteral über das INT-Terminal. */
IntLit returns IntLiteral:
  value=INT
;

/** Liest die booleschen Schlüsselwörter true und false. */
BoolLit returns BoolLiteral:
  value=('true' | 'false')
;

/** Liest ein Stringliteral über das STRING-Terminal. */
StringLit returns StringLiteral:
  value=STRING
;

/** Liest den Nullwert. */
NullLit returns NullLiteral:
  {NullLiteral} 'null'
;

/** Liest den ausschließlich in Funktionsnachbedingungen gültigen Platzhalter `result`. */
ResultRule returns ResultExpr:
  {ResultExpr} 'result'
;

/**
 * Liest alle eingebauten VeriFast-Modellprädikate und ihre optionale Argumentliste.
 * Stelligkeit und prädikatspezifische Literalbedingungen werden semantisch validiert.
 */
SpecPredicateRule returns SpecPredicateExpr:
  {SpecPredicateExpr} kind=('vf_value' | 'vf_number' | 'vf_integer' | 'vf_array' | 'vf_struct' | 'vf_len' | 'vf_int' | 'vf_real' | 'vf_ratio' | 'vf_bool' | 'vf_truthy' | 'vf_string' | 'vf_null' | 'vf_undefined' | 'vf_elem' | 'vf_field' | 'vf_in_bounds' | 'vf_same')
  '(' (args+=Expression (',' args+=Expression)*)? ')'
;

/** Liest `new` und löst den folgenden Namen auf eine Struct-Deklaration auf. */
NewRule returns NewExpr:
  {NewExpr} 'new' type=[StructDeclaration:ID]
;

/** Liest ein leeres oder kommasepariertes Arrayliteral. */
ArrayLiteralRule returns ArrayLiteral:
  {ArrayLiteral} '[' (elems+=Expression (',' elems+=Expression)*)? ']'
;

// ======================================================
// Precedence ladder
// ======================================================

/** AST-Knoten einer ODER-Kette mit erstem und nachfolgenden Operanden. */
interface Or extends Expr { left: Expr right: Expr[] }
/** AST-Knoten einer UND-Kette mit erstem und nachfolgenden Operanden. */
interface And extends Expr { left: Expr right: Expr[] }

/** AST-Knoten einer Gleichheitskette und ihrer Operatoren. */
interface Equality extends Expr { left: Expr op: string[] right: Expr[] }
/** AST-Knoten einer ordnenden Vergleichskette und ihrer Operatoren. */
interface Comparison extends Expr { left: Expr op: string[] right: Expr[] }
/** AST-Knoten einer Additions-/Subtraktionskette. */
interface Addition extends Expr { left: Expr op: string[] right: Expr[] }
/** AST-Knoten einer Multiplikations-, Divisions- oder Modulo-Kette. */
interface Multiplication extends Expr { left: Expr op: string[] right: Expr[] }
/** AST-Knoten einer Potenzkette. */
interface Exponentiation extends Expr { left: Expr op: string[] right: Expr[] }

/** AST-Knoten der logischen Negation. */
interface Not extends Expr { value: Expr }
/** AST-Knoten des unären numerischen Minus. */
interface Neg extends Expr { value: Expr }

/** Einstiegspunkt der Ausdrucksgrammatik auf der niedrigsten Präzedenzstufe. */
Expression returns Expr:
  Or
;

/** Liest linksassoziative logische ODER-Verknüpfungen. */
Or returns Or:
  left=And ( '||' right+=And )*
;

/** Liest linksassoziative logische UND-Verknüpfungen. */
And returns And:
  left=Equality ( '&&' right+=Equality )*
;

/** Liest verkettete Gleichheits- und Ungleichheitsoperatoren. */
Equality returns Equality:
  left=Comparison ( op+=('==' | '!=') right+=Comparison )*
;

/** Liest verkettete numerische Ordnungsvergleiche. */
Comparison returns Comparison:
  left=Addition ( op+=('<' | '<=' | '>' | '>=') right+=Addition )*
;

/** Liest Additionen und Subtraktionen. */
Addition returns Addition:
  left=Multiplication ( op+=('+' | '-') right+=Multiplication )*
;

/** Liest Multiplikation, Division sowie `%` und `mod`. */
Multiplication returns Multiplication:
  left=Exponentiation ( op+=('*' | '/' | '%' | 'mod') right+=Exponentiation )*
;

/** Liest Potenzen oberhalb der multiplikativen Präzedenzstufe. */
Exponentiation returns Exponentiation:
  left=Unary ( op+=('^') right+=Unary )*
;

/** Wählt logische Negation, numerisches Vorzeichen oder einen Primärausdruck. */
Unary returns Expr:
    NotRule
  | NegRule
  | Primary
;

/** Liest eine rekursive logische Negation. */
NotRule returns Not:
  {Not} '!' value=Unary
;

/** Liest ein rekursives unäres Minus. */
NegRule returns Neg:
  {Neg} '-' value=Unary
;

/**
 * Wählt Literale, Gruppierungen, Konstruktionen, Selektionen und globale Aufrufe als
 * atomare Ausdrücke der Präzedenzleiter.
 */
Primary returns Expr:
    GroupingRule
  | IntLit
  | BoolLit
  | StringLit
  | NullLit
  | ResultRule
  | SpecPredicateRule
  | NewRule
  | ArrayLiteralRule
  | Selection
  | FunctionCall
;


// ======================================================
// Terminals
// ======================================================

/** Synthetisches Terminal, das der Indentation-Aware-Lexer beim Einrücken einfügt. */
terminal INDENT: 'synthetic:indent';
/** Synthetisches Terminal, das der Indentation-Aware-Lexer beim Ausrücken einfügt. */
terminal DEDENT: 'synthetic:dedent';

/** Verstecktes Terminal für mehrzeilige Kommentare, einschließlich Doxygen-Blöcken. */
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
/** Verstecktes Terminal für einzeilige Kommentare bis zum Zeilenende. */
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

/** Ignoriert horizontale Leerzeichen; Zeilenumbrüche werden separat verarbeitet. */
hidden terminal WS: /[\t ]+/;
/** Ignoriert einen oder mehrere Windows- oder Unix-Zeilenumbrüche. */
hidden terminal NL: /[\r\n]+/;

/** Liest eine Folge dezimaler Ziffern und konvertiert sie in eine Zahl. */
terminal INT returns number: /[0-9]+/;
/** Liest ein- oder doppelt gequotete Strings einschließlich Escape-Sequenzen. */
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
/** Liest Pseudo2-Bezeichner mit Buchstabe oder Unterstrich am Anfang. */
terminal ID: /[_a-zA-Z][\w_]*/;
