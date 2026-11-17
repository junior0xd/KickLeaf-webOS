(function(root){'use strict';
 function luminance(hex){var c=[1,3,5].map(function(i){var v=parseInt(hex.slice(i,i+2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
 var backgroundLuminance=luminance('#111318'),fallbackColor='#8ce66b';
 function displayColor(value){if(typeof value!=='string'||value.length!==7||!/^#[0-9a-fA-F]{6}$/.test(value))return fallbackColor;var l=luminance(value),ratio=(Math.max(l,backgroundLuminance)+0.05)/(Math.min(l,backgroundLuminance)+0.05);return ratio>=4.5?value:fallbackColor;}

root.KickFIFODOM=function(list){
 let releasedRows=0,releasedImageElements=0;const release=row=>{if(row.dataset.deliveryReleased)return;row.dataset.deliveryReleased='true';releasedRows++;releasedImageElements+=row.querySelectorAll('img').length;if(row.releaseEmotes)row.releaseEmotes();};
 return {
 released(){return {rows:releasedRows,image_elements:releasedImageElements,meaning:"Elements present at release; failed images removed earlier are counted separately by the renderer."};},
 prepare(batch){const fragment=document.createDocumentFragment();try{for(const entry of batch){const m=JSON.parse(entry.payload);m.badgeItems=window.KickBadges?KickBadges.select(m):[];const row=document.createElement('div');row.className='chat-row';row.dataset.deliverySeq=String(entry.seq);fragment.appendChild(row);
   if(window.KickBadges&&m.badgeItems&&m.badgeItems.length){var badges=document.createElement('span');badges.className='chat-badges';KickBadges.mount(badges,m.badgeItems);row.appendChild(badges);}
   var name=document.createElement('strong');name.textContent=m.user.slice(0,80);name.style.color=displayColor(m.color);row.appendChild(name);
   var text=document.createElement('span');text.className='chat-message-text';if(window.KickEmotes)row.releaseEmotes=KickEmotes.mount(text,': '+m.text.slice(0,2000));else text.textContent=': '+m.text.slice(0,2000);row.appendChild(text);
 }}catch(e){Array.from(fragment.children).forEach(release);throw e;}return fragment;},
 append(fragment){list.appendChild(fragment);},
 ids(){return Array.from(list.children).map(row=>Number(row.dataset.deliverySeq));},
 releaseUnattached(fragment){Array.from(fragment.children).forEach(release);fragment.textContent='';},
 prune(n){const removed=[];while(list.children.length>n){const row=list.firstElementChild;removed.push(Number(row.dataset.deliverySeq));release(row);row.remove();}list.scrollTop=list.scrollHeight;return removed;},
 clear(){const ids=this.ids();Array.from(list.children).forEach(release);list.textContent='';if(window.KickBadges)KickBadges.clear();return ids;}
 };
};
})(window);
