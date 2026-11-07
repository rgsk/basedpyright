/*
 * frozenDicts.ts
 *
 * Special-case logic for the builtin frozendict (Python 3.15+) and dict. When
 * every key of a frozendict or dict is a string literal at construction, the
 * type of each key's value is recorded on the instance type (its known
 * entries), so indexing it with a literal key can evaluate to that key's own
 * value type rather than the union of all value types.
 *
 * A frozendict can't be mutated, so its known entries are exact: indexing it
 * with an unknown literal key is reported as an error. A dict's known entries
 * are only what the checker has seen of it (code flow analysis updates them on
 * writes it can follow), so they never cause errors by themselves. x.update(...)
 * is applied as x |= ... is, so for a variable without a declared type, values of
 * a new type widen its value type instead of being an error.
 *
 * PyTorch's nn.ModuleDict built from such a dict (ModuleDict({'body': ...}) or
 * ModuleDict(dict(body=...))) has a dict's kind of known entries, with two
 * differences: any write the checker sees other than update() with known keys
 * removes them all (a plain ModuleDict again), and while they're there, reading a
 * literal key they don't have is an error. Its self-returning methods (to(), cuda(), train(), ...) are declared to
 * return Self, which keeps them.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import {
    ArgCategory,
    CallNode,
    DictionaryNode,
    ExpressionNode,
    IndexNode,
    MemberAccessNode,
    NameNode,
    ParseNodeType,
    StringListNode,
} from '../parser/parseNodes';
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

// Classes whose instances can have known entries: frozendict, the builtin dict and
// PyTorch's nn.ModuleDict (not their subclasses, for the same reason).
export function isKnownEntriesClass(classType: ClassType): boolean {
    return (
        isFrozenDictClass(classType) || ClassType.isBuiltIn(classType, 'dict') || ClassType.isTorchModuleDict(classType)
    );
}

// The value type of a frozendict or dict (its second type argument), or Module for a
// ModuleDict, which isn't generic.
function getValueType(classType: ClassType): Type | undefined {
    if (!ClassType.isTorchModuleDict(classType)) {
        return classType.priv.typeArgs?.[1];
    }
    const moduleClass = classType.shared.mro.find(
        (mroClass) => isInstantiableClass(mroClass) && mroClass.shared.fullName === 'torch.nn.modules.module.Module'
    );
    return moduleClass ? convertToInstance(moduleClass) : undefined;
}

// Called with the result of a call to the frozendict or dict constructor. If every
// key passed to it is a string literal, returns the result with its known entries
// attached.
export function applyFrozenDictEntries(
    evaluator: TypeEvaluator,
    argList: Arg[],
    returnType: Type,
    expectedType?: Type
): Type {
    if (!isClassInstance(returnType) || !isKnownEntriesClass(returnType)) {
        return returnType;
    }

    const valueType = getValueType(returnType);
    if (!valueType) {
        return returnType;
    }

    // A ModuleDict takes a single mapping of modules.
    if (ClassType.isTorchModuleDict(returnType) && (argList.length !== 1 || argList[0].name)) {
        return returnType;
    }

    // A frozendict's entries are exact, so they can't come from a dict's.
    const allowInexact = !isFrozenDictClass(returnType);
    const result = getEntriesFromArgs(evaluator, argList, valueType, allowInexact, expectedType);
    return result ? ClassType.cloneForKnownEntries(returnType, result.entries, result.origins) : returnType;
}

// Where a key was added (see ClassType's knownEntryOrigins).
type KeyOrigin = NameNode | StringListNode;

// Where an entry's value comes from: an expression whose type is yet to be
// evaluated (and widened), or the known entry of another frozendict. And where
// its key was added, if known.
type EntrySource = ({ expr: ExpressionNode } | { type: Type }) & { origin?: KeyOrigin | undefined };

// Sets a key's source. A key given again keeps the origin it was first added at.
function setSource(sources: Map<string, EntrySource>, key: string, source: EntrySource) {
    const origin = sources.get(key)?.origin ?? source.origin;
    sources.set(key, { ...source, origin });
}

function getOrigins(sources: Map<string, EntrySource>): Map<string, KeyOrigin> {
    const origins = new Map<string, KeyOrigin>();
    sources.forEach((source, key) => {
        if (source.origin) {
            origins.set(key, source.origin);
        }
    });
    return origins;
}

function getKeyOrigin(node: ExpressionNode): KeyOrigin | undefined {
    return node.nodeType === ParseNodeType.StringList ? node : undefined;
}

// Supports keyword arguments, optionally preceded by a single mapping, plus
// **unpacking: frozendict(a=1), frozendict({'a': 1}, b=2), frozendict(other, b=2),
// frozendict(**other, b=2). A dict display or a mapping must have known string keys:
// literals, or the entries of another frozendict with known entries.
function getEntriesFromArgs(
    evaluator: TypeEvaluator,
    argList: Arg[],
    valueType: Type,
    allowInexact: boolean,
    expectedType: Type | undefined
): { entries: Map<string, Type>; origins: Map<string, KeyOrigin> } | undefined {
    // A later key replaces the value of an earlier one but keeps its position,
    // as at runtime. A Map does the same.
    const sources = new Map<string, EntrySource>();
    if (!addEntriesFromArgs(evaluator, argList, sources, allowInexact)) {
        return undefined;
    }

    const entries =
        sources.size > 0 ? resolveEntries(evaluator, sources, valueType, allowInexact, expectedType) : undefined;
    return entries ? { entries, origins: getOrigins(sources) } : undefined;
}

// Adds the entries given by the arguments of a call to the frozendict or dict
// constructor or dict.update(). Returns false if they can't all be known.
function addEntriesFromArgs(
    evaluator: TypeEvaluator,
    argList: Arg[],
    sources: Map<string, EntrySource>,
    allowInexact: boolean
): boolean {
    for (let i = 0; i < argList.length; i++) {
        const arg = argList[i];
        if (!arg.valueExpression) {
            return false;
        }

        if (arg.argCategory === ArgCategory.UnpackedDictionary) {
            if (!addKnownEntries(evaluator.getTypeOfExpression(arg.valueExpression).type, sources, allowInexact)) {
                return false;
            }
            continue;
        }

        if (arg.argCategory !== ArgCategory.Simple) {
            return false;
        }

        if (arg.name) {
            setSource(sources, arg.name.d.value, { expr: arg.valueExpression, origin: arg.name });
            continue;
        }

        if (i !== 0) {
            return false;
        }

        if (arg.valueExpression.nodeType === ParseNodeType.Dictionary) {
            if (!addDictDisplayEntries(evaluator, arg.valueExpression, sources, allowInexact)) {
                return false;
            }
        } else if (!addKnownEntries(evaluator.getTypeOfExpression(arg.valueExpression).type, sources, allowInexact)) {
            return false;
        }
    }

    return true;
}

// Called with the result of left | right (or left |= right). When the result is a
// frozendict or dict and both sides have known keys, the result has the entries of
// the left side updated with those of the right side, as at runtime.
export function applyFrozenDictMerge(
    evaluator: TypeEvaluator,
    leftType: Type,
    rightExpr: ExpressionNode,
    rightType: Type,
    resultType: Type
): Type {
    if (!isClassInstance(resultType) || !isKnownEntriesClass(resultType)) {
        return resultType;
    }

    const valueType = resultType.priv.typeArgs?.[1];
    const allowInexact = !isFrozenDictClass(resultType);
    const sources = new Map<string, EntrySource>();
    if (!valueType || !addKnownEntries(leftType, sources, allowInexact)) {
        return resultType;
    }

    const hasRightEntries =
        rightExpr.nodeType === ParseNodeType.Dictionary
            ? addDictDisplayEntries(evaluator, rightExpr, sources, allowInexact)
            : addKnownEntries(rightType, sources, allowInexact);
    if (!hasRightEntries) {
        return resultType;
    }

    const entries = resolveEntries(evaluator, sources, valueType, allowInexact);
    return entries ? ClassType.cloneForKnownEntries(resultType, entries, getOrigins(sources)) : resultType;
}

// Adds the entries of a frozendict with known entries, or with allowInexact, of a dict
// with known entries. Returns false for any other type.
function addKnownEntries(type: Type, sources: Map<string, EntrySource>, allowInexact: boolean): boolean {
    if (!isClassInstance(type) || !type.priv.knownEntries || (!allowInexact && !ClassType.hasExactKnownEntries(type))) {
        return false;
    }

    const origins = type.priv.knownEntryOrigins;
    type.priv.knownEntries.forEach((entryType, key) =>
        setSource(sources, key, { type: entryType, origin: origins?.get(key) })
    );
    return true;
}

// Called with the type of a dict display. If every key is a string literal (or comes
// from a ** unpacked dict or frozendict with known entries), returns the type with
// its known entries attached. An empty display {} has known entries too, none yet,
// so a dict that starts empty and is filled key by key (d = {}; d['a'] = 1) has a
// shape like any other.
export function applyDictDisplayEntries(
    evaluator: TypeEvaluator,
    node: DictionaryNode,
    type: Type,
    expectedType?: Type
): Type {
    if (!isClassInstance(type) || !ClassType.isBuiltIn(type, 'dict') || type.priv.knownEntries) {
        return type;
    }

    if (node.d.items.length === 0) {
        return ClassType.cloneForKnownEntries(type, new Map());
    }

    const valueType = type.priv.typeArgs?.[1];
    const sources = new Map<string, EntrySource>();
    if (!valueType || !addDictDisplayEntries(evaluator, node, sources, /* allowInexact */ true)) {
        return type;
    }

    const entries = resolveEntries(evaluator, sources, valueType, /* allowInexact */ true, expectedType);
    return entries ? ClassType.cloneForKnownEntries(type, entries, getOrigins(sources)) : type;
}

