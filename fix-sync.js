const fs = require('fs');
let content = fs.readFileSync('.sync-status.json', 'utf8');
content = content.replace(/<<<<<<< Updated upstream[\s\S]*?=======\n/m, '');
content = content.replace(/>>>>>>> Stashed changes\n/m, '');
fs.writeFileSync('.sync-status.json', content);
