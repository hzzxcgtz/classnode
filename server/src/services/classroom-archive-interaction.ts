/** Vanilla browser code embedded with a CSP hash; all user content stays server-escaped. */
export const ARCHIVE_SCRIPT = String.raw`
(function(){
'use strict';
var $=function(s,root){return (root||document).querySelector(s)};
var all=function(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))};
var currentView='overview';
var sidebar=$('.sidebar'),backdrop=$('.backdrop'),search=$('#global-search'),results=$('#search-results');
var searchIndex=null,searchTimer=null,previousFocus=null,zoom=1;
var viewNames={overview:'课堂概览',worksheets:'学习单',explorer:'探究空间',companion:'智能学伴',participants:'学生与小组',notes:'附件与说明'};
function closeMenu(){sidebar.classList.remove('is-open');backdrop.classList.remove('is-open');$('#menu-toggle').setAttribute('aria-expanded','false')}
function activeRecord(view){return $('[data-view="'+view+'"] .record-panel.is-active')}
function chooseRecord(view,id){
 var owner=$('[data-view="'+view+'"]');if(!owner)return;
 var target=document.getElementById(id);if(!target||!owner.contains(target))return;
 all('.record-panel',owner).forEach(function(p){p.classList.toggle('is-active',p===target)});
 var selected=$('[data-record-button="'+id+'"]',owner);
 var filter=$('[data-directory-filter]',owner);if(selected&&selected.hidden&&filter){filter.value='';applyDirectory(filter)}
 all('[data-record-button]',owner).forEach(function(b){var active=b.dataset.recordButton===id;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active))});
}
function navigate(view,id,updateHash){
 if(!viewNames[view])view='overview';
 currentView=view;
 all('[data-view]').forEach(function(p){p.classList.toggle('is-active',p.dataset.view===view)});
 all('[data-nav]').forEach(function(a){var active=a.dataset.nav===view;a.classList.toggle('is-active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
 $('#breadcrumb-current').textContent=viewNames[view];
 if(id)chooseRecord(view,id);
 var record=activeRecord(view);
 if(updateHash!==false){
  var hash='#'+view+(record?'/'+record.id:'');
  // file:// allows hashes; never depend on history APIs or a local server.
  if(location.hash!==hash){try{history.replaceState(null,'',hash)}catch(_){location.hash=hash}}
 }
 closeMenu();results.hidden=true;
 window.scrollTo({top:0,behavior:'auto'});
}
function chooseTab(button){
 var owner=button.closest('[data-tabs]');if(!owner)return;
 var id=button.getAttribute('aria-controls');
 all('[role=tab]',owner).forEach(function(b){var active=b===button;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});
 var panel=owner.parentElement;
 all(':scope > .tab-panel',panel).forEach(function(p){p.classList.toggle('is-active',p.id===id)});
}
function applyDirectory(input){
 var owner=input.closest('[data-view]'),q=input.value.trim().toLocaleLowerCase();
 all('[data-record-button]',owner).forEach(function(b){b.hidden=!!q&&b.textContent.toLocaleLowerCase().indexOf(q)<0});
 var visible=all('[data-record-button]',owner).filter(function(b){return !b.hidden});
 var empty=$('.directory-empty',owner);if(empty)empty.hidden=visible.length>0;
 all('.directory-group',owner).forEach(function(g){var group=g.dataset.groupLabel;g.hidden=!all('[data-group]',owner).some(function(b){return b.dataset.group===group&&!b.hidden})});
}
function searchAll(){
 var query=search.value.trim().toLocaleLowerCase();results.replaceChildren();
 if(!query){results.hidden=true;return}
 if(!searchIndex)searchIndex=all('[data-record-button]').map(function(button){
  var panel=document.getElementById(button.dataset.recordButton),owner=button.closest('[data-view]');
  var searchable=panel.cloneNode(true);all('select,script,style',searchable).forEach(function(n){n.remove()});
  return {view:owner.dataset.view,id:panel.id,title:button.dataset.title||button.textContent.trim(),text:(searchable.textContent+' '+button.textContent).replace(/\s+/g,' ').toLocaleLowerCase()};
 });
 var matches=searchIndex.filter(function(r){return r.text.indexOf(query)>=0});
 var count=document.createElement('p');count.textContent=matches.length?'找到 '+matches.length+' 条记录'+(matches.length>30?'，先显示前 30 条':''):'没有找到匹配记录，请换一个关键词。';results.appendChild(count);
 matches.slice(0,30).forEach(function(record){
  var button=document.createElement('button');button.type='button';button.className='search-result';
  button.dataset.goView=record.view;button.dataset.goRecord=record.id;
  var small=document.createElement('small');small.textContent=viewNames[record.view];
  var strong=document.createElement('strong');strong.textContent=record.title;
  var snippet=document.createElement('span'),at=record.text.indexOf(query);snippet.textContent=record.text.slice(Math.max(0,at-20),at+85);
  button.append(small,strong,snippet);results.appendChild(button);
 });
 results.hidden=false;
}
function revealSearch(){
 var root=activeRecord(currentView),query=search.value.trim().toLocaleLowerCase();if(!root||!query)return;
 all('mark.search-hit').forEach(function(mark){var parent=mark.parentNode;mark.replaceWith(document.createTextNode(mark.textContent));parent.normalize()});
 var panes=all('.tab-panel',root),pane=panes.find(function(p){return p.textContent.toLocaleLowerCase().indexOf(query)>=0});
 if(pane){var button=$('[aria-controls="'+pane.id+'"]',root);if(button)chooseTab(button)}
 all('details',pane||root).forEach(function(d){if(d.textContent.toLocaleLowerCase().indexOf(query)>=0)d.open=true});
 var walker=document.createTreeWalker(pane||root,NodeFilter.SHOW_TEXT),node;
 while((node=walker.nextNode())){
  if(node.parentElement.closest('select,summary,[hidden]'))continue;
  var index=node.textContent.toLocaleLowerCase().indexOf(query);if(index<0)continue;
  var text=node.textContent,mark=document.createElement('mark');mark.className='search-hit';mark.textContent=text.slice(index,index+query.length);
  node.replaceWith(document.createTextNode(text.slice(0,index)),mark,document.createTextNode(text.slice(index+query.length)));
  mark.scrollIntoView({block:'center',behavior:'auto'});break;
 }
}
function contextRoot(){return activeRecord(currentView)||$('[data-view="'+currentView+'"]')}
function updateExpand(){var root=contextRoot(),closed=all('details',root).some(function(d){return !d.open});$('#expand-current').textContent=closed?'展开当前记录':'收起当前记录'}
function toggleExpand(){var root=contextRoot(),open=all('details',root).some(function(d){return !d.open});all('details',root).forEach(function(d){d.open=open});updateExpand()}
var printState=null;
function restorePrint(){if(!printState)return;printState.forEach(function(s){s[0].open=s[1]});document.body.classList.remove('print-all');printState=null;updateExpand()}
function printView(everything){
 printState=all('details').map(function(d){return [d,d.open]});
 all('details',everything?document:contextRoot()).forEach(function(d){d.open=true});
 document.body.classList.toggle('print-all',everything);
 window.print();
}
window.addEventListener('afterprint',restorePrint);
var picture=$('#picture-overlay'),pictureStage=$('#picture-stage'),pictureElement=null;
function fitPicture(){
 if(!pictureElement)return;
 var w=Number(pictureElement.dataset.width)||pictureElement.naturalWidth||800;
 var h=Number(pictureElement.dataset.height)||pictureElement.naturalHeight||600;
 var availableW=Math.max(160,pictureStage.clientWidth-56),availableH=Math.max(160,pictureStage.clientHeight-56);
 var scale=Math.min(availableW/w,availableH/h,1)*zoom;
 pictureElement.style.width=(w*scale)+'px';pictureElement.style.height=(h*scale)+'px';
 $('#zoom-value').textContent=Math.round(zoom*100)+'%';
}
function openPicture(element){
 previousFocus=document.activeElement;pictureStage.replaceChildren();zoom=1;
 var caption=element.closest('figure'),title=caption&&$('figcaption',caption);
 $('#picture-title').textContent=title?title.textContent:'查看原始图片';
 if(element.tagName.toLowerCase()==='svg'){
  pictureElement=element.cloneNode(true);var box=element.viewBox.baseVal;
  pictureElement.dataset.width=box.width;pictureElement.dataset.height=box.height;
  var serializer=new XMLSerializer();
  $('#picture-download').href='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serializer.serializeToString(element));
  $('#picture-download').download='原始笔迹.svg';
 }else{
  pictureElement=document.createElement('img');pictureElement.src=element.src;pictureElement.alt=element.alt;
  pictureElement.onload=fitPicture;
  $('#picture-download').href=element.src;$('#picture-download').download='';
 }
 pictureStage.appendChild(pictureElement);picture.hidden=false;document.body.style.overflow='hidden';
 requestAnimationFrame(fitPicture);$('#picture-close').focus();
}
function closePicture(){picture.hidden=true;pictureStage.replaceChildren();pictureElement=null;document.body.style.overflow='';if(previousFocus&&previousFocus.focus)previousFocus.focus()}
$('#picture-close').addEventListener('click',closePicture);
$('#zoom-in').addEventListener('click',function(){zoom=Math.min(5,zoom+.25);fitPicture()});
$('#zoom-out').addEventListener('click',function(){zoom=Math.max(.25,zoom-.25);fitPicture()});
$('#zoom-reset').addEventListener('click',function(){zoom=1;fitPicture()});
pictureStage.addEventListener('click',function(e){if(e.target===pictureStage)closePicture()});
window.addEventListener('resize',fitPicture);
document.addEventListener('click',function(e){
 var target=e.target instanceof Element?e.target:null;if(!target)return;
 var nav=target.closest('[data-nav],[data-go-view]');
 if(nav){e.preventDefault();navigate(nav.dataset.nav||nav.dataset.goView,nav.dataset.goRecord);if(nav.classList.contains('search-result'))revealSearch();updateExpand();return}
 var record=target.closest('[data-record-button]');
 if(record){chooseRecord(record.closest('[data-view]').dataset.view,record.dataset.recordButton);var panel=activeRecord(currentView);navigate(currentView,panel.id);updateExpand();return}
 var opener=target.closest('[data-open-tab]');if(opener){var tabButton=$('[aria-controls="'+opener.dataset.openTab+'"]');if(tabButton)chooseTab(tabButton);return}
 var tab=target.closest('[role=tab]');if(tab){chooseTab(tab);return}
 if(target.closest('#expand-current')){toggleExpand();return}
 if(target.closest('#print-current')){printView(false);return}
 if(target.closest('#print-all')){printView(true);return}
 if(target.closest('#menu-toggle')){var open=!sidebar.classList.contains('is-open');sidebar.classList.toggle('is-open',open);backdrop.classList.toggle('is-open',open);$('#menu-toggle').setAttribute('aria-expanded',String(open));return}
 if(target.closest('#sidebar-close')||target===backdrop){closeMenu();return}
 var image=target.closest('figure img,figure svg.ink');
 if(image&&!picture.contains(image)){e.preventDefault();openPicture(image);return}
 if(!target.closest('.global-search'))results.hidden=true;
});
document.addEventListener('input',function(e){
 var input=e.target;if(input===search){clearTimeout(searchTimer);searchTimer=setTimeout(searchAll,120)}
 if(input.matches('[data-directory-filter]'))applyDirectory(input);
 if(input.id==='file-filter'){var q=input.value.trim().toLocaleLowerCase(),table=$('#file-inventory');all('tbody tr',table).forEach(function(row){row.hidden=!!q&&row.textContent.toLocaleLowerCase().indexOf(q)<0})}
});
document.addEventListener('change',function(e){
 var select=e.target;if(!select.matches('[data-response-filter]'))return;
 var pane=select.closest('.tab-panel');all('[data-participant]',pane).forEach(function(card){card.hidden=!!select.value&&card.dataset.participant!==select.value});
});
document.addEventListener('keydown',function(e){
 if(e.key==='Escape'){if(!picture.hidden)closePicture();else{results.hidden=true;closeMenu()}return}
 if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();search.focus();return}
 if(!picture.hidden&&e.key==='Tab'){
  var buttons=all('button,a',picture),first=buttons[0],last=buttons[buttons.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}return;
 }
 if(e.target===search&&e.key==='ArrowDown'){var firstResult=$('button',results);if(firstResult){e.preventDefault();firstResult.focus()}return}
 if(e.target.closest&&e.target.closest('[role=tablist]')&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){
  var tabs=all('[role=tab]',e.target.closest('[role=tablist]')),index=tabs.indexOf(e.target),next=tabs[(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
  if(next){e.preventDefault();chooseTab(next);next.focus()}
 }
});
function fromHash(){var bits=location.hash.slice(1).split('/');navigate(bits[0]||'overview',bits[1],false);updateExpand()}
window.addEventListener('hashchange',fromHash);
fromHash();
})();
`;