// Adds the entries of a dict display such as {'a': 1, **other}. Returns false if
// a key isn't a string literal or an unpacked mapping has no known entries.
function addDictDisplayEntries(
    evaluator: TypeEvaluator,
    node: DictionaryNode,
    sources: Map<string, EntrySource>,
    allowInexact: boolean
): boolean {
    for (const entry of node.d.items) {
        if (entry.nodeType === ParseNodeType.DictionaryExpandEntry) {
            if (!addKnownEntries(evaluator.getTypeOfExpression(entry.d.expr).type, sources, allowInexact)) {
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

        setSource(sources, keyType.priv.literalValue, {
            expr: entry.d.valueExpr,
            origin: getKeyOrigin(entry.d.keyExpr),
        });
    }

    return true;
}

// Evaluates the entries' value types. Returns undefined if one isn't known yet
// or doesn't fit the frozendict's value type. A literal is widened where its widened
// type still fits the value type, as frozendict(age=27) is frozendict[str, int]. For
// a dict (allowInexact)
// without an expected type, it's widened even where its value type kept the literal,
// as dict(size=(1, 2)) does: its entries only describe reads. With an expected type
// (d: dict[str, Literal[3]] = {...}), the value type is what was asked for.
function resolveEntries(
    evaluator: TypeEvaluator,
    sources: Map<string, EntrySource>,
    valueType: Type,
    allowInexact: boolean,
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
            ((allowInexact && !expectedType) || evaluator.assignType(valueType, strippedType))
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

// Evaluates a read of a frozendict or dict with known entries. Returns undefined to
// fall back to its __getitem__ when the index isn't a string literal (or a union of
// them), or for a dict, when a key isn't one of its known entries: code the checker
// can't follow may have added it.
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

    const isModuleDict = ClassType.isTorchModuleDict(baseType);
    if (!ClassType.hasExactKnownEntries(baseType) && !isModuleDict) {
        let isEveryKeyKnown = true;
        doForEachSubtype(indexType, (subtype) => {
            if (!entries.has((subtype as ClassType).priv.literalValue as string)) {
                isEveryKeyKnown = false;
            }
        });
        if (!isEveryKeyKnown) {
            return undefined;
        }
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
            (isModuleDict ? LocMessage.moduleDictAccess() : LocMessage.frozenDictAccess()) + diag.getString(),
            node
        );
    }

    return { type, isIncomplete: !!indexTypeResult.isIncomplete };
}

// Called with the result of x.get(...) or x.copy() when x is a frozendict or dict
// with known entries (or a union of them). The keys of a frozendict are always
// present (for a dict, those the checker has seen):
// - x.copy() is x itself at runtime, so it has the same entries;
// - x.get('key') is the key's value type, as the default is never used;
// - x.get('missing') is the default (None without one), with no error, since
//   it doesn't fail at runtime.
// - for a dict, x.get('missing') keeps its type: code the checker can't follow may
//   have added the key.
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
        if (!isClassInstance(subtype) || !isKnownEntriesClass(subtype) || !subtype.priv.knownEntries) {
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
    let isEveryKeyKnown = true;
    doForEachSubtype(receiverType, (subtype) => {
        const entries = (subtype as ClassType).priv.knownEntries!;
        keys.forEach((key) => {
            const entryType = entries.get(key);
            if (!entryType && !ClassType.hasExactKnownEntries(subtype as ClassType)) {
                isEveryKeyKnown = false;
            }
            resultTypes.push(entryType ?? defaultType);
        });
    });
    return isEveryKeyKnown ? combineTypes(resultTypes) : returnType;
}

// The value type of the given literal key(s) of a frozendict or dict with known
// entries, e.g. for the value of the mapping pattern {'age': v}. A key a frozendict
// doesn't have can't match, so it contributes nothing. Returns undefined when the
// type has no known entries, a key isn't a string literal, or a dict doesn't have
// the key among its known entries.
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
            } else if (!ClassType.hasExactKnownEntries(type as ClassType)) {
                isLiteralKey = false;
            }
        } else {
            isLiteralKey = false;
        }
    });

    return isLiteralKey ? combineTypes(entryTypes) : undefined;
}

