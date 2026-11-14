/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
////
//// cfg = SimpleNamespace([|host|]="h", port=1)
//// cfg.[|/*keyword*/host|]
//// cfg.[|timeout|] = 3.5
//// cfg.[|/*write*/timeout|]
//// row = {[|'id'|]: 1}
//// user = SimpleNamespace(row)
//// user.[|/*fromDict*/id|]
//// app = SimpleNamespace(db=SimpleNamespace([|port|]=5432))
//// app.db.[|/*nested*/port|]
//// cfg[[|/*index*/'host'|]]

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
            keyword: definitionOf('host'),
            write: definitionOf('timeout'),
            fromDict: definitionOf("'id'"),
            nested: definitionOf('port'),
            // Not a key: a namespace can't be indexed.
            index: { definitions: [] },
        },
        'preferSource'
    );
}
