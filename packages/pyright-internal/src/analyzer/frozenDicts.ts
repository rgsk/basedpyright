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
import { ArgCategory, CallNode, DictionaryNode, ExpressionNode, IndexNode, ParseNodeType } from '../parser/parseNodes';
import { Arg, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    Type,
    UnknownType,
} from './types';
import { convertToInstance, doForEachSubtype, isTupleClass, mapSubtypes, specializeTupleClass } from './typeUtils';

// The builtin frozendict (Python 3.15+), and the frozendict class of the PyPI
// package of the same name, which provides one for older versions. Subclasses
// are not included: they may add methods or override the ones relied on here.
export function isFrozenDictClass(classType: ClassType): boolean {
    return ClassType.isBuiltIn(classType, 'frozendict') || classType.shared.fullName === 'frozendict.frozendict';
}

// Called with the result of a call to the frozendict constructor. If every key
// passed to it is a string literal, returns the result with its known entries
// attached.
export function applyFrozenDictEntries(
    evaluator: TypeEvaluator,
    argList: Arg[],
    returnType: Type,
    expectedType?: Type
): Type {
    if (!isClassInstance(returnType) || !isFrozenDictClass(returnType)) {
        return returnType;
    }

    const valueType = returnType.priv.typeArgs?.[1];
    if (!valueType) {
        return returnType;
    }

    const entries = getEntriesFromArgs(evaluator, argList, valueType, expectedType);
    return entries ? ClassType.cloneForKnownEntries(returnType, entries) : returnType;
}

// Where an entry's value comes from: an expression whose type is yet to be
// evaluated (and widened), or the known entry of another frozendict.
type EntrySource = { expr: ExpressionNode } | { type: Type };

// Supports keyword arguments, optionally preceded by a single mapping, plus
// **unpacking: frozendict(a=1), frozendict({'a': 1}, b=2), frozendict(other, b=2),
// frozendict(**other, b=2). A dict display or a mapping must have known string keys:
// literals, or the entries of another frozendict with known entries.
function getEntriesFromArgs(
    evaluator: TypeEvaluator,
    argList: Arg[],
    valueType: Type,
    expectedType: Type | undefined
): Map<string, Type> | undefined {
    // A later key replaces the value of an earlier one but keeps its position,
    // as at runtime. A Map does the same.
    const sources = new Map<string, EntrySource>();

    for (let i = 0; i < argList.length; i++) {
        const arg = argList[i];
        if (!arg.valueExpression) {
            return undefined;
        }

        if (arg.argCategory === ArgCategory.UnpackedDictionary) {
            if (!addKnownEntries(evaluator.getTypeOfExpression(arg.valueExpression).type, sources)) {
                return undefined;
            }
            continue;
        }

        if (arg.argCategory !== ArgCategory.Simple) {
            return undefined;
        }

        if (arg.name) {
            sources.set(arg.name.d.value, { expr: arg.valueExpression });
            continue;
        }

        if (i !== 0) {
            return undefined;
        }

        if (arg.valueExpression.nodeType === ParseNodeType.Dictionary) {
            if (!addDictDisplayEntries(evaluator, arg.valueExpression, sources)) {
                return undefined;
            }
        } else if (!addKnownEntries(evaluator.getTypeOfExpression(arg.valueExpression).type, sources)) {
            return undefined;
        }
    }

    return sources.size > 0 ? resolveEntries(evaluator, sources, valueType, expectedType) : undefined;
}

// Called with the result of left | right (or left |= right). When the result is a
// frozendict and both sides have known keys, the result has the entries of the
// left side updated with those of the right side, as at runtime.
export function applyFrozenDictMerge(
    evaluator: TypeEvaluator,
    leftType: Type,
    rightExpr: ExpressionNode,
    rightType: Type,
    resultType: Type
): Type {
    if (!isClassInstance(resultType) || !isFrozenDictClass(resultType)) {
        return resultType;
    }

    const valueType = resultType.priv.typeArgs?.[1];
    const sources = new Map<string, EntrySource>();
    if (!valueType || !addKnownEntries(leftType, sources)) {
        return resultType;
    }

    const hasRightEntries =
        rightExpr.nodeType === ParseNodeType.Dictionary
            ? addDictDisplayEntries(evaluator, rightExpr, sources)
            : addKnownEntries(rightType, sources);
    if (!hasRightEntries) {
        return resultType;
    }

    const entries = resolveEntries(evaluator, sources, valueType);
    return entries ? ClassType.cloneForKnownEntries(resultType, entries) : resultType;
}

