(function(){'use strict';
 var taskEvents=[],video=null,listeners=[],events=[],counts={},lastMedia=null,observer,longObserver=null,timer=null,tickAt=performance.now(),lagMax=0,longTasks=0,longTaskMs=0,startedAt=Date.now();
 function record(name,v){counts[name]=(counts[name]||0)+1;events.push({at:Date.now(),kind:name,media_error_code:v&&v.error?v.error.code:null});if(events.length>200)events.shift();}
 function attach(){var next=document.querySelector('#native-video-host video');if(next===video)return;
  if(video)listeners.forEach(function(x){video.removeEventListener(x[0],x[1],true);});listeners=[];video=next;
  if(!video)return;record('video_attached');
  ['play','playing','pause','waiting','stalled','seeking','seeked','error','ended','loadedmetadata','loadstart','emptied'].forEach(function(name){var v=video;var fn=function(){record(name,v);if(window.KickNativeDiagnostics)lastMedia=window.KickNativeDiagnostics.snapshot();};listeners.push([name,fn]);v.addEventListener(name,fn,true);});
 }
 observer=new MutationObserver(attach);observer.observe(document.getElementById('native-video-host'),{childList:true});attach();
 var longSupported=typeof PerformanceObserver==='function'&&PerformanceObserver.supportedEntryTypes&&PerformanceObserver.supportedEntryTypes.indexOf('longtask')!==-1;
 if(longSupported){longObserver=new PerformanceObserver(function(items){items.getEntries().forEach(function(e){longTasks++;longTaskMs+=e.duration;taskEvents.push({id:longTasks,tv_ms:e.startTime,duration_ms:e.duration});if(taskEvents.length>120)taskEvents.shift();});});longObserver.observe({entryTypes:['longtask']});}
 timer=setInterval(function(){var now=performance.now();lagMax=Math.max(lagMax,Math.max(0,now-tickAt-1000));tickAt=now;},1000);
 window.KickJointDiagnostics={
  longTasksSince:function(cursor){return longSupported?{cursor:longTasks,lost:Math.max(0,(taskEvents[0]?.id??(longTasks+1))-cursor-1),events:taskEvents.filter(e=>e.id>cursor)}:null;},
  snapshot:function(){
  var media=window.KickNativeDiagnostics?window.KickNativeDiagnostics.snapshot():null;if(media)lastMedia=media;
  return {timestamp_ms:Date.now(),monotonic_ms:performance.now(),started_at:startedAt,player:media,last_player:lastMedia,player_events:events.slice(),player_counts:Object.assign({},counts),chat:window.KickChatUI.snapshot(),ui:{event_loop_lag_max_ms:lagMax,long_tasks_supported:!!longSupported,long_tasks:longSupported?longTasks:null,long_task_ms:longSupported?longTaskMs:null,js_heap_used_bytes:performance.memory?performance.memory.usedJSHeapSize:null,rss_bytes:null,cpu_percent:null,dom_nodes:document.getElementsByTagName('*').length},network_layers:{hls_bytes:null,hls_note:'Native video decoder traffic not measured in page; no URLs or tokens exported',chat:'HTTP bodies and WS payloads separate; Node socket plaintext counters overlap those values',telemetry:'Host Inspector only; never used to transport HLS or chat'}};
 }};
 window.addEventListener('pagehide',function(){clearInterval(timer);observer.disconnect();if(longObserver)longObserver.disconnect();if(video)listeners.forEach(function(x){video.removeEventListener(x[0],x[1],true);});listeners=[];video=null;});
}());
