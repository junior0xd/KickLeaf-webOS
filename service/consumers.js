'use strict';
class Consumers {
  constructor(onLast){this.members=new Map();this.contexts=new Map();this.onLast=onLast;}
  get size(){return this.members.size;}
  add(token,message,context=null){this.members.set(token,message);this.contexts.set(token,context);}
  remove(token){const had=this.members.size;this.members.delete(token);this.contexts.delete(token);if(had&&!this.members.size)this.onLast();}
  broadcast(payload){let delivered=0;for(const [token,message] of this.members){try{if(message.respond(payload)===false)throw Error('respond_failed');delivered++;}catch(_){this.remove(token);}}return delivered>0;}
}
module.exports={Consumers};
