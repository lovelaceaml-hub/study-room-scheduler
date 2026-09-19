(() => {
  'use strict';
  const designs=[['solace','Solace','Warm and welcoming'],['velum','Velum','Airy and refined'],['cove','Cove','Soft and serene'],['petal','Petal','Gentle and personal'],['atlas','Atlas','Warm and spacious'],['lattice','Lattice','Clear and composed']];
  const key='srs-design-v1',params=new URLSearchParams(location.search),isDemo=params.get('demo')==='1',isTest=params.get('test')==='1';
  const experience=location.pathname.match(/^\/experiences\/([a-z]+)\//)?.[1];
  const read=()=>{try{return localStorage.getItem(key);}catch{return null;}};
  const remember=value=>{if(!isDemo)try{localStorage.setItem(key,value);}catch{}};
  const known=name=>designs.some(design=>design[0]===name);
  // The lobby TV keeps its own page and its own script.
  if(location.pathname.endsWith('tv.html'))return;
  if(params.has('tv')){location.replace('/tv.html'+location.search+location.hash);return;}
  // A design page opened with test=1 is left completely alone, as before.
  if(isTest&&experience)return;
  // The root and every design register the one shared service worker.
  if(!isTest&&'serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  if(experience){if(known(experience))remember(experience);return;}
  const force=params.get('choose')==='1',tab=params.get('tab');
  if(tab==='admin'){location.replace('/admin/'+(isDemo?'?demo=1':''));return;}
  const wantsMine=tab==='mine'||params.get('view')==='mine';
  const stored=read(),preference=known(stored)?stored:null;
  const target=name=>{const query=[wantsMine?'view=mine':'',isDemo?'demo=1':''].filter(Boolean).join('&');return '/experiences/'+name+'/'+(query?'?'+query:'');};
  const choose=name=>{remember(name);location.assign(target(name));};
  if(!force&&!isDemo&&preference){location.replace(target(preference));return;}
  let dialog;
  function open(){
    if(!dialog){
      const style=document.createElement('link');style.rel='stylesheet';style.href='/design-choice.css';document.head.append(style);
      dialog=document.createElement('dialog');dialog.className='design-picker';dialog.setAttribute('aria-labelledby','design-picker-title');
      dialog.innerHTML='<div class="dp-top"><p>A space that feels like you</p><button type="button" class="dp-close" aria-label="Close and use Solace, the default design">×</button></div><h2 id="design-picker-title">Choose your design.</h2><p class="dp-intro">One shared schedule, six looks. Choose the one you like. You can change this anytime.</p><div class="dp-grid">'+designs.map(([name,title,description],index)=>'<button type="button" class="dp-design dp-'+name+'" data-design="'+name+'"'+(index===0?' autofocus':'')+' aria-label="Use '+title+' design'+(index===0?', the default':'')+'"><span class="dp-preview" aria-hidden="true"><span></span><i></i><i></i><i></i><i></i></span><b>'+title+'</b>'+(index===0?'<span class="dp-default">Default</span>':'')+'<small>'+description+'</small></button>').join('')+'</div><p class="dp-note">Your choice is remembered on this device. Your reservations stay the same.</p>';
      document.body.append(dialog);
      dialog.querySelector('.dp-close').onclick=()=>choose('solace');
      dialog.addEventListener('cancel',event=>{event.preventDefault();choose('solace');});
      dialog.addEventListener('click',event=>{
        const picked=event.target.closest('[data-design]');
        if(picked){choose(picked.dataset.design);return;}
        if(event.target!==dialog)return;
        const rect=dialog.getBoundingClientRect();
        if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)choose('solace');
      });
    }
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('[data-design]')?.focus();
  }
  open();
})();
