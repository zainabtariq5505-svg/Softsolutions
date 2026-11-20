import fs from 'node:fs/promises';
await fs.mkdir('dist/server',{recursive:true});
await fs.mkdir('public',{recursive:true});
await fs.writeFile('public/robots.txt','User-agent: *\nAllow: /\n');
for(const [name,input] of [['styles','styles.css'],['client','client.js'],['config','config.js']])await fs.writeFile('src/'+name+'-text.js','export default '+JSON.stringify(await fs.readFile('src/'+input,'utf8'))+';');
let config=await fs.readFile('src/config.js','utf8');let render=(await fs.readFile('src/render.js','utf8')).replace(/^import .*;\r?\n/gm,'');let worker=(await fs.readFile('src/worker.js','utf8')).replace(/^import .*;\r?\n/gm,'');
let premium=(await fs.readFile('src/service-details.js','utf8')+'\n'+await fs.readFile('src/premium.js','utf8')).replace(/^import .*;\r?\n/gm,'');
let regionPicker=(await fs.readFile('src/region-picker.js','utf8')).replace(/^import .*;\r?\n/gm,'');
const strings=await Promise.all(['styles','client','config'].map(async n=>`const ${n==='config'?'configuration':n}=${JSON.stringify(await fs.readFile('src/'+(n==='styles'?'styles.css':n+'.js'),'utf8')+(n==='client'?'\n'+await fs.readFile('src/ribbon.js','utf8'):'')+(n==='styles'?'\n'+await fs.readFile('src/premium.css','utf8')+'\n'+await fs.readFile('src/refinements.css','utf8')+'\n'+await fs.readFile('src/region-picker.css','utf8')+'\n'+await fs.readFile('src/monochrome.css','utf8')+'\n'+await fs.readFile('src/service-details.css','utf8'):''))};`));
const assets={};for(const name of ['aurel','forma','soft-solutions-logo-gold','soft-solutions-icon-gold'])assets['/assets/'+name+'.webp']=(await fs.readFile('assets/'+name+'.webp')).toString('base64');
for(const name of ['forma','aurel','orbit','fatima-study-advisor'])assets['/assets/cover-'+name+'.jpg']=(await fs.readFile('assets/cover-'+name+'.jpg')).toString('base64');
const brandIcon=(await fs.readFile('assets/soft-solutions-monogram.jpeg')).toString('base64');
const flagAssets={};for(const file of await fs.readdir('assets/flags'))if(/^[a-z]{2}\.svg$/.test(file))flagAssets['/flags/'+file]=(await fs.readFile('assets/flags/'+file)).toString('base64');
await fs.writeFile('src/assets-text.js','export default '+JSON.stringify(assets)+';');
const crmCode=await fs.readFile('src/studio-server.js','utf8')+'\n'+await fs.readFile('src/crm-features.js','utf8')+'\n'+await fs.readFile('src/crm-server.js','utf8');
const portalStrings=(await Promise.all([['portalHTML','portal.html'],['portalCSS','portal.css'],['portalClient','portal.js']].map(async ([name,file])=>'const '+name+'='+JSON.stringify(await fs.readFile('src/'+file,'utf8'))+';'))).join('\n');
const crmStrings=(await Promise.all([['crmHTML','crm.html'],['crmCSS','crm.css'],['crmClient','crm-client.js']].map(async ([name,file])=>'const '+name+'='+JSON.stringify(await fs.readFile('src/'+file,'utf8')+(file==='crm-client.js'?'\n'+await fs.readFile('src/studio-client.js','utf8'):file==='crm.css'?'\n'+await fs.readFile('src/studio.css','utf8'):''))+';'))).join('\n');
await fs.writeFile('dist/server/index.js',crmCode+'\n'+portalStrings+'\n'+crmStrings+'\n'+config+'\n'+regionPicker+'\n'+premium+'\n'+render+'\n'+strings.join('\n')+'\nconst brandIcon='+JSON.stringify(brandIcon)+';\nconst flagAssets='+JSON.stringify(flagAssets)+';\nconst imageAssets='+JSON.stringify(assets)+';\n'+worker);console.log('Built Worker: '+(await fs.stat('dist/server/index.js')).size+' bytes');

