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
  | StructDeclaration
  | VerificationStatementRule
  //| FunctionCall
  | ReturnStatement
  | ExprStatement
  | GlobalCommand
;

ExprStatement:
  expr=Expression
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
// Variable base type (VarDecl + Parameters + StructAtt are Variables)
// ======================================================

interface Variable {
  name: string    //Soll ID sein, wird auch so in Weboberfö#äche betrachtet
}

interface VarDecl extends Variable {
  initializer?: Expr
  isArrayVariable: boolean
  size?: Expr
}

interface ParameterDecl extends Variable {
  isArray: boolean
  start?: number
  len?: VarDecl
}

interface StructAttDeclaration extends Variable {
  type: TypeRef
  
}

// =====================================================
// Variables: declaration & assignment
// =====================================================

VarDeclaration returns VarDecl:
  'var' name=ID
  (isArrayVariable?='[' size=Expression ']')?
  ('=' initializer=Expression)?
;

Assignment:
  sel=Selection '=' value=Expression
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
  annotations+=LoopAnnotationRule*
  'while' condition=Expression body=Block
;


// ======================================================
// For / DoWhile
// ======================================================

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

LengthParameter returns VarDecl:
  name=ID
;

DoWhileLoop:
  annotations+=LoopAnnotationRule*
  'do' body=Block 'while' condition=Expression
;


// ======================================================
// Structs
// ======================================================

StructDeclaration:
  'struct' name=ID
  (
    '{' children+=StructDeclarationChild* '}'
    |
    INDENT children+=StructDeclarationChild+ DEDENT
  )
;

StructDeclarationChild:
    StructAttDeclarationRule
  | FunctionDeclaration
;

StructAttDeclarationRule returns StructAttDeclaration:
  type=TypeRef name=ID
;

// -------------------- Types --------------------

interface TypeRef {}
interface NonArrayTypeRef extends TypeRef {}

interface ArrayType extends TypeRef { base: NonArrayTypeRef }

interface NumType extends NonArrayTypeRef {}
interface StringType extends NonArrayTypeRef {}
interface BoolType extends NonArrayTypeRef {}
interface StructType extends NonArrayTypeRef { struct: @StructDeclaration }

TypeRef returns TypeRef:
    NonArrayTypeRefRule
  | ArrayTypeRule
;

ArrayTypeRule returns ArrayType:
  {ArrayType} base=NonArrayTypeRefRule '[' ']'
;

NonArrayTypeRefRule returns NonArrayTypeRef:
    NumTypeRule
  | StringTypeRule
  | BoolTypeRule
  | StructTypeRule
;

NumTypeRule returns NumType:
  {NumType} 'num'
;

StringTypeRule returns StringType:
  {StringType} 'string'
;

BoolTypeRule returns BoolType:
  {BoolType} 'bool'
;

StructTypeRule returns StructType:
  {StructType} struct=[StructDeclaration:ID]
;


// ======================================================
// Functions
// ======================================================
interface VerificationAnnotation {
  kind: string
  condition?: Expr
}

interface VerificationStatement {
  kind: string
  condition: Expr
}

interface LoopAnnotation {
  kind: string
  condition: Expr
}

VerificationAnnotationRule returns VerificationAnnotation:
    '@' kind=('requires' | 'ensures') condition=Expression
  | '@' kind='terminates'
;

VerificationStatementRule returns VerificationStatement:
  '@' kind=('assert' | 'assume' | 'open' | 'close' | 'leak') condition=Expression
;

LoopAnnotationRule returns LoopAnnotation:
  '@' kind=('invariant' | 'decreases') condition=Expression
;

interface FunctionDeclaration {
  annotations: VerificationAnnotation[]
  keyword: boolean
  name: string
  params: ParameterDecl[]
  body: Block
}

FunctionDeclaration returns FunctionDeclaration:
  annotations+=VerificationAnnotationRule*
  (keyword?='func')?
  name=ID
  '(' (params+=Parameter (',' params+=Parameter)*)? ')'
  body=Block
;


Parameter returns ParameterDecl:
  name=ID
  (
    isArray?='[' start=INT '..' len=LengthParameter ']' //start zu 1
  )?
;

FunctionCall:
  f=[FunctionDeclaration:ID]
  '(' (params+=Expression (',' params+=Expression)*)? ')'
;

