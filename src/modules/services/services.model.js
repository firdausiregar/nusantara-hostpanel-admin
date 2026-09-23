'use strict';
function normalize(items){return(Array.isArray(items)?items:[]).map((x)=>({name:String(x?.name||''),active:x?.active===true?true:x?.active===false?false:null,enabled:x?.enabled===true?true:x?.enabled===false?false:null,detail:String(x?.detail||'')}));}
module.exports={normalize};
