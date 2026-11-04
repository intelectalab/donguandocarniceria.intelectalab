const path='/home/claude/work/aycha-proto';
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});
const errs=[];p.on('pageerror',e=>errs.push(String(e.message).slice(0,120)));
await p.route('https://cdn.jsdelivr.net/**',r=>r.abort());await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));await p.route('https://fonts.gstatic.com/**',r=>r.abort());
await p.addInitScript(()=>{try{localStorage.clear()}catch(e){}});
await p.goto('file://'+path+'/dist/aycha-don-guando.html');await p.waitForFunction(()=>window.G&&G.auth);
const roles=await p.evaluate(()=>G.ROLES.map(r=>r[0]));
const rep=[];
for(const role of roles){
  errs.length=0;
  const info=await p.evaluate(async(role)=>{
    let login='ok';try{G.auth.demoLogin(role)}catch(e){login='ERR '+e.message}
    G.ctx.role=role;G.ui.closeAll();
    const vis=Object.values(G.screens).filter(s=>!s.hidden&&G.screenVisible(s,role));
    const mods={};for(const s of vis)mods[s.module]=(mods[s.module]||0)+1;
    // menu lateral
    G.go('HOME');await new Promise(r=>setTimeout(r,30));
    const menuItems=document.querySelectorAll('.side a, .side button, nav a').length;
    const homeLen=document.querySelector('.main').textContent.length;
    const bad=[];let noBtn=0;
    for(const s of vis){
      G.ui.closeAll();G.go(s.code);await new Promise(r=>setTimeout(r,15));
      const main=document.querySelector('.main');
      const n=main.querySelector('.notice.bad');
      if(n&&/No se pudo mostrar|Sin acceso|No tienes/.test(n.textContent))bad.push(s.code+': '+n.textContent.slice(0,70));
      else if(!main.querySelector('h1'))bad.push(s.code+': sin título');
      else if(main.textContent.length<120)bad.push(s.code+': vacía');
    }
    // módulos con acceso en la matriz pero sin pantallas visibles
    const noScreens=Object.keys(G.modules).filter(m=>G.access(m,role)&&!mods[m]);
    // permisos de edición declarados vs pantallas
    const canEdit=Object.keys(G.modules).filter(m=>/[CEA]/.test(G.access(m,role)||''));
    return {login,user:G.ctx.userId&&G.ctx.userId(),vis:vis.length,mods:Object.keys(mods).length,menuItems,homeLen,bad,noScreens,canEdit:canEdit.length};
  },role);
  rep.push(Object.assign({role},info,{jsErrors:errs.slice(0,3)}));
}
for(const r of rep)console.log(r.role.padEnd(24),'login:'+r.login,'user:'+r.user,'pant:'+r.vis,'mód:'+r.mods,'edit:'+r.canEdit,'menu:'+r.menuItems,'inicio:'+r.homeLen,'fallas:'+r.bad.length,r.noScreens.length?'sinPant:'+r.noScreens.join(','):'',r.jsErrors.length?'JS:'+r.jsErrors.join('|'):'');
for(const r of rep)if(r.bad.length)console.log('  FALLAS',r.role,r.bad.slice(0,8).join(' || '));
await b.close();})();