// frozendict.fromkeys(['a', 'b'], value) (or dict.fromkeys): each key gets the value's type (None
// without a value). The keys must be string literals in a list or tuple display,
// so that their order is known. The type arguments are left as they are.
function applyFrozenDictFromKeys(evaluator: TypeEvaluator, node: CallNode, classType: Type, returnType: Type): Type {
    if (!isInstantiableClass(classType) || !isKnownEntriesClass(classType)) {
        return returnType;
    }
    if (!isClassInstance(returnType) || !isKnownEntriesClass(returnType)) {
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
    const origins = new Map<string, KeyOrigin>();
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
        const origin = getKeyOrigin(keyExpr);
        if (origin && !origins.has(keyType.priv.literalValue)) {
            origins.set(keyType.priv.literalValue, origin);
        }
    }

    return entries.size > 0 ? ClassType.cloneForKnownEntries(returnType, entries, origins) : returnType;
}

function removeKnownEntries(type: Type): Type {
    return mapSubtypes(type, (subtype) =>
        isClassInstance(subtype) && subtype.priv.knownEntries
            ? ClassType.cloneForKnownEntries(subtype, undefined)
            : subtype
    );
}

// Whether the type is a dict with known entries: what the checker has seen of it.
function isDictWithKnownEntries(type: Type): type is ClassType {
    return isClassInstance(type) && !!type.priv.knownEntries && !ClassType.hasExactKnownEntries(type);
}

