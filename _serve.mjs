import { serve } from 'bun'; import { join, normalize } from 'node:path'; import { existsSync, statSync } from 'node:fs';
const root = join(process.cwd(),'dist');
serve({ port:4401, fetch(req){ let p=new URL(req.url).pathname; if(p==='/')p='/index.html'; const f=join(root,normalize(p)); if(existsSync(f)&&statSync(f).isFile()) return new Response(Bun.file(f)); return new Response('404',{status:404}); }});
console.log('serving on 4401');
