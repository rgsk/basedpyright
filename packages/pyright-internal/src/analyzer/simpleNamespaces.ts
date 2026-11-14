/*
 * simpleNamespaces.ts
 *
 * Special-case logic for types.SimpleNamespace. Its attributes are kept on the
 * instance type as known entries, the way a dict's string keys are (see
 * frozenDicts.ts): SimpleNamespace(host='h', port=1) prints as
 * SimpleNamespace[{host: str, port: int}], and ns.port is int.
 *
 * The attributes come from the constructor's keyword arguments, a mapping with
 * known keys (3.13+), and **unpacked dicts with known keys. Code flow analysis
 * applies the writes and deletions it can follow (ns.x = ..., del ns.x); wherever
 * it can't follow the namespace, it's a plain SimpleNamespace, whose attributes are
 * Any, as today. Reading an attribute the known entries don't have is an error.
 * The shape is never written in annotations: for a declared shape, use a Protocol,
 * which a namespace with matching attributes is assignable to.
 */

import { ArgCategory, CallNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { getEntriesFromArgs, stripLiteralsInTuples } from './frozenDicts';
import { Arg, TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, isClassInstance, Type, UnknownType } from './types';
import { mapSubtypes } from './typeUtils';

export function isSimpleNamespaceInstance(type: Type): type is ClassType {
    return isClassInstance(type) && ClassType.isSimpleNamespace(type);
}

// Called with the result of a call to the SimpleNamespace constructor. If every
// attribute name passed to it is known, returns the result with its attributes
// attached as known entries.
export function applySimpleNamespaceEntries(evaluator: TypeEvaluator, argList: Arg[], returnType: Type): Type {
    if (!isSimpleNamespaceInstance(returnType)) {
        return returnType;
    }

    if (argList.length === 0) {
        return ClassType.cloneForKnownEntries(returnType, new Map());
    }

    const objectType = evaluator.getBuiltInObject(argList[0].valueExpression ?? argList[0].node!, 'object');
    const result = getEntriesFromArgs(
        evaluator,
        argList,
        objectType,
        /* allowInexact */ true,
        /* expectedType */ undefined
    );
    if (!result) {
        return returnType;
    }

    return ClassType.cloneForKnownEntries(returnType, result.entries, result.origins);
}

// Applies ns.name = value (assignedType), del ns.name (isDelete), or a write of an
// unknown value (as in "for ns.name in ...") to the known attributes of the
// namespaces in the type. A new attribute's origin (for go-to-definition) is the
// name written.
export function applySimpleNamespaceAttributeWrite(
    type: Type,
    nameNode: NameNode,
    assignedType: Type | undefined,
    isDelete: boolean
): Type {
    const name = nameNode.d.value;
    return mapSubtypes(type, (subtype) => {
        if (!isSimpleNamespaceInstance(subtype) || !subtype.priv.knownEntries) {
            return subtype;
        }

        const entries = new Map(subtype.priv.knownEntries);
        if (isDelete) {
            entries.delete(name);
            return ClassType.cloneForKnownEntries(subtype, entries);
        }

        const origins = new Map(subtype.priv.knownEntryOrigins);
        if (!entries.has(name)) {
            origins.set(name, nameNode);
        }
        entries.set(name, assignedType ?? UnknownType.create());
        return ClassType.cloneForKnownEntries(subtype, entries, origins);
    });
}

export function hasSimpleNamespaceWithKnownEntries(type: Type): boolean {
    let found = false;
    mapSubtypes(type, (subtype) => {
        if (isSimpleNamespaceInstance(subtype) && subtype.priv.knownEntries) {
            found = true;
        }
        return subtype;
    });
    return found;
}

// Called with the result of a call to the builtin vars(). vars(ns) is the
// namespace's __dict__, so it has the namespace's attributes as known entries:
// dict[{'host': str, 'port': int}].
export function applyVarsCall(evaluator: TypeEvaluator, node: CallNode, returnType: Type): Type {
    if (
        node.d.args.length !== 1 ||
        node.d.args[0].d.name ||
        node.d.args[0].d.argCategory !== ArgCategory.Simple ||
        !isClassInstance(returnType) ||
        !ClassType.isBuiltIn(returnType, 'dict')
    ) {
        return returnType;
    }

    const argType = evaluator.getTypeOfExpression(node.d.args[0].d.valueExpr).type;
    if (!isSimpleNamespaceInstance(argType) || !argType.priv.knownEntries) {
        return returnType;
    }

    return ClassType.cloneForKnownEntries(
        returnType,
        new Map(argType.priv.knownEntries),
        argType.priv.knownEntryOrigins
    );
}

// Code flow analysis: the type of a namespace after setattr(ns, 'name', value) or
// delattr(ns, 'name'). With a name that isn't a string literal, any attribute may
// have changed, so the known attributes are forgotten.
export function applySimpleNamespaceAttrCall(evaluator: TypeEvaluator, type: Type, node: CallNode): Type {
    const isDelete = node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.leftExpr.d.value === 'delattr';
    const nameArg = node.d.args[1];
    const valueArg = isDelete ? undefined : node.d.args[2];
    const nameExpr = nameArg?.d.valueExpr;
    const name =
        nameArg &&
        !nameArg.d.name &&
        nameArg.d.argCategory === ArgCategory.Simple &&
        nameExpr?.nodeType === ParseNodeType.StringList
            ? nameExpr.d.strings.map((s) => s.d.value).join('')
            : undefined;

    if (
        name === undefined ||
        (!isDelete && (!valueArg || valueArg.d.name || valueArg.d.argCategory !== ArgCategory.Simple))
    ) {
        return mapSubtypes(type, (subtype) =>
            isSimpleNamespaceInstance(subtype) && subtype.priv.knownEntries
                ? ClassType.cloneForKnownEntries(subtype, undefined)
                : subtype
        );
    }

    const assignedType = valueArg
        ? evaluator.useSpeculativeMode(valueArg.d.valueExpr, () => evaluator.getTypeOfExpression(valueArg.d.valueExpr))
              .type
        : undefined;
    return mapSubtypes(type, (subtype) => {
        if (!isSimpleNamespaceInstance(subtype) || !subtype.priv.knownEntries) {
            return subtype;
        }
        const entries = new Map(subtype.priv.knownEntries);
        if (isDelete) {
            entries.delete(name);
        } else {
            entries.set(name, stripLiteralsInTuples(evaluator, assignedType!));
        }
        return ClassType.cloneForKnownEntries(subtype, entries);
    });
}