// The value type argument of the first dict with known entries in the type.
export function getDictValueTypeArg(type: Type): Type | undefined {
    let valueType: Type | undefined;
    doForEachSubtype(type, (subtype) => {
        if (!valueType && isDictWithKnownEntries(subtype)) {
            valueType = subtype.priv.typeArgs?.[1];
        }
    });
    return valueType;
}

// The type without the known entries of the dicts it includes, at its top level.
export function removeDictKnownEntries(type: Type): Type {
    if (!hasDictWithKnownEntries(type)) {
        return type;
    }
    return mapSubtypes(type, (subtype) =>
        isDictWithKnownEntries(subtype) ? ClassType.cloneForKnownEntries(subtype, undefined) : subtype
    );
}

// Whether the type is (or is a union that includes) a dict with known entries.
export function hasDictWithKnownEntries(type: Type): boolean {
    let found = false;
    doForEachSubtype(type, (subtype) => {
        if (isDictWithKnownEntries(subtype)) {
            found = true;
        }
    });
    return found;
}

// The origins of a dict's entries after its key is set: unchanged if the key was
// already known (it keeps where it was first added), else with the key's origin.
// Undefined to keep the dict's origins as they are.
function addOrigin(type: ClassType, key: string, origin: KeyOrigin | undefined): Map<string, KeyOrigin> | undefined {
    if (!origin || type.priv.knownEntries?.has(key)) {
        return undefined;
    }
    const origins = new Map(type.priv.knownEntryOrigins);
    origins.set(key, origin);
    return origins;
}

