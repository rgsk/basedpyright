/*
 * matplotlibAxes.ts
 *
 * matplotlib types plt.subplots(3, 1) as tuple[Figure, Any] (and fig.subplots(3, 1) as Any):
 * the axes come back as a numpy array of Axes, and numpy's types can't say what an object
 * array holds. When the grid's shape is known from the call (literal nrows and ncols, or
 * squeeze=False), the fork gives that array the Axes type and its number of dimensions
 * (ClassType.priv.axesArray), so indexing to an element, iterating, zip(axes, ...),
 * .flat, .ravel(), .flatten() and .tolist() give Axes. Anything else on the array is as
 * declared. Everything here is reached from a few hooks in typeEvaluator.ts and
 * protocols.ts that call these functions; deleting them removes the feature.
 */

import { ArgCategory, CallNode, ExpressionNode, IndexNode, ParseNodeType } from '../parser/parseNodes';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    isClass,
    isClassInstance,
    isOverloaded,
    OverloadedType,
    Type,
} from './types';
import { isTupleClass, specializeTupleClass } from './typeUtils';

const subplotsFunctions = new Set(['matplotlib.pyplot.subplots', 'matplotlib.figure.FigureBase.subplots']);
const axesClass = 'matplotlib.axes._axes.Axes';

// numpy's ndarray or flatiter, wherever numpy defines it (flatiter moved from numpy to
// numpy._core.multiarray in numpy 2.3).
function isNumpyClass(type: Type, name: 'ndarray' | 'flatiter'): type is ClassType {
    return (
        isClassInstance(type) &&
        type.shared.name === name &&
        (type.shared.moduleName === 'numpy' || type.shared.moduleName.startsWith('numpy.'))
    );
}

function isAxesArrayHolder(type: Type): type is ClassType {
    return (isNumpyClass(type, 'ndarray') || isNumpyClass(type, 'flatiter')) && !!type.priv.axesArray;
}

// What one step into the array gives: an Axes, or (for a 2-D array) a 1-D row.
function getItemType(array: ClassType): Type {
    const { element, ndim } = array.priv.axesArray!;
    return ndim > 1 ? ClassType.cloneForAxesArray(array, element, ndim - 1) : element;
}

// plt.subplots(...) / fig.subplots(...): the array of Axes, when the call says its shape.
export function applySubplotsCall(
    evaluator: TypeEvaluator,
    node: CallNode,
    calleeType: Type,
    returnType: Type
): Type {
    const overloads = isOverloaded(calleeType) ? OverloadedType.getOverloads(calleeType) : [];
    if (overloads.length === 0 || !subplotsFunctions.has(overloads[0].shared.fullName)) {
        return returnType;
    }

    let nrows: number | undefined = 1;
    let ncols: number | undefined = 1;
    let squeeze: boolean | undefined = true;
    let position = 0;
    for (const arg of node.d.args) {
        if (arg.d.argCategory !== ArgCategory.Simple) {
            return returnType;
        }
        const name = arg.d.name?.d.value ?? (position === 0 ? 'nrows' : position === 1 ? 'ncols' : undefined);
        if (!arg.d.name) {
            position++;
        }
        if (name === 'nrows') {
            nrows = getLiteralInt(evaluator, arg.d.valueExpr);
        } else if (name === 'ncols') {
            ncols = getLiteralInt(evaluator, arg.d.valueExpr);
        } else if (name === 'squeeze') {
            const type = evaluator.getTypeOfExpression(arg.d.valueExpr).type;
            squeeze =
                isClassInstance(type) && ClassType.isBuiltIn(type, 'bool') && typeof type.priv.literalValue === 'boolean'
                    ? type.priv.literalValue
                    : undefined;
        } else if (name === undefined) {
            return returnType;
        }
    }

    // squeeze=False is always 2-D. Otherwise numpy drops the dimensions of size 1, so
    // the shape is known only when both sizes are; a 1 x 1 grid is already typed Axes.
    let ndim: number;
    if (squeeze === false) {
        ndim = 2;
    } else if (squeeze === true && nrows !== undefined && ncols !== undefined && nrows >= 1 && ncols >= 1) {
        ndim = (nrows > 1 ? 1 : 0) + (ncols > 1 ? 1 : 0);
        if (ndim === 0) {
            return returnType;
        }
    } else {
        return returnType;
    }

    // The Axes and ndarray classes, from matplotlib's own overloads (-> Axes for a 1 x 1
    // grid, -> np.ndarray for squeeze=False).
    let axes: ClassType | undefined;
    let ndarray: ClassType | undefined;
    for (const overload of overloads) {
        const declared = overload.shared.declaredReturnType;
        const candidate =
            declared && isClassInstance(declared) && isTupleClass(declared)
                ? declared.priv.tupleTypeArgs?.[1]?.type
                : declared;
        if (candidate && isClassInstance(candidate)) {
            if (candidate.shared.fullName === axesClass) {
                axes = candidate;
            } else if (isNumpyClass(candidate, 'ndarray')) {
                ndarray = candidate;
            }
        }
    }
    if (!axes || !ndarray) {
        return returnType;
    }
    const array = ClassType.cloneForAxesArray(ndarray, axes, ndim);

    if (isClassInstance(returnType) && isTupleClass(returnType)) {
        const typeArgs = returnType.priv.tupleTypeArgs;
        if (!typeArgs || typeArgs.length !== 2) {
            return returnType;
        }
        return ClassType.cloneAsInstance(
            specializeTupleClass(ClassType.cloneAsInstantiable(returnType), [
                typeArgs[0],
                { type: array, isUnbounded: false },
            ])
        );
    }
    return array;
}

