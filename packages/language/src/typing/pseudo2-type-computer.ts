// packages/language/src/typing/pseudo2-type-computer.ts

import { AstUtils } from 'langium';
//import type { AstNode } from 'langium';

import type {
  Expr,
  Addition,
  FunctionCall,
  FunctionDeclaration,
  ReturnStmt,
  VarDecl,
  ParameterDecl,
 // MethRef,
  TypeRef,
  ArrayType,
  StructType,
  ThisExpr,
  NewExpr,
  VarRef,
  AttSelection,
  MethSelection,
  StructAttDeclaration,
  ArrayLiteral,
  //Exponentiation
} from '../generated/ast.js';

import {
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isExponentiation,
  isNot,
  isNeg,
  isGrouping,
  isIntLiteral,
  isBoolLiteral,
  isStringLiteral,
  isNullLiteral,
  isNewExpr,
  isThisExpr,
  isVarRef,
  isAttSelection,
  isMethSelection,
  isFunctionCall,
  isFunctionDeclaration,
  isReturnStmt,
  isVarDecl,
  isParameterDecl,
 // isMethRef,
  isStructDeclaration,
  isArrayType,
  isStructType,
  isStructAttDeclaration,
  isArrayLiteral
} from '../generated/ast.js';

import {
  Pseudo2Type,
  TYPE_BOOL,
  TYPE_NUM,
  TYPE_STRING,
  TYPE_UNKNOWN,
  TYPE_STRUCT_UNKNOWN,
  TYPE_STRUCT
} from './pseudo2-type.js';

const TYPE_ARRAY_UNKNOWN = Pseudo2Type.create({ name: '', isStruct: false, isArray: true });

export class TypeComputationContext {
  readonly vars = new Set<VarDecl | ParameterDecl | StructAttDeclaration>();
  readonly fns = new Set<FunctionDeclaration>();
  readonly exps = new Set<Expr>();

  addVar(v: VarDecl | ParameterDecl | StructAttDeclaration): void { this.vars.add(v); }
  hasVar(v: VarDecl | ParameterDecl | StructAttDeclaration): boolean { return this.vars.has(v); }

  addFn(f: FunctionDeclaration): void { this.fns.add(f); }
  hasFn(f: FunctionDeclaration): boolean { return this.fns.has(f); }

  addExp(e: Expr): void { this.exps.add(e); }
  hasExp(e: Expr): boolean { return this.exps.has(e); }

  copy(): TypeComputationContext {
    const c = new TypeComputationContext();
    for (const v of this.vars) c.vars.add(v);
    for (const f of this.fns) c.fns.add(f);
    for (const e of this.exps) c.exps.add(e);
    return c;
  }
}

