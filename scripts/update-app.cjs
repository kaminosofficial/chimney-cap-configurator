const fs = require('fs');

let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/import \{ ChaseViewer \} from '\.\/components\/viewer\/ChaseViewer';/, "import { CapViewer } from './components/viewer/CapViewer';");
app = app.replace(/<ChaseViewer \/>/g, '<CapViewer />');
app = app.replace(/import \{ getHoleSizeInches, getHoleEdgeOffsets, holeWorld \} from '\.\/utils\/geometry';/, '');
app = app.replace(/function formatHoleSummary[\s\S]*?function formatHoleCutoutSummary[\s\S]*?\}\n/m, '');
app = app.replace(/CC-/g, 'MFC-');

// Find the payload generation and replace hole properties with cap properties
app = app.replace(/holes: config\.holes,[\s\S]*?holeCutoutC: config\.holes === 3 \? formatHoleCutoutSummary\('C', config\) : undefined,/g, `mount: config.mount,
                lid_type: config.lid_type,
                screen_height: config.screen_height,
                vertical_skirt: config.vertical_skirt,
                horizontal_skirt: config.horizontal_skirt,
                drip_edge: config.drip_edge,
                flange_width: config.flange_width,
                lid_overhang: config.lid_overhang,
                lid_pitch: config.lid_pitch,
                seam_count: config.seam_count,`);

app = app.replace(/\.\.\.\(config\.holes >= 1 \? \[formatHoleSummary\('A', 1, config\.collarA\)\] : \[\]\),[\s\S]*?\.\.\.\(config\.holes === 3 \? \[formatHoleSummary\('C', 3, config\.collarC\)\] : \[\]\),/g, '');

fs.writeFileSync('src/App.tsx', app);

let api = fs.readFileSync('api/add-to-cart.ts', 'utf8');
api = api.replace(/CC-/g, 'MFC-');
fs.writeFileSync('api/add-to-cart.ts', api);

let cleanup = fs.readFileSync('api/cleanup-variants.ts', 'utf8');
cleanup = cleanup.replace(/CC-/g, 'MFC-');
fs.writeFileSync('api/cleanup-variants.ts', cleanup);

console.log("Done updating App.tsx and api files.");