function getLiteralInt(evaluator: TypeEvaluator, node: ExpressionNode): number | undefined {
    const type = evaluator.getTypeOfExpression(node).type;
    return isClassInstance(type) && ClassType.isBuiltIn(type, 'int') && typeof type.priv.literalValue === 'number'
        ? type.priv.literalValue
        : undefined;
}

// axes.ravel(), axes.flatten(): a 1-D array of Axes. axes.tolist(): list[Axes] or
// list[list[Axes]].
export function applyAxesArrayMethodCall(evaluator: TypeEvaluator, node: CallNode, returnType: Type): Type {
    const callee = node.d.leftExpr;
    if (callee.nodeType !== ParseNodeType.MemberAccess || node.d.args.length > 0) {
        return returnType;
    }
    const method = callee.d.member.d.value;
    if (method !== 'ravel' && method !== 'flatten' && method !== 'tolist') {
        return returnType;
    }
    const base = evaluator.getTypeOfExpression(callee.d.leftExpr).type;
    if (!isAxesArrayHolder(base) || !isNumpyClass(base, 'ndarray')) {
        return returnType;
    }
    const { element, ndim } = base.priv.axesArray!;
    if (method === 'tolist') {
        let list = evaluator.getBuiltInObject(node, 'list', [element]);
        if (ndim > 1) {
            list = evaluator.getBuiltInObject(node, 'list', [list]);
        }
        return isClass(list) ? list : returnType;
    }
    return isNumpyClass(returnType, 'ndarray')
        ? ClassType.cloneForAxesArray(returnType, element, 1)
        : returnType;
}

// axes.flat: a flatiter of Axes.
export function getAxesArrayMemberType(baseType: Type, memberName: string, memberType: Type): Type {
    if (
        memberName === 'flat' &&
        isAxesArrayHolder(baseType) &&
        isNumpyClass(baseType, 'ndarray') &&
        isNumpyClass(memberType, 'flatiter')
    ) {
        return ClassType.cloneForAxesArray(memberType, baseType.priv.axesArray!.element, 1);
    }
    return memberType;
}

// axes[0], grid[0, 1], grid[:, 0], axes.flat[2]: ints and slices, one per dimension at most.
export function getAxesArrayIndexType(evaluator: TypeEvaluator, node: IndexNode, baseType: Type): Type | undefined {
    if (!isAxesArrayHolder(baseType) || node.d.trailingComma) {
        return undefined;
    }
    const { element, ndim } = baseType.priv.axesArray!;
    const isFlat = isNumpyClass(baseType, 'flatiter');
    if (node.d.items.length > ndim) {
        return undefined;
    }
    let ints = 0;
    for (const item of node.d.items) {
        if (item.d.argCategory !== ArgCategory.Simple || item.d.name) {
            return undefined;
        }
        if (item.d.valueExpr.nodeType === ParseNodeType.Slice) {
            if (isFlat) {
                return undefined;
            }
            continue;
        }
        const type = evaluator.getTypeOfExpression(item.d.valueExpr).type;
        if (!isClassInstance(type) || !ClassType.isBuiltIn(type, 'int')) {
            return undefined;
        }
        ints++;
    }
    const remaining = ndim - ints;
    return remaining === 0 ? element : ClassType.cloneForAxesArray(baseType, element, remaining);
}

// for ax in axes / for row in grid / for ax in axes.flat.
export function getAxesArrayIteratedType(type: Type): Type | undefined {
    return isAxesArrayHolder(type) ? getItemType(type) : undefined;
}

// How the array prints: ndarray[Axes, ndim=2], flatiter[Axes].
export function getAxesArrayTypeArgs(type: ClassType): { element: Type; ndimText: string | undefined } | undefined {
    if (!isAxesArrayHolder(type)) {
        return undefined;
    }
    const { element, ndim } = type.priv.axesArray!;
    return { element, ndimText: isNumpyClass(type, 'ndarray') ? `ndim=${ndim}` : undefined };
}