// The string value of a literal key, or undefined for any other key (including
// a union of literals: any one of them may be the key).
function getLiteralKey(evaluator: TypeEvaluator, keyExpr: ExpressionNode): string | undefined {
    const keyType = evaluator.getTypeOfExpression(keyExpr).type;
    return isClassInstance(keyType) &&
        ClassType.isBuiltIn(keyType, 'str') &&
        typeof keyType.priv.literalValue === 'string'
        ? keyType.priv.literalValue
        : undefined;
}

// The key of the index expression x[key], if it's a string literal.
export function getLiteralKeyOfIndex(evaluator: TypeEvaluator, node: IndexNode): string | undefined {
    if (
        node.d.items.length !== 1 ||
        node.d.trailingComma ||
        node.d.items[0].d.name ||
        node.d.items[0].d.argCategory !== ArgCategory.Simple
    ) {
        return undefined;
    }

    return getLiteralKey(evaluator, node.d.items[0].d.valueExpr);
}

// Code flow analysis: the type of a dict after x[key] = value (with the type of the
// assigned value) or del x[key] (without one). key is undefined when it isn't a
// string literal: the write may have changed any entry, so they're all forgotten.
// With isUnknownValue, a value of unknown type was assigned: the key's entry is
// removed, so reads of it fall back to the dict's value type. Only dicts with known
// entries change.
export function applyDictIndexWrite(
    evaluator: TypeEvaluator,
    type: Type,
    key: string | undefined,
    assignedType: Type | undefined,
    isUnknownValue = false,
    keyNode?: ExpressionNode
): Type {
    return mapSubtypes(type, (subtype) => {
        if (!isDictWithKnownEntries(subtype)) {
            return subtype;
        }

        if (key === undefined || ClassType.isTorchModuleDict(subtype)) {
            return ClassType.cloneForKnownEntries(subtype, undefined);
        }

        // As at runtime, replacing a value keeps the key's position; deleting and
        // adding it again moves it to the end.
        const entries = new Map(subtype.priv.knownEntries);
        if (assignedType && !isUnknownValue) {
            entries.set(key, stripLiteralsInTuples(evaluator, assignedType));
            // A write that adds the key is where it was added.
            const origin = keyNode ? getKeyOrigin(keyNode) : undefined;
            return ClassType.cloneForKnownEntries(subtype, entries, addOrigin(subtype, key, origin));
        }

        entries.delete(key);
        return ClassType.cloneForKnownEntries(subtype, entries);
    });
}