// Adds the entries of a frozendict with known entries. Returns false for any other type.
function addKnownEntries(type: Type, sources: Map<string, EntrySource>): boolean {
    if (!isClassInstance(type) || !type.priv.knownEntries) {
        return false;
    }

    type.priv.knownEntries.forEach((entryType, key) => sources.set(key, { type: entryType }));
    return true;
}

// Adds the entries of a dict display such as {'a': 1, **other}. Returns false if
// a key isn't a string literal or an unpacked mapping has no known entries.
function addDictDisplayEntries(
    evaluator: TypeEvaluator,
    node: DictionaryNode,
    sources: Map<string, EntrySource>
): boolean {
    for (const entry of node.d.items) {
        if (entry.nodeType === ParseNodeType.DictionaryExpandEntry) {
            if (!addKnownEntries(evaluator.getTypeOfExpression(entry.d.expr).type, sources)) {
                return false;
            }
            continue;
        }

        if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
            return false;
        }

        const keyType = evaluator.getTypeOfExpression(entry.d.keyExpr).type;
        if (
            !isClassInstance(keyType) ||
            !ClassType.isBuiltIn(keyType, 'str') ||
            typeof keyType.priv.literalValue !== 'string'
        ) {
            return false;
        }

        sources.set(keyType.priv.literalValue, { expr: entry.d.valueExpr });
    }

    return true;
}

// Evaluates the entries' value types. Returns undefined if one isn't known yet
// or doesn't fit the frozendict's value type. A literal is widened unless the
// expected type (frozendicts with known entries) needs it for that key, as in
// shape: Circle | Square = frozendict(kind='circle', ...).
function resolveEntries(
    evaluator: TypeEvaluator,
    sources: Map<string, EntrySource>,
    valueType: Type,
    expectedType?: Type
): Map<string, Type> | undefined {
    const entries = new Map<string, Type>();
    for (const [key, source] of sources) {
        if ('type' in source) {
            if (!evaluator.assignType(valueType, source.type)) {
                return undefined;
            }
            entries.set(key, source.type);
            continue;
        }

        const typeResult = evaluator.getTypeOfExpression(source.expr);
        if (typeResult.isIncomplete || !evaluator.assignType(valueType, typeResult.type)) {
            return undefined;
        }

        // Widen literals the same way the value type itself was widened:
        // frozendict(age=27) is frozendict[str, int], so "age" is int too, and
        // frozendict(size=(1, 2)) is frozendict[str, tuple[int, int]].
        let entryType = typeResult.type;
        const strippedType = stripLiteralsInTuples(evaluator, entryType);
        if (
            strippedType !== entryType &&
            evaluator.assignType(valueType, strippedType) &&
            !isLiteralNeeded(evaluator, expectedType, key, entryType, strippedType)
        ) {
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
    const entries = baseType.priv.knownEntries;
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

// Reads the known entries spelled as the type argument of frozendict[{'key': T, ...}].
// Each key must be a string literal; each value is a type expression.
export function getFrozenDictEntriesFromTypeArg(evaluator: TypeEvaluator, node: DictionaryNode): Map<string, Type> {
    const entries = new Map<string, Type>();

    node.d.items.forEach((entry) => {
        if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typedDictSecondArgDictEntry(),
                entry
            );
            return;
        }

        const valueType = convertToInstance(evaluator.getTypeOfExpressionExpectingType(entry.d.valueExpr).type);

        if (entry.d.keyExpr.nodeType !== ParseNodeType.StringList) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typedDictEntryName(),
                entry.d.keyExpr
            );
            return;
        }

        const key = entry.d.keyExpr.d.strings.map((s) => s.d.value).join('');
        if (entries.has(key)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typedDictEntryUnique(),
                entry.d.keyExpr
            );
            return;
        }

        entries.set(key, valueType);
    });

    // The dict and its keys aren't type expressions: don't evaluate them as such later.
    evaluator.setTypeResultForNode(node, { type: UnknownType.create() });
    node.d.items.forEach((entry) => {
        if (entry.nodeType === ParseNodeType.DictionaryKeyEntry) {
            evaluator.setTypeResultForNode(entry.d.keyExpr, { type: UnknownType.create() });
        }
    });

    return entries;
}

