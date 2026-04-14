// packages/language/src/scoping/pseudo2-scope.ts

import type { AstNode, ReferenceInfo, Scope, AstNodeDescription } from 'langium';
import { AstUtils, DefaultScopeProvider, MapScope, EMPTY_SCOPE } from 'langium';
import type { Pseudo2Services } from '../pseudo2-module.js';

import type {
  Program,
  Instruction,
  Expr,
  VarDecl,
  FunctionDeclaration,
  StructDeclaration,
  IfStatement
} from '../generated/ast.js';

import {
  isVarRef,
  isAttRef,
  isMethRef,
  isFunctionCall,
  isFunctionDeclaration,
  isStructDeclaration,
  isStructAttDeclaration,
  isStructType,
  isNewExpr,

  isBracedBlock,
  isIndentedBlock,

  isIfStatement,
  isWhileLoop,
  isForLoop,
  isDoWhileLoop,

  isVarDecl,
  isReturnStmt,
  isAssignment,

  isAttSelection,
  isMethSelection
} from '../generated/ast.js';

import { Pseudo2TypeComputer, TypeComputationContext } from '../typing/pseudo2-type-computer.js';

type Named = { name: string };

export class Pseudo2ScopeProvider extends DefaultScopeProvider {
  private readonly descProvider: Pseudo2Services['workspace']['AstNodeDescriptionProvider'];
  private readonly types = new Pseudo2TypeComputer();

  constructor(services: Pseudo2Services) {
    super(services);
    this.descProvider = services.workspace.AstNodeDescriptionProvider;
  }

  override getScope(context: ReferenceInfo): Scope {
    const c = context.container;
    const r = context.reference;

    //console.log('[SCOPE] container=', c.$type, 'refText=', (r as any).$refText ?? 'n/a');

    // VarRef.ref
    if (isVarRef(c) && r === c.ref) {
      const vars = this.scopeForVarRef(c);
     // console.log('[VAR SCOPE]', vars.map(v => v.name));
      return this.scopeFromNamed(vars);
    }

    // FunctionCall.f (global functions)
    if (isFunctionCall(c) && r === c.f) {
      const fns = this.collectGlobalFunctions(c);
    //  console.log('[FUNC SCOPE]', fns.map(f => f.name));
      return this.scopeFromNodes(fns, f => f.name);
    }

    // StructType.struct / NewExpr.type (global structs)
    if (isStructType(c) && r === c.struct) {
      const structs = this.collectStructs(c);
   //   console.log('[STRUCT TYPE SCOPE]', structs.map(s => s.name));
      return this.scopeFromNodes(structs, s => s.name);
    }
    if (isNewExpr(c) && r === c.type) {
      const structs = this.collectStructs(c);
      //console.log('[NEW SCOPE]', structs.map(s => s.name));
      return this.scopeFromNodes(structs, s => s.name);
    }

    // AttRef.ref (member attributes)
    if (isAttRef(c) && r === c.ref) {
      const owner = AstUtils.getContainerOfType(c, isAttSelection);
      if (!owner) {
      //  console.log('[ATT SCOPE] no owner');
        return EMPTY_SCOPE;
      }

      const ctx = new TypeComputationContext();
      const parentType = this.types.typeFor(owner.receiver as Expr, ctx);
     // console.log('[ATT SCOPE] receiver type =', parentType.asString());

      if (!parentType.isStruct || parentType.name === '' || parentType.isUnknown()) {
      //  console.log('[ATT SCOPE] receiver type unknown');
        return EMPTY_SCOPE;
      }

      const sd = this.findStructByName(c, parentType.name);
      //console.log('[ATT SCOPE] struct found =', sd?.name ?? 'none');
      if (!sd) return EMPTY_SCOPE;

      const atts = (sd.children ?? []).filter(isStructAttDeclaration);
      //console.log('[ATT SCOPE] attrs =', atts.map(a => a.name));
      return this.scopeFromNodes(atts, a => a.name);
    }

    // MethRef.f (member methods)
    if (isMethRef(c) && r === c.f) {
      const owner = AstUtils.getContainerOfType(c, isMethSelection);
      if (!owner) {
        //console.log('[METH SCOPE] no owner');
        return EMPTY_SCOPE;
      }

      const ctx = new TypeComputationContext();
      const parentType = this.types.typeFor(owner.receiver as Expr, ctx);
      //console.log('[METH SCOPE] receiver type =', parentType.asString());

      if (!parentType.isStruct || parentType.name === '' || parentType.isUnknown()) {
       // console.log('[METH SCOPE] receiver type unknown');
        return EMPTY_SCOPE;
      }

      const sd = this.findStructByName(c, parentType.name);
     // console.log('[METH SCOPE] struct found =', sd?.name ?? 'none');
      if (!sd) return EMPTY_SCOPE;

      const methods = (sd.children ?? []).filter(isFunctionDeclaration);
     // console.log('[METH SCOPE] methods =', methods.map(m => m.name));
      return this.scopeFromNodes(methods, m => m.name);
    }

    return super.getScope(context);
  }

