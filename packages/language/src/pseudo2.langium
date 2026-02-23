grammar Pseudo2

//entry Model:
 //   (persons+=Person | greetings+=Greeting)*;

//Person:
//    'person' name=ID;

//Greeting:
//    'Hello' person=[Person:ID] '!';

entry Program:
  instructions+=Instruction*;


Instruction:
    CompoundInstruction
;

CompoundInstruction:
    Block
;

// --- blocks with braces
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





//hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';
hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;