// Called with the result of x.get(...) or x.copy() when x is a frozendict with
// known entries (or a union of them), whose keys are always present:
// - x.copy() is x itself at runtime, so it has the same entries;
// - x.get('key') is the key's value type, as the default is never used;
// - x.get('missing') is the default (None without one), with no error, since
//   it doesn't fail at runtime.
// Other calls, such as x.get(key) with a key that isn't a literal, keep their type;
// other methods returning a frozendict lose the entries.
export function applyFrozenDictMethodCall(evaluator: TypeEvaluator, node: CallNode, returnType: Type): Type {
    const memberAccess = node.d.leftExpr;
    if (memberAccess.nodeType !== ParseNodeType.MemberAccess) {
        return returnType;
    }

    const methodName = memberAccess.d.member.d.value;
    const receiverType = evaluator.getTypeOfExpression(memberAccess.d.leftExpr).type;
    if (methodName === 'fromkeys') {
        return applyFrozenDictFromKeys(evaluator, node, receiverType, returnType);
    }

    if (methodName !== 'get' && methodName !== 'copy') {
        // Other methods that return a frozendict, such as delete() of the PyPI
        // package (declared to return Self), would otherwise carry the receiver's
        // entries into a result that may have other keys.
        let isKnownFrozenDict = false;
        doForEachSubtype(receiverType, (subtype) => {
            if (isClassInstance(subtype) && isFrozenDictClass(subtype) && subtype.priv.knownEntries) {
                isKnownFrozenDict = true;
            }
        });
        return isKnownFrozenDict ? removeKnownEntries(returnType) : returnType;
    }

    let allHaveEntries = true;
    doForEachSubtype(receiverType, (subtype) => {
        if (!isClassInstance(subtype) || !isFrozenDictClass(subtype) || !subtype.priv.knownEntries) {
            allHaveEntries = false;
        }
    });
    if (!allHaveEntries) {
        return returnType;
    }

    const args = node.d.args;
    if (args.some((arg) => arg.d.name || arg.d.argCategory !== ArgCategory.Simple)) {
        return returnType;
    }

    if (methodName === 'copy') {
        return args.length === 0 ? receiverType : returnType;
    }

    if (args.length !== 1 && args.length !== 2) {
        return returnType;
    }

    const keys: string[] = [];
    let isLiteralKey = true;
    doForEachSubtype(evaluator.getTypeOfExpression(args[0].d.valueExpr).type, (subtype) => {
        if (
            isClassInstance(subtype) &&
            ClassType.isBuiltIn(subtype, 'str') &&
            typeof subtype.priv.literalValue === 'string'
        ) {
            keys.push(subtype.priv.literalValue);
        } else {
            isLiteralKey = false;
        }
    });
    if (!isLiteralKey || keys.length === 0) {
        return returnType;
    }

    const defaultType =
        args.length === 2
            ? evaluator.stripLiteralValue(evaluator.getTypeOfExpression(args[1].d.valueExpr).type)
            : evaluator.getNoneType();

    const resultTypes: Type[] = [];
    doForEachSubtype(receiverType, (subtype) => {
        const entries = (subtype as ClassType).priv.knownEntries!;
        keys.forEach((key) => resultTypes.push(entries.get(key) ?? defaultType));
    });
    return combineTypes(resultTypes);
}

