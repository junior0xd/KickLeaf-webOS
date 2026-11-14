(function(root){'use strict';function resolve(value){
 if(typeof value!=='string'||value.length>1024||!/^[\x21-\x7e]+$/.test(value)||/[\\?#]/.test(value))throw Error('original_url_rejected');
 var u=new URL(value);if(u.protocol!=='https:'||['files.kick.com','ext.cdn.kick.com'].indexOf(u.hostname)<0||u.username||u.password||u.port||value.split('/')[2].indexOf('@')>=0)throw Error('original_url_rejected');
 if(u.hostname==='ext.cdn.kick.com'&&/^\/chat\/badges\/[A-Za-z0-9_-]+\.png$/.test(u.pathname))return value+'?width=72,format=webp,quality=50';return value;
}var api={resolve:resolve};if(typeof module==='object')module.exports=api;else root.CdnBadgeURL=api;})(this);
