/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.15"
//// }

// @filename: test.py
//// user = {[|'name'|]: 'rahul'}
//// user[[|/*literal*/'name'|]]
//// user['name'] = 'rgsk'
//// user[[|/*rewritten*/'name'|]]
//// user[[|'city'|]] = 'delhi'
//// user[[|/*write*/'city'|]]
//// user.update([|zone|]='north')
//// user[[|/*update*/'zone'|]]
//// user.setdefault([|'pin'|], '110001')
//// user[[|/*setdefault*/'pin'|]]
//// user[[|/*unknown*/'nope'|]]
////
//// cfg = dict([|lr|]=0.1)
//// cfg[[|/*keyword*/'lr'|]]
//// both = cfg | {[|'extra'|]: 0.5}
//// both[[|/*mergedLeft*/'lr'|]]
//// both[[|/*mergedRight*/'extra'|]]
////
//// fz = frozendict([|size|]=1)
//// fz[[|/*frozendict*/'size'|]]
//// keys = dict.fromkeys([[|'k1'|]], 0)
//// keys[[|/*fromkeys*/'k1'|]]
////
//// empty = {}
//// empty[[|'env'|]] = 22
//// empty[[|/*startsEmpty*/'env'|]]

{
    const rangeMap = helper.getRangesByText();
    const definitionOf = (text: string) => ({
        definitions: rangeMap
            .get(text)!
            .filter((r) => !r.marker)
            .map((r) => ({ path: r.fileName, range: helper.convertPositionRange(r) })),
    });

    helper.verifyFindDefinitions(
        {
            literal: definitionOf("'name'"),
            rewritten: definitionOf("'name'"),
            write: definitionOf("'city'"),
            update: definitionOf('zone'),
            setdefault: definitionOf("'pin'"),
            unknown: { definitions: [] },
            keyword: definitionOf('lr'),
            mergedLeft: definitionOf('lr'),
            mergedRight: definitionOf("'extra'"),
            frozendict: definitionOf('size'),
            fromkeys: definitionOf("'k1'"),
            startsEmpty: definitionOf("'env'"),
        },
        'preferSource'
    );
}
