const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('合并CSS保留完整bold/fill映射，duotone已有映射的码点一致', () => {
    const maps = ['bold', 'fill', 'duotone'].map(weight => { const text = fs.readFileSync(path.join(__dirname, '../node_modules/@phosphor-icons/web/src', weight, 'style.css'), 'utf8'); return new Map([...text.matchAll(new RegExp('\\.ph-' + weight + '\\.(ph-[\\w-]+):before\\s*\\{\\s*content:\\s*"([^"\\n]+)"', 'g'))].map(match => [match[1], match[2]])); });
    assert.ok(maps[0].size > 1500);
    assert.equal(maps[1].size, maps[0].size);
    assert.ok(maps[2].size > 1500);
    for (const map of maps.slice(1))
        for (const [name, code] of map)
            assert.equal(maps[0].get(name), code, name);
});