  private scopeFromNodes<T extends AstNode>(nodes: T[], nameOf: (n: T) => string): Scope {
    const descriptions: AstNodeDescription[] = nodes.map(n =>
      this.descProvider.createDescription(n, nameOf(n))
    );
    return new MapScope(descriptions, EMPTY_SCOPE);
  }

  private scopeFromNamed(nodes: Named[]): Scope {
    const astNodes = nodes as unknown as AstNode[];
    const descriptions: AstNodeDescription[] = astNodes.map((n, i) =>
      this.descProvider.createDescription(n, nodes[i].name)
    );
    return new MapScope(descriptions, EMPTY_SCOPE);
  }

  private scopeForVarRef(node: AstNode): Named[] {
    const currentInstr = this.getEnclosingInstruction(node);

    if (currentInstr) {
      const container = currentInstr.$container;
     // console.log('[VAR SCOPE] current instruction container =', container?.$type);

      if (isBracedBlock(container) || isIndentedBlock(container)) {
        const locals = this.extractVarDeclsBeforeCurrent(container.instructions ?? [], currentInstr);
      //  console.log('[VAR SCOPE] block locals =', locals.map(v => v.name));
        return this.dedupByName([...locals, ...this.scopeForVarRefFrom(container.$container)]);
      }

      if (isIfStatement(container)) {
        const locals = this.handleIfStatement(container, currentInstr);
      //  console.log('[VAR SCOPE] if locals =', locals.map(v => v.name));
        return this.dedupByName(locals);
      }

      if (isWhileLoop(container) || isDoWhileLoop(container)) {
        return this.dedupByName(this.scopeForVarRefFrom(container.$container));
      }

      if (isForLoop(container)) {
        const iter = container.iterator ? [container.iterator] : [];
    //    console.log('[VAR SCOPE] for iterator =', iter.map(v => v.name));
        return this.dedupByName([...iter, ...this.scopeForVarRefFrom(container.$container)]);
      }

      if (isFunctionDeclaration(container)) {
        const params = container.params ?? [];
        const globals = this.collectGlobalVars(container);
        const structAtts = this.collectEnclosingStructAttributes(container);
    //    console.log('[VAR SCOPE] fn params =', params.map(v => v.name));
     //   console.log('[VAR SCOPE] fn globals =', globals.map(v => v.name));
     //   console.log('[VAR SCOPE] fn structAtts =', structAtts.map(v => v.name));
        return this.dedupByName([...structAtts, ...params, ...globals]);
      }

      const program = this.getProgram(node);
      if (program) {
        const locals = this.extractVarDeclsBeforeCurrent(program.instructions, currentInstr);
      //  console.log('[VAR SCOPE] top locals =', locals.map(v => v.name));
        return this.dedupByName(locals);
      }

      return this.dedupByName(this.scopeForVarRefFrom(container));
    }

    const forLoop = AstUtils.getContainerOfType(node, isForLoop);
    if (forLoop?.iterator) {
      return this.dedupByName([forLoop.iterator, ...this.scopeForVarRefFrom(forLoop.$container)]);
    }

    return this.dedupByName(this.collectGlobalVars(node));
  }