// The value type of the given literal key(s) of a frozendict with known entries,
// e.g. for the value of the mapping pattern {'age': v}. A key it doesn't have
// can't match, so it contributes nothing. Returns undefined when the type has no
// known entries or a key isn't a string literal.
export function getFrozenDictEntryTypeForKeys(type: Type, keyType: Type): Type | undefined {
    const entries = isClassInstance(type) ? type.priv.knownEntries : undefined;
    if (!entries) {
        return undefined;
    }

    const entryTypes: Type[] = [];
    let isLiteralKey = true;
    doForEachSubtype(keyType, (keySubtype) => {
        if (
            isClassInstance(keySubtype) &&
            ClassType.isBuiltIn(keySubtype, 'str') &&
            typeof keySubtype.priv.literalValue === 'string'
        ) {
            const entryType = entries.get(keySubtype.priv.literalValue);
            if (entryType) {
                entryTypes.push(entryType);
            }
        } else {
            isLiteralKey = false;
        }
    });

    return isLiteralKey ? combineTypes(entryTypes) : undefined;
}

// Whether the expected type has a frozendict with known entries whose entry for
// the key accepts the literal type but not its widened type.
function isLiteralNeeded(
    evaluator: TypeEvaluator,
    expectedType: Type | undefined,
    key: string,
    literalType: Type,
    strippedType: Type
): boolean {
    if (!expectedType) {
        return false;
    }

    let isNeeded = false;
    doForEachSubtype(expectedType, (subtype) => {
        const expectedEntryType = isClassInstance(subtype) ? subtype.priv.knownEntries?.get(key) : undefined;
        if (
            expectedEntryType &&
            evaluator.assignType(expectedEntryType, literalType) &&
            !evaluator.assignType(expectedEntryType, strippedType)
        ) {
            isNeeded = true;
        }
    });
    return isNeeded;
}

// frozendict.fromkeys(['a', 'b'], value): each key gets the value's type (None
// without a value). The keys must be string literals in a list or tuple display,
// so that their order is known. The type arguments are left as they are.
function applyFrozenDictFromKeys(evaluator: TypeEvaluator, node: CallNode, classType: Type, returnType: Type): Type {
    if (!isInstantiableClass(classType) || !isFrozenDictClass(classType)) {
        return returnType;
    }
    if (!isClassInstance(returnType) || !isFrozenDictClass(returnType)) {
        return returnType;
    }

    const args = node.d.args;
    if (
        args.length < 1 ||
        args.length > 2 ||
        args.some((arg) => arg.d.name || arg.d.argCategory !== ArgCategory.Simple)
    ) {
        return returnType;
    }

    const keysExpr = args[0].d.valueExpr;
    if (keysExpr.nodeType !== ParseNodeType.List && keysExpr.nodeType !== ParseNodeType.Tuple) {
        return returnType;
    }

    let valueType = args.length === 2 ? returnType.priv.typeArgs?.[1] : evaluator.getNoneType();
    if (args.length === 2 && (!valueType || isAnyOrUnknown(valueType))) {
        // The frozendict package's stub leaves the value type unsolved: every key
        // gets the given value, so use its type.
        valueType = evaluator.stripLiteralValue(evaluator.getTypeOfExpression(args[1].d.valueExpr).type);
    }
    if (!valueType) {
        return returnType;
    }

    const entries = new Map<string, Type>();
    for (const keyExpr of keysExpr.d.items) {
        const keyType = evaluator.getTypeOfExpression(keyExpr).type;
        if (
            !isClassInstance(keyType) ||
            !ClassType.isBuiltIn(keyType, 'str') ||
            typeof keyType.priv.literalValue !== 'string'
        ) {
            return returnType;
        }
        entries.set(keyType.priv.literalValue, valueType);
    }

    return entries.size > 0 ? ClassType.cloneForKnownEntries(returnType, entries) : returnType;
}

function removeKnownEntries(type: Type): Type {
    return mapSubtypes(type, (subtype) =>
        isClassInstance(subtype) && subtype.priv.knownEntries
            ? ClassType.cloneForKnownEntries(subtype, undefined)
            : subtype
    );
}