export class Pseudo2TypeComputer {
  typeFor(e: Expr | undefined | null, ctx = new TypeComputationContext()): Pseudo2Type {
    if (!e) return TYPE_UNKNOWN;

    if (ctx.hasExp(e)) return TYPE_UNKNOWN; // cycle protection
    ctx.addExp(e);

    // ---- boolean operators ----
    if (isOr(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;
    if (isAnd(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;

    if (isEquality(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;
    if (isComparison(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;

    // ---- arithmetic ----
    if (isAddition(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : this.handlePlus(e, ctx);
    if (isMultiplication(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_NUM;
    if (isExponentiation(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_NUM;

    // ---- unary ----
    if (isNot(e)) return TYPE_BOOL;
    if (isNeg(e)) return TYPE_NUM;

    // ---- literals / grouping ----
    if (isGrouping(e)) return this.typeFor(e.value, ctx);
    if (isIntLiteral(e)) return TYPE_NUM;
    if (isBoolLiteral(e)) return TYPE_BOOL;
    if (isStringLiteral(e)) return TYPE_STRING;
    if (isNullLiteral(e)) return TYPE_STRUCT_UNKNOWN;
    if (isArrayLiteral(e)) return this.handleArrayLiteral(e, ctx);

    // ---- object / struct ----
    if (isNewExpr(e)) return this.handleNew(e);
    if (isThisExpr(e)) return this.handleThis(e);

    // ---- references / selection ----
    if (isVarRef(e)) return this.handleVarRef(e, ctx);
    if (isAttSelection(e)) return this.handleAttSelection(e, ctx);
    if (isMethSelection(e)) return this.handleMethSelection(e, ctx);
    if (isFunctionCall(e)) return this.handleFunctionCall(e, ctx);

    return TYPE_UNKNOWN;
  }

  structNameOf(e: Expr, ctx = new TypeComputationContext()): string | undefined {
    const t = this.typeFor(e, ctx);
    return t.isStruct && t.name ? t.name : undefined;
  }

  // ---- handlers ----
  private handleThis(e: ThisExpr): Pseudo2Type {
    const sd = AstUtils.getContainerOfType(e, isStructDeclaration);
    return sd ? TYPE_STRUCT(sd.name) : TYPE_UNKNOWN;
  }

  private handleNew(e: NewExpr): Pseudo2Type {
    const sd = e.type?.ref;
    return sd ? TYPE_STRUCT(sd.name) : TYPE_UNKNOWN;
  }

  private handleArrayLiteral(e: ArrayLiteral, ctx: TypeComputationContext): Pseudo2Type {
    const elems = e.elems ?? [];
    if (elems.length === 0) return TYPE_ARRAY_UNKNOWN;
    const firstType = this.typeFor(elems[0], ctx.copy());
    return Pseudo2Type.create({
      name: firstType.name,
      isStruct: firstType.isStruct,
      isArray: true
    });
  }

  private handlePlus(e: Addition, ctx: TypeComputationContext): Pseudo2Type {
    const parts: Expr[] = [e.left, ...(e.right ?? [])];
    const types = parts.map(p => this.typeFor(p, ctx.copy()));

    // any unknown → unknown
    if (types.some(t => t.isUnknown())) return TYPE_UNKNOWN;

    // invalid types → unknown
    if (types.some(t => t.isSameAs(TYPE_BOOL) || t.isArrayType() || t.isStructType())) return TYPE_UNKNOWN;

    // if any string → string
    if (types.some(t => t.isSameAs(TYPE_STRING))) return TYPE_STRING;

    return TYPE_NUM;
  }

  private handleVarRef(v: VarRef, ctx: TypeComputationContext): Pseudo2Type {
    const target = v.ref?.ref;
    if (!target) return TYPE_UNKNOWN;

    if (isVarDecl(target)) {
      if (this.isLengthParameterDecl(target)) return TYPE_NUM;
      if (ctx.hasVar(target)) return TYPE_UNKNOWN;

      const c2 = ctx.copy();
      c2.addVar(target);

      let t: Pseudo2Type;

      if ((target as any).isArrayVariable === true) {
        if (target.initializer) {
          const initType = this.typeFor(target.initializer, c2);
          t = Pseudo2Type.create({
            name: initType.name,
            isStruct: initType.isStruct,
            isArray: true
          });
        } else {
          t = TYPE_ARRAY_UNKNOWN;
        }
      } else {
        if (!target.initializer) return TYPE_UNKNOWN;
        t = this.typeFor(target.initializer, c2);
      }

      if (v.index) {
        t = t.asBaseType();
      }

      return t;
    }

    if (isParameterDecl(target)) {
      let t = this.handleParameter(target, ctx);
      if (v.index) t = t.asBaseType();
      return t;
    }

    if (isStructAttDeclaration(target)) {
      if (!target.type) return TYPE_UNKNOWN;
      if (ctx.hasVar(target)) return TYPE_UNKNOWN;

      const c2 = ctx.copy();
      c2.addVar(target);

      let t = this.typeForTypeRef(target.type);
      if (v.index) t = t.asBaseType();
      return t;
    }

    return TYPE_UNKNOWN;
  }

  /*
  private handleParameter(p: ParameterDecl, ctx: TypeComputationContext): Pseudo2Type {
    const defaultUnknown = p.isArray ? TYPE_ARRAY_UNKNOWN : TYPE_UNKNOWN;
    if (ctx.hasVar(p)) return defaultUnknown;

    const parentFn = AstUtils.getContainerOfType(p, isFunctionDeclaration);
    if (!parentFn) return defaultUnknown;

    const idx = (parentFn.params ?? []).indexOf(p);
    if (idx < 0) return defaultUnknown;

    const c2 = ctx.copy();
    c2.addVar(p);

    const owningStruct = AstUtils.getContainerOfType(parentFn, isStructDeclaration);

    if (!owningStruct) {
      const calls = this.allReferencingFunctionCalls(parentFn);
      const outer = this.excludeInner(parentFn, calls);

      for (const call of outer) {
        const arg = (call.params ?? [])[idx];
        if (!arg) continue;
        const t = this.typeFor(arg, c2.copy());
        if (!t.isUnknown()) return t;
      }

      return defaultUnknown;
    } else {
      const refs = this.allReferencingMethRefs(parentFn);
      const outer = this.excludeInner(parentFn, refs);

      for (const mr of outer) {
        const arg = (mr.params ?? [])[idx];
        if (!arg) continue;
        const t = this.typeFor(arg, c2.copy());
        if (!t.isUnknown()) return t;
      }

      return defaultUnknown;
    }
  }*/

  private handleParameter(p: ParameterDecl, ctx: TypeComputationContext): Pseudo2Type {
    const defaultUnknown = p.isArray ? TYPE_ARRAY_UNKNOWN : TYPE_UNKNOWN;

    if (ctx.hasVar(p)) {
      return defaultUnknown;
    }

    return defaultUnknown;
  }

  private handleFunctionCall(fc: FunctionCall, ctx: TypeComputationContext): Pseudo2Type {
    const fd = fc.f?.ref;
    if (!fd) return TYPE_UNKNOWN;
    return this.typeForFunctionDeclaration(fd, ctx);
  }

  private handleMethSelection(ms: MethSelection, ctx: TypeComputationContext): Pseudo2Type {
    const fd = ms.methref.f?.ref;
    if (!fd) return TYPE_UNKNOWN;
    return this.typeForFunctionDeclaration(fd, ctx);
  }

  private typeForFunctionDeclaration(fd: FunctionDeclaration, ctx: TypeComputationContext): Pseudo2Type {
    if (ctx.hasFn(fd)) return TYPE_UNKNOWN;
    const c2 = ctx.copy();
    c2.addFn(fd);
    const returnTypes = this.allReturnTypes(fd, c2);
    return this.firstConcreteReturnType(returnTypes);
  }

  private allReturnTypes(fd: FunctionDeclaration, ctx: TypeComputationContext): Pseudo2Type[] {
    const returns = this.allReturnsWithValue(fd);
    return returns.map(r => this.typeFor(r.retExpr!, ctx.copy()));
  }

  private firstConcreteReturnType(types: Pseudo2Type[]): Pseudo2Type {
    for (const t of types) {
      if (!t.isUnknown() && !t.isPartiallyUnknown()) return t;
    }
    return TYPE_UNKNOWN;
  }

  private handleAttSelection(sel: AttSelection, ctx: TypeComputationContext): Pseudo2Type {
    const attDecl = sel.attref.ref?.ref;
    if (!attDecl?.type) return TYPE_UNKNOWN;

    let res = this.typeForTypeRef(attDecl.type);
    if (sel.attref.index) res = res.asBaseType();
    return res;
  }

  typeForTypeRef(tr: TypeRef): Pseudo2Type {
    if (isStructType(tr as unknown as StructType)) {
      const s = (tr as unknown as StructType).struct?.ref;
      return s ? TYPE_STRUCT(s.name) : TYPE_UNKNOWN;
    }

    if (isArrayType(tr as unknown as ArrayType)) {
      const base = (tr as unknown as ArrayType).base;
      const bt = this.typeForTypeRef(base as unknown as TypeRef);
      return Pseudo2Type.create({ name: bt.name, isStruct: bt.isStruct, isArray: true });
    }

    const k = (tr as any).$type as string;
    if (k === 'NumType') return TYPE_NUM;
    if (k === 'StringType') return TYPE_STRING;
    if (k === 'BoolType') return TYPE_BOOL;

    return TYPE_UNKNOWN;
  }

  private isLengthParameterDecl(v: VarDecl): boolean {
    const parent: any = v.$container;
    if (!parent || !isFunctionDeclaration(parent)) return false;
    return (parent.params ?? []).some((p: any) => p.len === v);
  }

/*
  private allReferencingFunctionCalls(fd: FunctionDeclaration): FunctionCall[] {
    const root = AstUtils.getDocument(fd).parseResult.value;
    const out: FunctionCall[] = [];
    for (const n of AstUtils.streamAllContents(root)) {
      if (isFunctionCall(n) && n.f?.ref === fd) out.push(n);
    }
    return out;
  }


  private allReferencingMethRefs(fd: FunctionDeclaration): MethRef[] {
    const root = AstUtils.getDocument(fd).parseResult.value;
    const out: MethRef[] = [];
    for (const n of AstUtils.streamAllContents(root)) {
      if (isMethRef(n) && n.f?.ref === fd) out.push(n);
    }
    return out;
  }

  private excludeInner<T extends AstNode>(fd: FunctionDeclaration, items: T[]): T[] {
    const inner = new Set<AstNode>();
    for (const n of AstUtils.streamAllContents(fd)) inner.add(n);
    return items.filter(i => !inner.has(i));
  }
*/



  private allReturnsWithValue(fd: FunctionDeclaration): ReturnStmt[] {
    const out: ReturnStmt[] = [];
    for (const n of AstUtils.streamAllContents(fd)) {
      if (isReturnStmt(n) && n.retExpr) out.push(n);
    }
    return out;
  }
}