ReturnStatement returns ReturnStmt:
  'return' retExpr=Expression?
;

interface ReturnStmt {
  retExpr?: Expr
}

// ======================================================
// print, throw and call
// ======================================================

interface PrintCommand {
  param: Expr
}

interface ThrowCommand {
  param: Expr
}

interface CallCommand {
  param: Expr
}

GlobalCommand:
    PrintCommandRule
  | ThrowCommandRule
  | CallCommandRule
;

PrintCommandRule returns PrintCommand:
  'print' param=Expression
;

ThrowCommandRule returns ThrowCommand:
  'throw' param=Expression
;

CallCommandRule returns CallCommand:
  'call' param=Expression
;

// ======================================================
// Expressions
// ======================================================

interface Expr {}

// ---- Selection / Access chain ----

// "this"
interface ThisExpr extends Expr {}
This returns ThisExpr:
  {ThisExpr} 'this'
;

// VarRef with optional array access: x or x[i]
interface VarRef extends Expr { ref: @Variable index?: Expr }
VarRefRule returns VarRef:
  {VarRef} ref=[Variable:ID] ('[' index=Expression ']')?
;

// Attribute ref: field or field[i]
interface AttRef { ref: @StructAttDeclaration index?: Expr }
AttRefRule returns AttRef:
  {AttRef} ref=[StructAttDeclaration:ID] ('[' index=Expression ']')?
;

// Method ref: method(args...)
interface MethRef { f: @FunctionDeclaration params: Expr[] }
MethRefRule returns MethRef:
  {MethRef} f=[FunctionDeclaration:ID]
  '(' (params+=Expression (',' params+=Expression)*)? ')'
;

// Selection chain node types
interface AttSelection extends Expr { receiver: Expr attref: AttRef }
interface MethSelection extends Expr { receiver: Expr methref: MethRef }

// Selection starts with VarRef or This, then .att / .meth(...) chain
Selection returns Expr:
  (VarRefRule | This)
  (
      ({AttSelection.receiver=current} '.' attref=AttRefRule)
    | ({MethSelection.receiver=current} '.' methref=MethRefRule)
  )*
;

// ---- Primary literals etc ----

interface Grouping extends Expr { value: Expr }
interface IntLiteral extends Expr { value: number }
interface BoolLiteral extends Expr { value: 'true' | 'false' }
interface StringLiteral extends Expr { value: string }

interface NullLiteral extends Expr {}
interface ResultExpr extends Expr {}
interface NewExpr extends Expr { type: @StructDeclaration }
interface ArrayLiteral extends Expr { elems: Expr[] }

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

NullLit returns NullLiteral:
  {NullLiteral} 'null'
;

ResultRule returns ResultExpr:
  {ResultExpr} 'result'
;

NewRule returns NewExpr:
  {NewExpr} 'new' type=[StructDeclaration:ID]
;

ArrayLiteralRule returns ArrayLiteral:
  {ArrayLiteral} '[' (elems+=Expression (',' elems+=Expression)*)? ']'
;

// ======================================================
// Precedence ladder
// ======================================================

interface Or extends Expr { left: Expr right: Expr[] }
interface And extends Expr { left: Expr right: Expr[] }

interface Equality extends Expr { left: Expr op: string[] right: Expr[] }
interface Comparison extends Expr { left: Expr op: string[] right: Expr[] }
interface Addition extends Expr { left: Expr op: string[] right: Expr[] }
interface Multiplication extends Expr { left: Expr op: string[] right: Expr[] }
interface Exponentiation extends Expr { left: Expr op: string[] right: Expr[] }

interface Not extends Expr { value: Expr }
interface Neg extends Expr { value: Expr }

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
  left=Exponentiation ( op+=('*' | '/' | '%' | 'mod') right+=Exponentiation )*
;

Exponentiation returns Exponentiation:
  left=Unary ( op+=('^') right+=Unary )*
;

Unary returns Expr:
    NotRule
  | NegRule
  | Primary
;

NotRule returns Not:
  {Not} '!' value=Unary
;

NegRule returns Neg:
  {Neg} '-' value=Unary
;

Primary returns Expr:
    GroupingRule
  | IntLit
  | BoolLit
  | StringLit
  | NullLit
  | ResultRule
  | NewRule
  | ArrayLiteralRule
  | Selection
  | FunctionCall
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
