/*
 * frozenDicts.ts
 *
 * Special-case logic for the builtin frozendict (Python 3.15+). When every key
 * of a frozendict is a string literal at construction, the type of each key's
 * value is recorded on the instance type. Because a frozendict can't be
 * mutated, indexing it with a literal key can then evaluate to that key's own
 * value type rather than the union of all value types, and indexing it with
 * an unknown literal key can be reported as an error.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import { ArgCategory, ExpressionNode, IndexNode, ParseNodeType } from '../parser/parseNodes';
import { Arg, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { ClassType, isClassInstance, Type, UnknownType } from './types';
import { doForEachSubtype, isTupleClass, mapSubtypes, specializeTupleClass } from './typeUtils';

export function isFrozenDictClass(classType: ClassType): boolean {
    return ClassType.isBuiltIn(classType, 'frozendict');
}

// Called with the result of a call to the frozendict constructor. If every key
// passed to it is a string literal, returns the result with its known entries
// attached.
export function applyFrozenDictEntries(evaluator: TypeEvaluator, argList: Arg[], returnType: Type): Type {
    if (!isClassInstance(returnType) || !isFrozenDictClass(returnType)) {
        return returnType;
    }

    const valueType = returnType.priv.typeArgs?.[1];
    if (!valueType) {
        return returnType;
    }

    const entries = getEntriesFromArgs(evaluator, argList, valueType);
    return entries ? ClassType.cloneForFrozenDictEntries(returnType, entries) : returnType;
}

// Supports keyword arguments, optionally preceded by a single dict display
// whose keys are string literals: frozendict(a=1), frozendict({'a': 1}, b=2).
function getEntriesFromArgs(evaluator: TypeEvaluator, argList: Arg[], valueType: Type): Map<string, Type> | undefined {
    // A keyword argument that repeats a key of the dict display replaces its
    // value but keeps its position, as at runtime. A Map does the same.
    const valueExprs = new Map<string, ExpressionNode>();

    for (let i = 0; i < argList.length; i++) {
        const arg = argList[i];
        if (arg.argCategory !== ArgCategory.Simple || !arg.valueExpression) {
            return undefined;
        }

        if (arg.name) {
            valueExprs.set(arg.name.d.value, arg.valueExpression);
            continue;
        }

        if (i !== 0 || arg.valueExpression.nodeType !== ParseNodeType.Dictionary) {
            return undefined;
        }

        for (const entry of arg.valueExpression.d.items) {
            if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                return undefined;
            }

            const keyType = evaluator.getTypeOfExpression(entry.d.keyExpr).type;
            if (
                !isClassInstance(keyType) ||
                !ClassType.isBuiltIn(keyType, 'str') ||
                typeof keyType.priv.literalValue !== 'string'
            ) {
                return undefined;
            }

            valueExprs.set(keyType.priv.literalValue, entry.d.valueExpr);
        }
    }

    if (valueExprs.size === 0) {
        return undefined;
    }

    const entries = new Map<string, Type>();
    for (const [key, valueExpr] of valueExprs) {
        const typeResult = evaluator.getTypeOfExpression(valueExpr);
        if (typeResult.isIncomplete || !evaluator.assignType(valueType, typeResult.type)) {
            return undefined;
        }

        // Widen literals the same way the value type itself was widened:
        // frozendict(age=27) is frozendict[str, int], so "age" is int too, and
        // frozendict(size=(1, 2)) is frozendict[str, tuple[int, int]].
        let entryType = typeResult.type;
        const strippedType = stripLiteralsInTuples(evaluator, entryType);
        if (strippedType !== entryType && evaluator.assignType(valueType, strippedType)) {
            entryType = strippedType;
        }

        entries.set(key, entryType);
    }

    return entries;
}

// Like stripLiteralValue, but also widens the literal elements of a tuple
// (recursively), as solving the frozendict's value type does.
function stripLiteralsInTuples(evaluator: TypeEvaluator, type: Type): Type {
    return mapSubtypes(type, (subtype) => {
        if (!isClassInstance(subtype) || !isTupleClass(subtype) || !subtype.priv.tupleTypeArgs) {
            return evaluator.stripLiteralValue(subtype);
        }

        let changed = false;
        const tupleTypeArgs = subtype.priv.tupleTypeArgs.map((arg) => {
            const strippedType = stripLiteralsInTuples(evaluator, arg.type);
            changed ||= strippedType !== arg.type;
            return { ...arg, type: strippedType };
        });

        return changed ? specializeTupleClass(subtype, tupleTypeArgs) : subtype;
    });
}

// Evaluates a read of a frozendict with known entries. Returns undefined to fall
// back to its __getitem__ when the index isn't a string literal (or a union of them).
export function getTypeOfIndexedFrozenDict(
    evaluator: TypeEvaluator,
    node: IndexNode,
    baseType: ClassType
): TypeResult | undefined {
    const entries = baseType.priv.frozenDictEntries;
    if (!entries) {
        return undefined;
    }

    if (
        node.d.items.length !== 1 ||
        node.d.trailingComma ||
        node.d.items[0].d.name ||
        node.d.items[0].d.argCategory !== ArgCategory.Simple
    ) {
        return undefined;
    }

    const indexTypeResult = evaluator.getTypeOfExpression(node.d.items[0].d.valueExpr);
    const indexType = indexTypeResult.type;

    let isLiteralKey = true;
    doForEachSubtype(indexType, (subtype) => {
        if (
            !isClassInstance(subtype) ||
            !ClassType.isBuiltIn(subtype, 'str') ||
            typeof subtype.priv.literalValue !== 'string'
        ) {
            isLiteralKey = false;
        }
    });

    if (!isLiteralKey) {
        return undefined;
    }

    const diag = new DiagnosticAddendum();
    const type = mapSubtypes(indexType, (subtype) => {
        const key = (subtype as ClassType).priv.literalValue as string;
        const entryType = entries.get(key);
        if (!entryType) {
            diag.addMessage(LocAddendum.keyUndefined().format({ name: key, type: evaluator.printType(baseType) }));
            return UnknownType.create();
        }
        return entryType;
    });

    if (!diag.isEmpty()) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.frozenDictAccess() + diag.getString(),
            node
        );
    }

    return { type, isIncomplete: !!indexTypeResult.isIncomplete };
}
