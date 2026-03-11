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
  | ForLoop
  | DoWhileLoop
  | FunctionDeclaration
;

SimpleStatement:
    VarDeclaration
  | Assignment
  | FunctionCall
  | ReturnStatement
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

// Instruction* caused an error (keep +)
IndentedBlock:
  INDENT instructions+=Instruction+ DEDENT
;

// ======================================================
// Variables: declaration & assignment
// ======================================================

VarDeclaration returns VarDecl:
  'var' name=ID ('=' initializer=Expression)?
;

IdentifierRefRule returns IdentifierRef:
  ref=[Variable:ID]
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
// For / DoWhile
// ======================================================

ForLoop:
  'for'
  (iterator=LengthParameter '=' )?
  from=Expression
  direction=('to' | 'downto')
  to=Expression
  ('by' step=Expression)?
  body=Block
;

LengthParameter returns VarDecl:
  name=ID
;

DoWhileLoop:
  'do' body=Block 'while' condition=Expression
;

// ======================================================
// Functions
// ======================================================

FunctionDeclaration:
  (keyword?='func')? name=ID
  '(' (params+=Parameter (',' params+=Parameter)*)? ')'
  body=Block
;

Parameter returns ParameterDecl:
  name=ID
;

FunctionCall:
  f=[FunctionDeclaration:ID]
  '(' (params+=Expression (',' params+=Expression)*)? ')'
;

// Langium strict-friendly return statement
ReturnStatement returns ReturnStmt:
  'return' retExpr=Expression?
;

// ======================================================
// Expression AST types (wegen langium strict mode)
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

interface VarRef extends Expr { ref: @Variable }

// ======================================================
// Variable-related AST types (common for VarDecl + ParameterDecl)
// ======================================================

interface Variable {
  name: string
}

// ======================================================
// Explicit statement-related AST types
// ======================================================

interface VarDecl extends Variable {
  initializer?: Expr
}

interface IdentifierRef { ref: @Variable }

// ======================================================
// Function-related AST types
// ======================================================

interface ParameterDecl extends Variable {
}

interface ReturnStmt {
  retExpr?: Expr
}

// ======================================================
// Expressions
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
  | FunctionCall
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
  ref=[Variable:ID]
;

// ======================================================
// Terminals
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