// Code flow analysis: the type of a dict after a call to one of its methods named
// in dictMutatorMethodNames, such as x.update(key=value). Entries the call may have
// changed in a way that isn't known are forgotten. Only dicts with known entries
// change.
export function applyDictMutatorCall(evaluator: TypeEvaluator, type: Type, node: CallNode): Type {
    if (node.d.leftExpr.nodeType !== ParseNodeType.MemberAccess) {
        return type;
    }

    const methodName = node.d.leftExpr.d.member.d.value;
    const args = node.d.args;
    const positionalArgs = args.filter((arg) => !arg.d.name && arg.d.argCategory === ArgCategory.Simple);
    const isSimpleCall = positionalArgs.length === args.length;

    return mapSubtypes(type, (subtype) => {
        if (!isDictWithKnownEntries(subtype)) {
            return subtype;
        }

        // Any other change to a ModuleDict's keys makes it a plain ModuleDict.
        if (ClassType.isTorchModuleDict(subtype)) {
            if (methodName === 'update') {
                return applyDictUpdate(evaluator, subtype, node) ?? ClassType.cloneForKnownEntries(subtype, undefined);
            }
            return ClassType.cloneForKnownEntries(subtype, undefined);
        }

        const entries = subtype.priv.knownEntries!;
        const withEntries = (newEntries: Map<string, Type> | undefined, origins?: Map<string, KeyOrigin>) =>
            ClassType.cloneForKnownEntries(subtype, newEntries, origins);

        switch (methodName) {
            case 'clear': {
                return args.length === 0 ? withEntries(new Map()) : subtype;
            }

            case 'popitem': {
                // It removes the last key, which may be one the checker hasn't seen.
                return withEntries(undefined);
            }

            case 'pop': {
                if (!isSimpleCall || args.length < 1 || args.length > 2) {
                    return subtype;
                }

                const key = getLiteralKey(evaluator, args[0].d.valueExpr);
                if (key === undefined) {
                    return withEntries(undefined);
                }

                const newEntries = new Map(entries);
                newEntries.delete(key);
                return withEntries(newEntries);
            }

            case 'setdefault': {
                // It adds the key only if it's missing, so known entries never change.
                if (!isSimpleCall || args.length < 1 || args.length > 2) {
                    return subtype;
                }

                const key = getLiteralKey(evaluator, args[0].d.valueExpr);
                if (key === undefined || entries.has(key)) {
                    return subtype;
                }

                const newEntries = new Map(entries);
                newEntries.set(
                    key,
                    args.length === 2
                        ? stripLiteralsInTuples(evaluator, evaluator.getTypeOfExpression(args[1].d.valueExpr).type)
                        : evaluator.getNoneType()
                );
                return withEntries(newEntries, addOrigin(subtype, key, getKeyOrigin(args[0].d.valueExpr)));
            }

            case 'update': {
                return applyDictUpdate(evaluator, subtype, node) ?? withEntries(undefined);
            }
        }

        return subtype;
    });
}

// x.update(arg) or x.update(k=v, ...) on a dict (or ModuleDict) with known entries,
// applied as x |= arg would be: the arg's keys are added, replacing the types of
// keys already known. Undefined if the arg's keys aren't known. The new values must
// be assignable to the value type, unless the call may widen it (see
// canWidenDictUpdate): then it's widened to include them, as by x | arg.
function applyDictUpdate(evaluator: TypeEvaluator, subtype: ClassType, node: CallNode): ClassType | undefined {
    const isModuleDict = ClassType.isTorchModuleDict(subtype);
    const args = node.d.args;

    // ModuleDict.update takes a single mapping of modules.
    if (isModuleDict && (args.length !== 1 || args[0].d.name || args[0].d.argCategory !== ArgCategory.Simple)) {
        return undefined;
    }

    const valueType = getValueType(subtype);
    if (!valueType) {
        return undefined;
    }

    const argList: Arg[] = args.map((arg) => ({
        argCategory: arg.d.argCategory,
        name: arg.d.name,
        valueExpression: arg.d.valueExpr,
    }));
    const argSources = new Map<string, EntrySource>();
    if (!addEntriesFromArgs(evaluator, argList, argSources, /* allowInexact */ true)) {
        return undefined;
    }

    const sources = new Map<string, EntrySource>();
    subtype.priv.knownEntries!.forEach((entryType, key) =>
        setSource(sources, key, { type: entryType, origin: subtype.priv.knownEntryOrigins?.get(key) })
    );
    argSources.forEach((source, key) => setSource(sources, key, source));

    const entries = resolveEntries(evaluator, sources, valueType, /* allowInexact */ true);
    if (entries) {
        return ClassType.cloneForKnownEntries(subtype, entries, getOrigins(sources));
    }

    const keyType = subtype.priv.typeArgs?.[0];
    if (isModuleDict || !keyType || !canWidenDictUpdate(evaluator, node)) {
        return undefined;
    }

    const newValueTypes = [...argSources.values()].map((source) =>
        'type' in source ? source.type : stripLiteralsInTuples(evaluator, evaluator.getTypeOfExpression(source.expr).type)
    );
    const widenedValueType = combineTypes([valueType, ...newValueTypes]);
    const widenedEntries = resolveEntries(evaluator, sources, widenedValueType, /* allowInexact */ true);
    if (!widenedEntries) {
        return undefined;
    }
    return ClassType.cloneForKnownEntries(
        ClassType.specialize(subtype, [keyType, widenedValueType]),
        widenedEntries,
        getOrigins(sources)
    );
}

