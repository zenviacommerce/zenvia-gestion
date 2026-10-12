import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Verify the *built HTML*, not merely the source manifest/icon files.
// iOS 27.2 beta can show a letter tile if Apple-touch-icon needs a fetch.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(path.join(root,'dist','index.html'),'utf8');
const icons=[...html.matchAll(/<link\s+[^>]*rel="apple-touch-icon"[^>]*>/g)].map(match=>match[0]);
assert.equal(icons.length,1,'One authoritative 180x180 apple-touch-icon should be present');
const data=icons[0].match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
assert.ok(data,'The production Apple Home Screen icon must be embedded directly in HTML');
const bytes=Buffer.from(data[1],'base64');
assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Inline icon must be PNG');
assert.equal(bytes.readUInt32BE(16),180,'Inline icon width must be 180 px');
assert.equal(bytes.readUInt32BE(20),180,'Inline icon height must be 180 px');
assert.doesNotMatch(html,/__ZENVIA_IOS_TOUCH_ICON_DATA__/);
console.log('iOS Home Screen icon verified in production HTML: 180x180 PNG, inline data URL');