  private collectEnclosingStructAttributes(from: AstNode): Named[] {
    const enclosingStruct = AstUtils.getContainerOfType(from, isStructDeclaration);
    if (!enclosingStruct) return [];
    const attrs = (enclosingStruct.children ?? []).filter(isStructAttDeclaration);
  //  console.log('[VAR SCOPE] enclosing struct attrs =', attrs.map(a => a.name), 'struct=', enclosingStruct.name);
    return attrs;
  }

  private scopeForVarRefFrom(container: AstNode | undefined): Named[] {
    if (!container) return [];

    const enclosingFn = AstUtils.getContainerOfType(container, isFunctionDeclaration);
    const params = enclosingFn?.params ?? [];
    const globals = this.collectGlobalVars(container);
    const structAtts = this.collectEnclosingStructAttributes(container);

  //  console.log('[VAR SCOPE FROM] params=', params.map(v => v.name), 'globals=', globals.map(v => v.name), 'structAtts=', structAtts.map(v => v.name));

    return [...structAtts, ...params, ...globals];
  }

  private handleIfStatement(ifStmt: IfStatement, currentInstr: Instruction): Named[] {
    const thenInstrs: Instruction[] = ifStmt.thenBlock?.instructions ?? [];
    const elseInstrs: Instruction[] = ifStmt.elseBlock?.instructions ?? [];

    const inThen = thenInstrs.includes(currentInstr);
    const list = inThen ? thenInstrs : elseInstrs;

    const locals = this.extractVarDeclsBeforeCurrent(list, currentInstr);
    return [...locals, ...this.scopeForVarRefFrom(ifStmt.$container)];
  }

  private extractVarDeclsBeforeCurrent(instrs: Instruction[], current: Instruction): VarDecl[] {
    const out: VarDecl[] = [];
    for (const i of instrs) {
      if (i === current) break;
      if (isVarDecl(i)) out.unshift(i);
    }
    return out;
  }

  private dedupByName(vars: Named[]): Named[] {
    const seen = new Set<string>();
    const out: Named[] = [];
    for (const v of vars) {
      if (!seen.has(v.name)) {
        seen.add(v.name);
        out.push(v);
      }
    }
    return out;
  }

  private getEnclosingInstruction(node: AstNode): Instruction | undefined {
    let n: AstNode | undefined = node;
    while (n) {
      if (this.isInstructionNode(n)) return n as Instruction;
      n = n.$container;
    }
    return undefined;
  }

  private isInstructionNode(n: AstNode): boolean {
    return (
      isBracedBlock(n) ||
      isIndentedBlock(n) ||
      isIfStatement(n) ||
      isWhileLoop(n) ||
      isForLoop(n) ||
      isDoWhileLoop(n) ||
      isFunctionDeclaration(n) ||
      isStructDeclaration(n) ||
      isVarDecl(n) ||
      isAssignment(n) ||
      isFunctionCall(n) ||
      isReturnStmt(n)
    );
  }

  private collectGlobalVars(from: AstNode): VarDecl[] {
    const program = this.getProgram(from);
    return program ? program.instructions.filter(isVarDecl) : [];
  }

  private collectGlobalFunctions(from: AstNode): FunctionDeclaration[] {
    const program = this.getProgram(from);
    return program ? program.instructions.filter(isFunctionDeclaration) : [];
  }

  private collectStructs(from: AstNode): StructDeclaration[] {
    const program = this.getProgram(from);
    return program ? program.instructions.filter(isStructDeclaration) : [];
  }

  private findStructByName(from: AstNode, name: string): StructDeclaration | undefined {
    const program = this.getProgram(from);
    if (!program) return undefined;
    return program.instructions.filter(isStructDeclaration).find(sd => sd.name === name);
  }

  private getProgram(node: AstNode): Program | undefined {
    const doc = AstUtils.getDocument(node);
    return doc.parseResult.value as unknown as Program;
  }
}