// Whether x.update(...) may widen the value type of the dict x, as x |= ... may: x
// is a variable without a declared type, so its inferred type takes any dict.
function canWidenDictUpdate(evaluator: TypeEvaluator, node: CallNode): boolean {
    if (node.d.leftExpr.nodeType !== ParseNodeType.MemberAccess || node.d.leftExpr.d.member.d.value !== 'update') {
        return false;
    }
    const receiver = node.d.leftExpr.d.leftExpr;
    return receiver.nodeType === ParseNodeType.Name && !evaluator.getDeclaredTypeForExpression(receiver);
}

// For a call x.update(...) that stock pyright reports as an error because the new
// values don't fit the dict's value type: whether code flow analysis instead merges
// them into x, widening its value type (as x |= ... does), so the call isn't an error.
export function isWideningDictUpdate(evaluator: TypeEvaluator, node: CallNode): boolean {
    if (!canWidenDictUpdate(evaluator, node)) {
        return false;
    }
    const receiverType = evaluator.getTypeOfExpression((node.d.leftExpr as MemberAccessNode).d.leftExpr).type;
    return (
        isDictWithKnownEntries(receiverType) &&
        ClassType.isBuiltIn(receiverType, 'dict') &&
        !!applyDictUpdate(evaluator, receiverType, node)
    );
}

// Code flow analysis: whether a call to one of the methods named in
// dictMutatorMethodNames may change or remove the value of the given key, so that
// a type narrowed for x['key'] before it no longer applies.
export function isDictKeyChangedByMutatorCall(node: CallNode, key: string): boolean {
    if (node.d.leftExpr.nodeType !== ParseNodeType.MemberAccess) {
        return false;
    }

    const args = node.d.args;
    switch (node.d.leftExpr.d.member.d.value) {
        case 'clear':
        case 'popitem':
            return true;

        case 'pop': {
            const keyExpr = args[0]?.d.valueExpr;
            return !keyExpr || keyExpr.nodeType !== ParseNodeType.StringList || getStringListValue(keyExpr) === key;
        }

        case 'update':
            return args.some((arg) => {
                if (arg.d.name) {
                    return arg.d.name.d.value === key;
                }

                // A dict display can only change the keys it spells out.
                const valueExpr = arg.d.valueExpr;
                if (arg.d.argCategory === ArgCategory.Simple && valueExpr.nodeType === ParseNodeType.Dictionary) {
                    return valueExpr.d.items.some(
                        (entry) =>
                            entry.nodeType !== ParseNodeType.DictionaryKeyEntry ||
                            entry.d.keyExpr.nodeType !== ParseNodeType.StringList ||
                            getStringListValue(entry.d.keyExpr) === key
                    );
                }

                return true;
            });
    }

    // setdefault() never changes the value of a key that's present.
    return false;
}

function getStringListValue(node: StringListNode): string {
    return node.d.strings.map((s) => s.d.value).join('');
}
