const fs = require('fs');
const path = require('path');

const dir = 'e:/Chase Cover Configurator/chase-cover-configurator/src';

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
    });
}

walk(dir, function (filePath) {
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        let content = fs.readFileSync(filePath, 'utf8');
        let dirty = false;

        // Replace `import React, {` with `import {`
        if (content.includes("import React, {")) {
            content = content.replace(/import React,\s*\{/g, "import {");
            dirty = true;
        }

        // Replace `import React from 'react';\n`
        if (content.includes("import React from 'react';")) {
            content = content.replace(/import React from 'react';\r?\n/g, "");
            dirty = true;
        }

        if (dirty) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Fixed:', filePath);
        }
    }
});
