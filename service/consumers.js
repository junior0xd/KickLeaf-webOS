'use strict';
class Consumers {
  constructor(onLast){this.members=new Map();this.onLast=onLast;}
  get size(){return this.members.size;}
  add(token,message){this.members.set(token,message);}
  remove(token){const had=this.members.size;this.members.delete(token);if(had&&!this.members.size)this.onLast();}
  broadcast(payload){for(const [token,message] of this.members){try{message.respond(payload);}catch(_){this.remove(token);}}}
}
module.exports={Consumers};
