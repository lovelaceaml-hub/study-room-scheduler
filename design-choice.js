(() => {
  'use strict';
  const designs=[['solace','Solace','Warm and welcoming'],['velum','Velum','Airy and refined'],['cove','Cove','Soft and serene'],['petal','Petal','Gentle and personal'],['atlas','Atlas','Warm and spacious'],['lattice','Lattice','Clear and composed']];
  const key='srs-design-v1',params=new URLSearchParams(location.search),isDemo=params.get('demo')==='1';
  const experience=location.pathname.match(/^\/experiences\/([a-z]+)\//)?.[1];
  const read=()=>{try{return localStorage.getItem(key);}catch{return null;}};
  const remember=value=>{if(!isDemo)try{localStorage.setItem(key,value);}catch{}};
  const choose=name=>{remember(name);const query=isDemo?'?demo=1':'';if(name==='classic'){if(experience)location.assign('/?classic=1'+(isDemo?'&demo=1':''));else dialog?.close();}else location.assign('/experiences/'+name+'/'+query);};
  if(params.has('tv')||location.pathname.endsWith('tv.html')||params.get('test')==='1')return;
  if(experience){if(designs.some(d=>d[0]===experience))remember(experience);return;}
  const force=params.get('choose')==='1',classic=params.get('classic')==='1';
  if(classic&&!params.has('tab'))remember('classic');
  const stored=read();
  const preference=stored==='classic'||designs.some(d=>d[0]===stored)?stored:null;
  if(!force&&!classic&&!isDemo&&designs.some(d=>d[0]===preference)){location.replace('/experiences/'+preference+'/');return;}
  let dialog;
  function open(){
    if(!dialog){
      const style=document.createElement('link');style.rel='stylesheet';style.href='/design-choice.css';document.head.append(style);
      dialog=document.createElement('dialog');dialog.className='design-picker';dialog.setAttribute('aria-labelledby','design-picker-title');
      dialog.innerHTML='<div class="dp-top"><p>A space that feels like you</p><button type="button" class="dp-close" aria-label="Keep the current design and close">×</button></div><h2 id="design-picker-title">Choose your design.</h2><p class="dp-intro">One shared schedule. Choose a new look, or keep the app you know. You can change this anytime.</p><button type="button" class="dp-current">Keep the current design <span>Continue as usual</span></button><div class="dp-grid">'+designs.map(([name,title,description])=>'<button type="button" class="dp-design dp-'+name+'" data-design="'+name+'" aria-label="Use '+title+' design"><span class="dp-preview" aria-hidden="true"><span></span><i></i><i></i><i></i><i></i></span><b>'+title+'</b><small>'+description+'</small></button>').join('')+'</div><p class="dp-note">Your choice is remembered on this device. Your reservations stay the same.</p>';
      document.body.append(dialog);dialog.querySelector('.dp-current').onclick=()=>choose('classic');dialog.querySelector('.dp-close').onclick=()=>choose('classic');dialog.addEventListener('cancel',()=>remember('classic'));dialog.addEventListener('click',event=>{const target=event.target.closest('[data-design]');if(target)choose(target.dataset.design);});
    }
    if(!dialog.open)dialog.showModal();
  }
  const masthead=document.querySelector('.head-in');
  if(masthead){const button=document.createElement('button');button.type='button';button.textContent='Change design';button.className='design-change-button';button.style.cssText='min-height:44px;padding:8px 12px;border:1px solid currentColor;border-radius:20px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer';button.onclick=open;masthead.append(button);}
  if(force||(!classic&&!isDemo&&!preference))open();
})();
