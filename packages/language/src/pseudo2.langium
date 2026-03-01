grammar Pseudo2

// ======================================================
// Program structure
// ======================================================

entry Program:
  instructions+=Instruction*;

Instruction:
    CompoundInstruction
  | SimpleStatement
;

CompoundInstruction:
    Block
  | IfStatement
  | WhileLoop
;

SimpleStatement:
    VarDeclaration
  | Assignment
;

// ======================================================
// Blocks
// ======================================================

Block:
    BracedBlock
  | IndentedBlock
;

BracedBlock:
  '{' instructions+=Instruction* '}'
;

IndentedBlock:
  INDENT instructions+=Instruction+ DEDENT
;

// ======================================================
// Variables: declaration & assignment (Xtext-style)
// ======================================================

VarDeclaration:
  'var' name=ID ('=' initializer=Expression)?
;

interface IdentifierRef { ref: @VarDeclaration }

IdentifierRefRule returns IdentifierRef:
  ref=[VarDeclaration:ID]
;

Assignment:
  target=IdentifierRefRule '=' value=Expression
;

// ======================================================
// If
// ======================================================

IfStatement:
  'if' condition=Expression thenBlock=Block
  ('else' elseBlock=Block)?
;

// ======================================================
// While Loop
// ======================================================
WhileLoop:
  'while' condition=Expression body=Block
;


// ======================================================
// Expression AST types (strict-friendly)
// ======================================================

interface Expr {}

interface Or extends Expr {
  left: Expr
  right: Expr[]
}

interface And extends Expr {
  left: Expr
  right: Expr[]
}

interface Equality extends Expr {
  left: Expr
  op: string[]
  right: Expr[]
}

interface Comparison extends Expr {
  left: Expr
  op: string[]
  right: Expr[]
}

interface Addition extends Expr {
  left: Expr
  op: string[]
  right: Expr[]
}

interface Multiplication extends Expr {
  left: Expr
  op: string[]
  right: Expr[]
}

interface Not extends Expr { value: Expr }
interface Neg extends Expr { value: Expr }

interface Grouping extends Expr { value: Expr }

interface IntLiteral extends Expr { value: number }
interface BoolLiteral extends Expr { value: 'true' | 'false' }
interface StringLiteral extends Expr { value: string }

interface VarRef extends Expr { ref: @VarDeclaration }

// ======================================================
// Expressions (precedence ladder)
// ======================================================

Expression returns Expr:
  Or
;

Or returns Or:
  left=And ( '||' right+=And )*
;

And returns And:
  left=Equality ( '&&' right+=Equality )*
;

Equality returns Equality:
  left=Comparison ( op+=('==' | '!=') right+=Comparison )*
;

Comparison returns Comparison:
  left=Addition ( op+=('<' | '<=' | '>' | '>=') right+=Addition )*
;

Addition returns Addition:
  left=Multiplication ( op+=('+' | '-') right+=Multiplication )*
;

Multiplication returns Multiplication:
  left=Unary ( op+=('*' | '/' | '%') right+=Unary )*
;

Unary returns Expr:
    NotRule
  | NegRule
  | Primary
;

NotRule returns Not:
  '!' value=Unary
;

NegRule returns Neg:
  '-' value=Unary
;

Primary returns Expr:
    GroupingRule
  | IntLit
  | BoolLit
  | StringLit
  | VarRefRule
;

GroupingRule returns Grouping:
  '(' value=Expression ')'
;

IntLit returns IntLiteral:
  value=INT
;

BoolLit returns BoolLiteral:
  value=('true' | 'false')
;

StringLit returns StringLiteral:
  value=STRING
;

VarRefRule returns VarRef:
  ref=[VarDeclaration:ID]
;

// ======================================================
// Terminals (ORDER MATTERS for indentation lexer!)
// ======================================================

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;

terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
terminal ID: /[_a-zA-Z][\w_]*/;